import { NextRequest, NextResponse } from "next/server";
import { createAIOrchestrator, NotConnectedError } from "@/lib/ai";
import type { AIOrchestrator } from "@/lib/ai";
import { readAiConfig } from "@/lib/ai/config";
import { isReplyRequest } from "@/lib/ai/reply-request";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { SupabaseConfigurationError } from "@/lib/trusthub/supabase-types";

/** AI reply endpoint. Reads OPENROUTER_API_KEY only on the server. */

/**
 * Builds the orchestrator once the request is known to be
 * well-formed. A missing AI key is the more specific diagnosis,
 * so an unconfigured provider is reported even when Supabase is
 * also unavailable; a configured provider that cannot reach its
 * spend ledger is a temporary server failure.
 */
function buildOrchestrator(): { orchestrator: AIOrchestrator } | { status: 501 | 503; error: string } {
  if (!readAiConfig().enabled) return { status: 501, error: "AI provider is not configured: set OPENROUTER_API_KEY." };
  try {
    return { orchestrator: createAIOrchestrator(createSupabaseServerClient()) };
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      console.error(JSON.stringify({ event: "ai.reply", outcome: "spend_ledger_unavailable" }));
      return { status: 503, error: "AI reply is temporarily unavailable." };
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  // The body is validated before any provider or database access, so an
  // invalid request is a 400 regardless of whether the AI is configured.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isReplyRequest(body)) {
    return NextResponse.json(
      { error: "Request body must include a non-empty conversationId and userMessage; history is optional." },
      { status: 400 }
    );
  }

  const built = buildOrchestrator();
  if ("status" in built) return NextResponse.json({ error: built.error }, { status: built.status });

  try {
    const result = await built.orchestrator.generateReply(body);
    // A provider failure is never disguised as a successful AI answer: the
    // reply carries its source, and the full diagnostic (including the
    // provider's own message) is written to the protected server log while
    // the client receives only the safe reason category.
    if (result.source === "fallback" && result.diagnostic) {
      console.error(JSON.stringify({
        event: "ai.reply",
        outcome: "provider_fallback",
        reason: result.diagnostic.reason,
        ...(result.diagnostic.providerMessage ? { providerMessage: result.diagnostic.providerMessage.slice(0, 300) } : {}),
      }));
    }
    return NextResponse.json({
      text: result.text,
      source: result.source,
      shouldEscalateToAgent: result.shouldEscalateToAgent,
      ...(result.diagnostic ? { diagnostic: { reason: result.diagnostic.reason } } : {}),
    });
  } catch (error) {
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    // An unexpected internal failure is logged with its type but no payload,
    // and reported as a temporary failure rather than a bad request.
    console.error(JSON.stringify({ event: "ai.reply", outcome: "failed", errorType: error instanceof Error ? error.name : "unknown" }));
    return NextResponse.json({ error: "AI reply is temporarily unavailable." }, { status: 503 });
  }
}
