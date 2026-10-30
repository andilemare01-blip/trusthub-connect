import type { AiConfigStatus } from "./config.ts";
import type { AiSpendLedger } from "./spend-ledger.ts";

/**
 * Why a provider call did not produce text. Each value is a distinct,
 * diagnosable outcome — never a secret, a key, or message content:
 * `invalid_credentials` (HTTP 401), `model_access` (402/403/404 — the
 * model is not reachable with this key, e.g. no access or not found),
 * `rate_limited` (429), `upstream` (5xx), `timeout` (abort), and
 * `invalid_response` (the provider answered but the payload had no usable
 * content). `unavailable` is the remaining catch-all transport/4xx case.
 */
export type AiFailure = "disabled" | "budget_exhausted" | "duplicate" | "too_large" | "ledger_unavailable" | "invalid_credentials" | "model_access" | "rate_limited" | "upstream" | "timeout" | "unavailable" | "invalid_response";
export type AiResult = { ok: true; text: string; costMicroUsd: number } | { ok: false; reason: AiFailure; providerMessage?: string };

export interface AiRequest {
  /** Stable per logical call (e.g. inbound provider message id + purpose); a repeat never calls the provider again. */
  key: string;
  purpose: string;
  system: string;
  user: string;
  json?: boolean;
}

const CHARS_PER_TOKEN = 3;

/** A failed provider attempt, reported for diagnosis. Never contains the key or message content. */
export interface AiAttemptFailure { reason: AiFailure; model: string; providerStatus?: number; providerMessage?: string }

/**
 * Failures specific to one model, so the next model in the chain may succeed:
 * a retired or unavailable model (402/403/404), that model being rate-limited,
 * or an unusable reply. Provider-wide failures (5xx, timeouts, unknown 4xx)
 * are not retried, because another model would almost certainly fail too and
 * each retry would add cost and delay to the WhatsApp reply.
 */
const RETRYABLE: ReadonlySet<AiFailure> = new Set<AiFailure>(["model_access", "rate_limited", "invalid_response"]);

let freeModels: { at: number; ids: string[] } | null = null;

/** One logical call per key, no retries of the same model, a fallback chain of models, hard input/output limits and a recorded-spend ceiling. */
export class AiGateway {
  private readonly status: AiConfigStatus;
  private readonly ledger: AiSpendLedger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;
  private readonly onFailure?: (failure: AiAttemptFailure) => void | Promise<void>;
  private readonly inFlight = new Set<string>();
  private tripped = false;

  constructor(status: AiConfigStatus, ledger: AiSpendLedger, fetchImpl: typeof fetch = fetch, now: () => string = () => new Date().toISOString(), onFailure?: (failure: AiAttemptFailure) => void | Promise<void>) {
    this.status = status; this.ledger = ledger; this.fetchImpl = fetchImpl; this.now = now; this.onFailure = onFailure;
  }

  get enabled(): boolean { return this.status.enabled && !this.tripped; }

  async complete(request: AiRequest): Promise<AiResult> {
    if (!this.status.enabled || this.tripped) return { ok: false, reason: "disabled" };
    const { config } = this.status;
    if (this.inFlight.has(request.key)) return { ok: false, reason: "duplicate" };
    const inputTokens = Math.ceil((request.system.length + request.user.length) / CHARS_PER_TOKEN);
    if (inputTokens > config.maxInputTokens) return { ok: false, reason: "too_large" };
    const worstCase = Math.ceil(inputTokens * config.inputUsdPerMillion + config.maxOutputTokens * config.outputUsdPerMillion);
    this.inFlight.add(request.key);
    try {
      let total: number;
      try {
        if (await this.ledger.hasCall(request.key)) return { ok: false, reason: "duplicate" };
        total = await this.ledger.totalMicroUsd();
      } catch { return { ok: false, reason: "ledger_unavailable" }; }
      if (total + worstCase > config.spendLimitMicroUsd) return { ok: false, reason: "budget_exhausted" };

      let last: AiResult = { ok: false, reason: "unavailable" };
      const models = config.models.length ? config.models : [config.model];
      const started = Date.now();
      for (const [index, model] of models.entries()) {
        // Fallbacks stop once the time budget is spent, so a WhatsApp reply is never held up for several timeouts.
        if (index > 0 && Date.now() - started >= config.timeoutMs) break;
        last = await this.attempt(request, model, index, inputTokens, worstCase);
        if (last.ok || !RETRYABLE.has(last.reason)) return last;
      }
      // Every configured model is gone (free models are retired without notice): find the free models
      // OpenRouter offers today and try those, so Wisdom repairs itself instead of going quiet.
      if (!last.ok && last.reason === "model_access" && config.inputUsdPerMillion === 0 && Date.now() - started < config.timeoutMs) {
        const fresh = (await this.currentFreeModels(config.baseUrl)).filter((model) => !models.includes(model)).slice(0, 3);
        for (const [offset, model] of fresh.entries()) {
          if (Date.now() - started >= config.timeoutMs) break;
          last = await this.attempt(request, model, models.length + offset, inputTokens, worstCase);
          if (last.ok || !RETRYABLE.has(last.reason)) return last;
        }
      }
      return last;
    } finally { this.inFlight.delete(request.key); }
  }

