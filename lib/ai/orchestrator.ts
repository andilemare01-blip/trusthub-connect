import { AiGateway, type AiFailure } from "./gateway.ts";
import { readAiConfig } from "./config.ts";
import { RuntimeEventAiSpendLedger } from "./spend-ledger.ts";
import { InMemoryAiSpendLedger } from "./spend-ledger.ts";
import type { SupabaseDataClient } from "../supabase/data-client.ts";
import { redactForAi } from "./understanding.ts";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(
      `AIOrchestrator.${method} is not connected yet. No AI provider credentials have been configured.`
    );
    this.name = "NotConnectedError";
  }
}

export interface AIReplyRequest {
  conversationId: string;
  userMessage: string;
  /** Prior turns, most recent last. Optional; kept small/opaque here on purpose. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface AIReplyResult {
  text: string;
  /** Whether the orchestrator believes a human Trust Agent should take over. */
  shouldEscalateToAgent: boolean;
  /**
   * `"ai"` when the provider produced the reply; `"fallback"` when a
   * safe local reply was used because the provider failed. A fallback is
   * never reported as a successful AI answer.
   */
  source: "ai" | "fallback";
  /**
   * Present only when `source` is `"fallback"`. The internal failure
   * category (and the provider's own message, when it returned one) so
   * the failure can be investigated server-side. Never contains the API
   * key, authorization headers, or the user's message content.
   */
  diagnostic?: { reason: AiFailure; providerMessage?: string };
}

/**
 * Provider-agnostic AI orchestration surface. The concrete provider is OpenRouter
 * (see lib/ai/config.ts); this file is deliberately provider-agnostic at the
 * interface level so the rest of the app never imports a provider directly.
 */
export interface AIOrchestrator {
  generateReply(request: AIReplyRequest): Promise<AIReplyResult>;
}

const SYSTEM_PROMPT =
  "You are the TrustHub Connect assistant, helping a person over WhatsApp in Zimbabwe. "
  + "Answer using only the conversation history and facts given to you. Never invent businesses, "
  + "verification statuses, prices or outcomes. Never ask for or repeat passwords, one-time codes, "
  + "access tokens or recovery secrets. If you do not know something, say so and offer the next step. "
  + "Keep the reply short and natural, as one WhatsApp message.";

/** Builds a single user-side prompt from history plus the new message. */
function buildUserPrompt(request: AIReplyRequest): string {
  const recent = (request.history ?? []).slice(-6);
  const transcript = recent.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n");
  return `${transcript}\nUser: ${request.userMessage}\nAssistant:`;
}

/** A deterministic fallback reply used when the provider is unavailable, so the user is never silent. */
function fallbackReply(request: AIReplyRequest): string {
  const lower = request.userMessage.trim().toLowerCase();
  if (/\b(hi|hello|hey|hie|good (morning|afternoon|evening))\b/.test(lower)) {
    return "Hi! I'm the TrustHub Connect assistant. I can help you find businesses and services, share a community contribution, or point you at profile and account help. What would you like to do?";
  }
  return "I'm having trouble reaching the AI assistant right now. Please try again in a moment, or tell me what you're looking for and I'll help using TrustHub's own records.";
}

export class OpenRouterAIOrchestrator implements AIOrchestrator {
  private readonly gateway: AiGateway;

  constructor(gateway: AiGateway) { this.gateway = gateway; }

  async generateReply(request: AIReplyRequest): Promise<AIReplyResult> {
    const result = await this.gateway.complete({
      key: `${request.conversationId}:reply:${request.userMessage.length}:${request.userMessage.slice(0, 40)}`,
      purpose: "reply",
      system: SYSTEM_PROMPT,
      user: redactForAi(buildUserPrompt(request)),
    });
    if (!result.ok) {
      // A provider failure is never disguised as a successful AI answer: the
      // safe local fallback is returned with `source: "fallback"` plus the
      // internal reason so the failure is diagnosable. Transient provider
      // outages may warrant a human handoff; configuration errors do not.
      const reason = result.reason;
      const transient = reason === "unavailable" || reason === "timeout" || reason === "upstream";
      return {
        text: fallbackReply(request),
        shouldEscalateToAgent: transient,
        source: "fallback",
        diagnostic: { reason, ...(result.providerMessage ? { providerMessage: result.providerMessage } : {}) },
      };
    }
    return { text: result.text.trim(), shouldEscalateToAgent: false, source: "ai" };
  }
}

/**
 * Build the orchestrator from the current server-side configuration. Pass the
 * Supabase client so spend tracking uses the real ledger; without a client an
 * in-memory ledger is used so the orchestrator can still function (it simply
 * cannot persist spend across restarts).
 */
export function createAIOrchestrator(client?: SupabaseDataClient): AIOrchestrator {
  const status = readAiConfig();
  if (!status.enabled) return new NotConnectedAIOrchestrator();
  const ledger = client ? new RuntimeEventAiSpendLedger(client) : new InMemoryAiSpendLedger();
  return new OpenRouterAIOrchestrator(new AiGateway(status, ledger));
}

class NotConnectedAIOrchestrator implements AIOrchestrator {
  async generateReply(): Promise<AIReplyResult> {
    throw new NotConnectedError("generateReply");
  }
}