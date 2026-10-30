export const DEFAULT_AI_SPEND_LIMIT_USD = 50;

/** Server-side only. Every cost field is required: unknown pricing keeps AI off rather than guessing a cost. */
export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Models tried in order when the chosen one is unavailable (retired, rate-limited or unreachable). Starts with `model`. */
  models: string[];
  /** USD per one million tokens, from the provider's published price list for the configured model. */
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  spendLimitMicroUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Optional OpenRouter attribution headers. Never contains secrets. */
  httpReferer?: string;
  appTitle?: string;
}

export type AiConfigStatus = { enabled: true; config: AiConfig } | { enabled: false; reason: string };

/** OpenRouter's published price for every `:free` model: zero. Free models are rate-limited, never credit-limited. */
export const FREE_MODEL_INPUT_USD_PER_MILLION = 0;
export const FREE_MODEL_OUTPUT_USD_PER_MILLION = 0;

/** Default OpenRouter chat-completions endpoint. Overridable with AI_PROVIDER_BASE_URL. */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter's free router: it sends each call to a free model that is working at the time. Used when AI_PROVIDER_MODEL is not set. */
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

/**
 * Tried after the configured model when it fails for a reason another model
 * may not share (retired model, rate limit, provider outage). Free models come
 * and go on OpenRouter, so this list is a starting point to verify, not a promise.
 * Set AI_PROVIDER_MODEL to a cheap paid model for reliable answers.
 */
export const FALLBACK_OPENROUTER_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-26b-a4b-it:free",
];

function positive(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Allows zero, which is the published price for every `:free` OpenRouter model. */
function nonNegative(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Env names (new): AI_PROVIDER_API_KEY, AI_PROVIDER_MODEL, AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS,
 * AI_PROVIDER_OUTPUT_USD_PER_MILLION_TOKENS; optional AI_PROVIDER_BASE_URL, AI_SPEND_LIMIT_USD,
 * AI_MAX_INPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, AI_TIMEOUT_MS, AI_PROVIDER_HTTP_REFERER, AI_PROVIDER_APP_TITLE.
 * 
 * Backward compat (deprecated): OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_INPUT_USD_PER_MILLION_TOKENS,
 * OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS, OPENROUTER_BASE_URL, OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE.
 *
 * The API key is read only on the server and never sent to the browser, logs, source control
 * or model prompts. Free `:free` models are used by default; this code never selects or
 * switches to a paid model and never purchases credits.
 */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfigStatus {
  const apiKey = (env.AI_PROVIDER_API_KEY ?? env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) return { enabled: false, reason: "missing_api_key" };
  const model = ((env.AI_PROVIDER_MODEL?.trim() ?? env.OPENROUTER_MODEL?.trim()) || DEFAULT_OPENROUTER_MODEL);
  const inputUsdPerMillion = nonNegative(env.AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS ?? env.OPENROUTER_INPUT_USD_PER_MILLION_TOKENS ?? String(FREE_MODEL_INPUT_USD_PER_MILLION));
  const outputUsdPerMillion = nonNegative(env.AI_PROVIDER_OUTPUT_USD_PER_MILLION_TOKENS ?? env.OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS ?? String(FREE_MODEL_OUTPUT_USD_PER_MILLION));
  if (inputUsdPerMillion === null || outputUsdPerMillion === null) return { enabled: false, reason: "unknown_pricing" };
  const extra = (env.AI_PROVIDER_FALLBACK_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const models = [...new Set([model, ...extra, ...FALLBACK_OPENROUTER_MODELS])].slice(0, 6);
  const baseUrl = ((env.AI_PROVIDER_BASE_URL?.trim() ?? env.OPENROUTER_BASE_URL?.trim()) || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl)) return { enabled: false, reason: "insecure_base_url" };
  const limitUsd = positive(env.AI_SPEND_LIMIT_USD) ?? DEFAULT_AI_SPEND_LIMIT_USD;
  return {
    enabled: true,
    config: {
      apiKey, baseUrl, model, models, inputUsdPerMillion, outputUsdPerMillion,
      spendLimitMicroUsd: Math.round(limitUsd * 1_000_000),
      // Wisdom's brain reads a town's searches, prices, news and listings in one call, so it needs room.
      maxInputTokens: Math.min(positive(env.AI_MAX_INPUT_TOKENS) ?? 6000, 16000),
      maxOutputTokens: Math.min(positive(env.AI_MAX_OUTPUT_TOKENS) ?? 600, 1500),
      timeoutMs: Math.min(positive(env.AI_TIMEOUT_MS) ?? 12000, 20000),
      httpReferer: (env.AI_PROVIDER_HTTP_REFERER?.trim() ?? env.OPENROUTER_HTTP_REFERER?.trim()) || undefined,
      appTitle: (env.AI_PROVIDER_APP_TITLE?.trim() ?? env.OPENROUTER_APP_TITLE?.trim()) || undefined,
    },
  };
}