  /** Today's free chat models on OpenRouter, newest first, cached for six hours. */
  private async currentFreeModels(baseUrl: string): Promise<string[]> {
    if (freeModels && Date.now() - freeModels.at < 6 * 3_600_000) return freeModels.ids;
    try {
      const response = await this.fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
      const body = await response.json() as { data?: { id?: string; created?: number; architecture?: { output_modalities?: string[] } }[] };
      const ids = (body.data ?? [])
        .filter((model) => typeof model.id === "string" && model.id.endsWith(":free") && !/(safety|guard|code|coder|lyria|embed|vl|omni|vision|audio)/i.test(model.id)
          && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes("text")))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).map((model) => model.id!);
      freeModels = { at: Date.now(), ids };
      return ids;
    } catch { return []; }
  }

  /** One provider call for one model. Each attempt has its own ledger key so every paid attempt is counted. */
  private async attempt(request: AiRequest, model: string, index: number, inputTokens: number, worstCase: number): Promise<AiResult> {
    const { config } = this.status as Extract<AiConfigStatus, { enabled: true }>;
    const ledgerKey = index === 0 ? request.key : `${request.key}~${index}`;
    const fail = async (reason: AiFailure, providerStatus?: number, providerMessage?: string): Promise<AiResult> => {
      await this.reportFailure({ reason, model, providerStatus, providerMessage });
      return { ok: false, reason, providerMessage };
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
      // OpenRouter attribution is optional and contains no secrets.
      if (config.httpReferer) headers["HTTP-Referer"] = config.httpReferer;
      if (config.appTitle) headers["X-OpenRouter-Title"] = config.appTitle;
      response = await this.fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: config.maxOutputTokens,
          messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      // The provider may have processed the request, so charge the worst case.
      await this.record(request, ledgerKey, model, inputTokens, config.maxOutputTokens, worstCase, true);
      return fail(error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /abort/i.test(error.message)) ? "timeout" : "unavailable");
    } finally { clearTimeout(timer); }

    if (response.status === 429) return fail("rate_limited", 429);
    if (!response.ok) {
      // Surface the provider's own message so a 400 is diagnosable instead of a silent "unavailable".
      const providerMessage = await readProviderMessage(response);
      // A 4xx the provider rejected before generating tokens consumed none, so no spend is recorded.
      // A 5xx may have processed the request server-side, so the worst case is charged.
      if (response.status >= 500) await this.record(request, ledgerKey, model, inputTokens, config.maxOutputTokens, worstCase, true);
      return fail(providerFailureReason(response.status), response.status, providerMessage);
    }
    const data: unknown = await response.json().catch(() => null);
    const body = data && typeof data === "object" ? data as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } : null;
    const promptTokens = body?.usage?.prompt_tokens;
    const completionTokens = body?.usage?.completion_tokens;
    const reported = typeof promptTokens === "number" && typeof completionTokens === "number" && promptTokens >= 0 && completionTokens >= 0;
    const cost = reported ? Math.ceil(promptTokens * config.inputUsdPerMillion + completionTokens * config.outputUsdPerMillion) : worstCase;
    await this.record(request, ledgerKey, model, reported ? promptTokens : inputTokens, reported ? completionTokens : config.maxOutputTokens, cost, !reported);
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return fail("invalid_response", response.status);
    return { ok: true, text, costMicroUsd: cost };
  }

  private async reportFailure(failure: AiAttemptFailure): Promise<void> {
    try { await this.onFailure?.(failure); } catch { /* diagnostics must never break an answer */ }
  }

  private async record(request: AiRequest, ledgerKey: string, model: string, inputTokens: number, outputTokens: number, costMicroUsd: number, estimated: boolean): Promise<void> {
    try {
      await this.ledger.record({ key: ledgerKey, purpose: request.purpose, model, inputTokens, outputTokens, costMicroUsd, estimated, at: this.now() });
    } catch {
      // Spend can no longer be tracked reliably, so stop optional AI for this instance.
      this.tripped = true;
    }
  }
}

/** Maps a provider HTTP status to a diagnosable failure reason. Never includes the status body. */
function providerFailureReason(status: number): AiFailure {
  if (status === 401) return "invalid_credentials";
  if (status === 402 || status === 403 || status === 404) return "model_access";
  if (status >= 500) return "upstream";
  return "unavailable";
}

/** Reads the provider's error body without consuming it for retries; never logs the API key. */
async function readProviderMessage(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return text.slice(0, 500); }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { error?: { message?: unknown } | string | null; message?: unknown };
      const inner = obj.error;
      const message = typeof inner === "string" ? inner : inner && typeof inner === "object" && typeof inner.message === "string" ? inner.message : typeof obj.message === "string" ? obj.message : null;
      if (message) return message.slice(0, 500);
    }
    return text.slice(0, 500);
  } catch {
    return undefined;
  }
}
