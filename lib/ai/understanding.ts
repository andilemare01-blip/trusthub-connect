import type { NormalizedRequest } from "../answer-resolution/types.ts";
import type { DetectedContribution } from "../contributions/detection.ts";
import { detectContribution } from "../contributions/detection.ts";
import { parseLocalSearchRequest } from "../whatsapp/intent-parser.ts";
import { recognizeNonSearchIntent } from "../conversation-coordinator/intents.ts";
import { AiGateway } from "./gateway.ts";
import { readAiConfig } from "./config.ts";
import { RuntimeEventAiSpendLedger } from "./spend-ledger.ts";
import type { SupabaseDataClient } from "../supabase/data-client.ts";

export interface StructuredUnderstanding {
  source: "deterministic" | "ai_assisted";
  /** `unavailable`: no AI configured; `not_needed`: deterministic handled it; `used`: AI interpreted it; `fallback`: AI was tried or blocked and deterministic handling continued. */
  aiProviderStatus: "unavailable" | "not_needed" | "used" | "fallback";
  request: NormalizedRequest | null;
  contribution: DetectedContribution | null;
  urgency: "normal" | "urgent" | "emergency";
  answerability: "ready_to_search" | "needs_location" | "needs_category" | "contribution_candidate" | "needs_human" | "profile_creation" | "unknown";
  clarificationQuestion: string | null;
  escalation: "none" | "community" | "human";
}

export interface UnderstandOptions {
  /** Stable per inbound message (its provider message id) so a redelivery never triggers a second AI call. */
  idempotencyKey?: string;
}

/** Provider seam for structured AI interpretation. It cannot return local facts or verification claims. */
export interface ConversationUnderstandingProvider {
  understand(text: string, options?: UnderstandOptions): Promise<StructuredUnderstanding>;
}

function build(text: string, request: NormalizedRequest | null): StructuredUnderstanding {
  const contribution = detectContribution(text);
  const nonSearch = request === null ? recognizeNonSearchIntent(text) : null;
  const normalized = text.trim().toLocaleLowerCase();
  const emergency = /\b(emergency|danger|life[- ]?threatening|need an ambulance)\b/.test(normalized);
  const human = /\b(speak to|talk to|need|request) (?:a )?(?:human|person|trust agent|agent)\b/.test(normalized);
  const urgency = emergency ? "emergency" : /\b(urgent(?:ly)?|asap|immediately|today)\b/.test(normalized) ? "urgent" : "normal";
  const escalation = human || emergency ? "human" : /\b(ask|contact|tell) (?:my )?(?:community|neighbors|neighbours)\b/.test(normalized) ? "community" : "none";
  const effectiveRequest = (request ?? nonSearch?.request ?? null);
  const answerability = contribution ? "contribution_candidate"
    : human || emergency ? "needs_human"
    : effectiveRequest && effectiveRequest.questionType === "profile_creation" ? "profile_creation"
    : effectiveRequest && effectiveRequest.intent === "add_business" ? "contribution_candidate"
    : effectiveRequest && effectiveRequest.intent === "review_experience" ? "contribution_candidate"
    : effectiveRequest && effectiveRequest.questionType === "reputation" && effectiveRequest.intent !== "get_reviews" ? "contribution_candidate"
    : effectiveRequest && !effectiveRequest.category && (effectiveRequest.questionType === "business_discovery" || effectiveRequest.questionType === "provider_recommendation") ? "needs_category"
    : effectiveRequest && !effectiveRequest.location?.city && (effectiveRequest.questionType === "business_discovery" || effectiveRequest.questionType === "provider_recommendation") ? "needs_location"
    : effectiveRequest ? "ready_to_search"
    : "unknown";
  const clarificationQuestion = answerability === "needs_location" ? "Which city should I look in? An area is optional."
    : answerability === "needs_category" ? request?.ambiguity?.question ?? "What type of business or service are you looking for?"
    : null;
  return { source: "deterministic", aiProviderStatus: "unavailable", request: effectiveRequest, contribution, urgency, answerability, clarificationQuestion, escalation };
}

export class DeterministicUnderstandingProvider implements ConversationUnderstandingProvider {
  async understand(text: string): Promise<StructuredUnderstanding> {
    const searchRequest = parseLocalSearchRequest(text);
    if (searchRequest) return build(text, searchRequest);
    const recognized = recognizeNonSearchIntent(text);
    return build(text, recognized?.request ?? null);
  }
}

const MAX_AI_MESSAGE_CHARS = 400;
const GREETING_OR_ACK = /^(?:hi|hie|hey|hello|thanks?|thank you|ok(?:ay)?|yes|no|good (?:morning|afternoon|evening))\b/i;

/** Removes numbers and addresses that identify a person before text leaves the server. */
export function redactForAi(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .trim()
    .slice(0, MAX_AI_MESSAGE_CHARS);
}

const SYSTEM_PROMPT = "You extract a local business or service search from one WhatsApp message in Zimbabwe. "
  + "Reply with JSON only: {\"is_search\":boolean,\"category\":string|null,\"city\":string|null,\"area\":string|null,\"wants_recommendation\":boolean}. "
  + "Use null when a detail is not stated. Never answer the question, never invent a place or business.";

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.trim().length <= 60 ? value.trim().replace(/[\r\n]+/g, " ") : null;
}

/** Deterministic parsing always runs first; AI is consulted only for free-text messages it cannot parse. */
export class AiAssistedUnderstandingProvider implements ConversationUnderstandingProvider {
  private readonly fallback = new DeterministicUnderstandingProvider();
  private readonly gateway: AiGateway;
  constructor(gateway: AiGateway) { this.gateway = gateway; }

  async understand(text: string, options: UnderstandOptions = {}): Promise<StructuredUnderstanding> {
    const base = await this.fallback.understand(text);
    if (!this.gateway.enabled) return base;
    const eligible = base.answerability === "unknown" && base.urgency === "normal" && base.escalation === "none"
      && text.trim().split(/\s+/).length >= 4 && text.length <= 600 && !GREETING_OR_ACK.test(text.trim());
    if (!eligible) return { ...base, aiProviderStatus: "not_needed" };
    const result = await this.gateway.complete({
      key: `${options.idempotencyKey ?? `text:${text.length}:${text.slice(0, 40)}`}:interpret`,
      purpose: "interpret", system: SYSTEM_PROMPT, user: redactForAi(text), json: true,
    });
    if (!result.ok) return { ...base, aiProviderStatus: "fallback" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(result.text) as Record<string, unknown>; } catch { return { ...base, aiProviderStatus: "fallback" }; }
    const category = clean(parsed.category);
    if (parsed.is_search !== true || !category) return { ...base, aiProviderStatus: "fallback" };
    const recommendation = parsed.wants_recommendation === true;
    const request: NormalizedRequest = {
      text: text.trim(), intent: recommendation ? "find_provider" : "find_business", category,
      location: { country: "Zimbabwe", city: clean(parsed.city), area: clean(parsed.area) },
      questionType: recommendation ? "provider_recommendation" : "business_discovery",
    };
    return { ...build(text, request), source: "ai_assisted", aiProviderStatus: "used" };
  }
}

/** AI is used only with complete server-side configuration and a spend ledger; otherwise deterministic. */
export function createConversationUnderstandingProvider(client?: SupabaseDataClient, env: Record<string, string | undefined> = process.env): ConversationUnderstandingProvider {
  const status = readAiConfig(env);
  if (!client || !status.enabled) return new DeterministicUnderstandingProvider();
  return new AiAssistedUnderstandingProvider(new AiGateway(status, new RuntimeEventAiSpendLedger(client)));
}
