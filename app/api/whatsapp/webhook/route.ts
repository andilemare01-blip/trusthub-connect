import { NextRequest, NextResponse } from "next/server";
import { MetaCloudWhatsAppProvider } from "@/lib/whatsapp/meta-cloud-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { SupabaseIdentityResolver } from "@/lib/identity/supabase-repository";
import { SupabaseRuntimeConversationRepository } from "@/lib/conversation-coordinator/supabase-repository";
import { handlePersistentTrustHubTurn } from "@/lib/conversation-coordinator/server-entry";
import { createConversationUnderstandingProvider } from "@/lib/ai/understanding";
import { authorizeWhatsAppWebhook } from "@/lib/whatsapp/webhook-auth";
import { handleMetaWebhookVerification } from "@/lib/whatsapp/webhook-verification";
import { diagnosticError, logWhatsAppDiagnostic } from "@/lib/whatsapp/diagnostics";
import { randomUUID } from "node:crypto";
import { classifyUnusableMetaEvent } from "@/lib/whatsapp/meta-webhook";
import { recordOperationalEvent } from "@/lib/observability/operational-events";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  logWhatsAppDiagnostic(requestId, "webhook_request_received", { outcome: "passed", method: "GET" });
  // Meta's console labels this "Verify token". The longer name is kept as a
  // fallback so an existing deployment cannot silently lose its handshake.
  // Trim and treat blank as unset: a pasted trailing newline/space or an empty
  // primary variable must not defeat the handshake or hide the fallback name.
  const token = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;
  console.log("WHATSAPP VERIFY TOKEN CHECK:", {
  present: Boolean(token),
  length: token?.length ?? 0,
});
  const response = handleMetaWebhookVerification(request.nextUrl.searchParams, token);
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const respond = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
  logWhatsAppDiagnostic(requestId, "webhook_request_received", { outcome: "passed", method: "POST" });
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 1_000_000) return respond({ error: "Webhook payload is too large." }, 413);
    const signature = request.headers.get("x-hub-signature-256");
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) return respond({ error: "Webhook payload is too large." }, 413);
    const provider = new MetaCloudWhatsAppProvider();
    const authorization = authorizeWhatsAppWebhook(provider, rawBody, signature);
    logWhatsAppDiagnostic(requestId, "signature_verification", {
      outcome: authorization === "authorized" || authorization === "outbound_unavailable" ? "passed" : "failed",
      status: authorization,
    });
    if (authorization === "verification_unavailable") {
      console.error(JSON.stringify({ event: "whatsapp.webhook", requestId, outcome: "webhook_verification_unavailable" }));
      return respond({ error: "WhatsApp webhook verification is not configured." }, 503);
    }
    if (authorization === "unauthorized") {
      console.warn(JSON.stringify({ event: "whatsapp.webhook", requestId, outcome: "authentication_failed" }));
      return respond({ error: "Webhook authentication failed." }, 401);
    }
    if (authorization === "outbound_unavailable") {
      console.error(JSON.stringify({ event: "whatsapp.webhook", requestId, outcome: "outbound_configuration_unavailable" }));
      return respond({ error: "WhatsApp outbound delivery is not configured." }, 503);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      logWhatsAppDiagnostic(requestId, "payload_parsed", { outcome: "failed", ...diagnosticError(error) });
      return respond({ error: "Invalid webhook payload." }, 400);
    }
    logWhatsAppDiagnostic(requestId, "payload_parsed", { outcome: "passed" });
    let message;
    try {
      message = await provider.parseIncomingWebhook(payload);
    } catch (error) {
      logWhatsAppDiagnostic(requestId, "sender_message_normalized", { outcome: "failed", ...diagnosticError(error) });
      throw error;
    }
    if (!message) {
      const classification = classifyUnusableMetaEvent(payload);
      logWhatsAppDiagnostic(requestId, "sender_message_normalized", { outcome: "skipped", reason: classification.kind === "status_update" ? "status_update" : "no_usable_message", eventKind: classification.kind, statuses: classification.statuses, messages: classification.messages, ...(classification.reason ? { detail: classification.reason } : {}) });
      // Delivery receipts are routine; only a message that arrived but could not be read is worth recording.
      if (classification.kind !== "status_update") await recordOperationalEvent(createSupabaseServerClient(), { kind: "skipped_message", sourceId: requestId, correlationId: requestId, actor: "provider", attributes: { reason: classification.reason ?? classification.kind, messages: classification.messages } });
      return respond({ received: true });
    }
    logWhatsAppDiagnostic(requestId, "sender_message_normalized", { outcome: "passed", textLength: message.text.length, mediaCount: message.media.length });
    const client = createSupabaseServerClient();
    const understanding = await createConversationUnderstandingProvider(client).understand(message.text, { idempotencyKey: message.providerMessageId });
    console.info(JSON.stringify({ event: "whatsapp.inbound", requestId, providerMessageId: message.providerMessageId, mediaCount: message.media.length }));

    const identityResolver = new SupabaseIdentityResolver(client);
    let identity;
    try {
      identity = await identityResolver.resolveByPhoneNumber(message.senderPhoneNumber);
      if (!identity.whatsAppIdentity) identity = { ...identity, whatsAppIdentity: await identityResolver.ensureWhatsAppIdentity(message.senderPhoneNumber) };
    } catch (error) {
      logWhatsAppDiagnostic(requestId, "whatsapp_identity_resolved", { outcome: "failed", ...diagnosticError(error) });
      logWhatsAppDiagnostic(requestId, "profile_resolved", { outcome: "failed", ...diagnosticError(error) });
      throw error;
    }
    console.info(JSON.stringify({ event: "whatsapp.identity_resolution", requestId, status: identity.status }));
    logWhatsAppDiagnostic(requestId, "whatsapp_identity_resolved", { outcome: "passed", status: identity.status });
    logWhatsAppDiagnostic(requestId, "profile_resolved", { outcome: identity.profile ? "passed" : "skipped", status: identity.status });
    const context = {
      channel: "whatsapp" as const,
      whatsappIdentityId: identity.whatsAppIdentity?.id ?? null,
      profileId: identity.profile?.id ?? null,
      communityId: null,
      area: null,
    };
    if (identity.status !== "linked_existing_profile") {
      console.info(JSON.stringify({ event: "whatsapp.identity_resolution", requestId, status: "guest_continuation" }));
    }
    console.info(JSON.stringify({ event: "whatsapp.intent", requestId, source: understanding.source, aiProviderStatus: understanding.aiProviderStatus, answerability: understanding.answerability, urgency: understanding.urgency, escalation: understanding.escalation }));
    const repository = new SupabaseRuntimeConversationRepository(client, requestId);
    const result = await handlePersistentTrustHubTurn({
      text: message.text,
      request: understanding.request ?? undefined,
      providerMessageId: message.providerMessageId,
      media: message.media,
      contributionCandidate: understanding.contribution,
      understanding,
      correlationId: requestId,
    }, context);
    if (result.duplicate && result.alreadyDelivered) {
      await recordOperationalEvent(client, { kind: "duplicate_webhook", sourceId: `${message.providerMessageId}:${requestId}`, correlationId: result.conversationId, actor: "provider" });
      return respond({ received: true, duplicate: true });
    }
    let delivery;
    try {
      delivery = await provider.sendMessage({ toPhoneNumber: message.senderPhoneNumber, text: result.reply, correlationId: requestId });
    } catch (error) {
      await recordOperationalEvent(client, { kind: "outbound_failed", sourceId: requestId, correlationId: result.conversationId, actor: "provider", attributes: { detail: error instanceof Error ? error.message.slice(0, 100) : "unknown" } });
      throw error;
    }
    if (delivery) {
      logWhatsAppDiagnostic(requestId, "outbound_delivery_persistence", { outcome: "attempted" });
      try {
        await repository.recordOutboundDelivery(result.conversationId, delivery);
        logWhatsAppDiagnostic(requestId, "outbound_delivery_persistence", { outcome: "passed" });
      } catch (error) {
        logWhatsAppDiagnostic(requestId, "outbound_delivery_persistence", { outcome: "failed", ...diagnosticError(error) });
        throw error;
      }
    } else logWhatsAppDiagnostic(requestId, "outbound_delivery_persistence", { outcome: "skipped", reason: "no_delivery_metadata" });
    console.info(JSON.stringify({ event: "whatsapp.outbound", requestId, providerMessageId: delivery?.providerMessageId ?? null, state: result.state, duplicate: result.duplicate, contributionRecorded: !!result.contributionId, durationMs: Date.now() - startedAt }));
    return respond({ received: true });
  } catch (error) {
    // The operator needs the cause; nothing here carries a payload, a token or
    // a request body, only the runtime's own failure text.
    const failure = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
    console.error(JSON.stringify({ event: "whatsapp.webhook", requestId, outcome: "failed", errorType: error instanceof Error ? error.name : "unknown", failure, durationMs: Date.now() - startedAt }));
    logWhatsAppDiagnostic(requestId, "webhook_processing_failed", { outcome: "failed", ...diagnosticError(error), durationMs: Date.now() - startedAt });
    try { await recordOperationalEvent(createSupabaseServerClient(), { kind: "processing_failed", sourceId: requestId, correlationId: requestId, actor: "system", attributes: { stage: error instanceof Error ? error.name.slice(0, 60) : "unknown" } }); } catch { /* the failure is already logged */ }
    return respond({ error: "Webhook processing is temporarily unavailable." }, 503);
  }
}
