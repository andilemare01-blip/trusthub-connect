export const DEFAULT_AI_SPEND_LIMIT_USD = 50;

/** Server-side only. Every cost field is required: unknown pricing keeps AI off rather than guessing a cost. */
export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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

/** A currently available free OpenRouter model used when AI_MODEL is not set. Free models rotate; this is a fallback, not a guarantee. */
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";

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
 * Env names: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_INPUT_USD_PER_MILLION_TOKENS,
 * OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS; optional OPENROUTER_BASE_URL, AI_SPEND_LIMIT_USD,
 * AI_MAX_INPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, AI_TIMEOUT_MS, OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE.
 *
 * The API key is read only on the server and never sent to the browser, logs, source control
 * or model prompts. Free `:free` models are used by default; this code never selects or
 * switches to a paid model and never purchases credits.
 */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfigStatus {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return { enabled: false, reason: "missing_api_key" };
  const model = (env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL);
  const inputUsdPerMillion = nonNegative(env.OPENROUTER_INPUT_USD_PER_MILLION_TOKENS ?? String(FREE_MODEL_INPUT_USD_PER_MILLION));
  const outputUsdPerMillion = nonNegative(env.OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS ?? String(FREE_MODEL_OUTPUT_USD_PER_MILLION));
  if (inputUsdPerMillion === null || outputUsdPerMillion === null) return { enabled: false, reason: "unknown_pricing" };
  const baseUrl = (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl)) return { enabled: false, reason: "insecure_base_url" };
  const limitUsd = positive(env.AI_SPEND_LIMIT_USD) ?? DEFAULT_AI_SPEND_LIMIT_USD;
  return {
    enabled: true,
    config: {
      apiKey, baseUrl, model, inputUsdPerMillion, outputUsdPerMillion,
      spendLimitMicroUsd: Math.round(limitUsd * 1_000_000),
      maxInputTokens: Math.min(positive(env.AI_MAX_INPUT_TOKENS) ?? 1200, 8000),
      maxOutputTokens: Math.min(positive(env.AI_MAX_OUTPUT_TOKENS) ?? 300, 1500),
      timeoutMs: Math.min(positive(env.AI_TIMEOUT_MS) ?? 8000, 20000),
      httpReferer: env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
      appTitle: env.OPENROUTER_APP_TITLE?.trim() || undefined,
    },
  };
}
