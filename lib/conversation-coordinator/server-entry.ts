import "server-only";
import { SupabaseConfigurationError } from "../trusthub/supabase-types";
import { createSupabaseServerClient } from "../supabase/server-client";
import { createServerTrustHubClient } from "../trusthub/server-client";
import { createConversationRuntime } from "./runtime";
import { SupabaseRuntimeConversationRepository, type StartPersistentConversation } from "./supabase-repository";
import type { IncomingTurn } from "./types";
import { SupabaseKnowledgeRecordReader, type KnowledgeRecordReadClient } from "../trusthub/knowledge-record-read-adapter";
import { detectContribution } from "../contributions/detection";
import { SupabaseContributionRepository } from "../contributions/supabase-repository";
import { SupabaseServiceRequestRepository } from "../requests/supabase-repository";
import { recordRequestOutcomeConfirmation } from "../requests/confirm-outcome";
import { createRequestIdempotencyKey } from "../requests/idempotency";
import { COMMUNITY_HELP_CONSENT_VERSION, createOrGetCommunityHelpRequest } from "../community/help-requests";
import { SupabaseCommunityHelpRequestRepository } from "../community/supabase-help-request-repository";
import { createCityLevelOrFullCommunityKey } from "@/types/community";
import { SupabaseRuntimeEventRecorder } from "../observability/supabase-recorder";
import { createRuntimeEventId } from "../observability/events";
import { resolveCommunityFromPendingRequest } from "./community-follow-up.ts";
import { readAiConfig } from "../ai/config.ts";
import { AiGateway } from "../ai/gateway.ts";
import { AiAnswerGenerator } from "../ai/answer-generator.ts";
import { RuntimeEventAiSpendLedger } from "../ai/spend-ledger.ts";
import { createAnswerGenerator } from "../answer-resolution/response-generator.ts";
import { RuntimeEventSearchTaskLedger } from "../usage/search-tasks.ts";
import { recordOperationalEvent } from "../observability/operational-events.ts";
import { diagnosticError, logWhatsAppDiagnostic } from "../whatsapp/diagnostics.ts";

export type TrustedTurnContext = StartPersistentConversation;

export async function handlePersistentTrustHubTurn(
  turn: Omit<IncomingTurn, "conversationId">,
  trustedContext: TrustedTurnContext,
) {
  const startedAt = Date.now();
  if (turn.correlationId) logWhatsAppDiagnostic(turn.correlationId, "persistent_turn_entered", { outcome: "passed" });
  const client = createSupabaseServerClient();
  const trustHubClient = createServerTrustHubClient();
  const knowledgeRecordReader = new SupabaseKnowledgeRecordReader(client as unknown as KnowledgeRecordReadClient);
  const contributionCandidate = turn.contributionCandidate === undefined ? detectContribution(turn.text) : turn.contributionCandidate;
  let persistenceContext = trustedContext;
  const city = turn.request?.location?.city?.trim() ?? contributionCandidate?.city?.trim();
  if (!city && !persistenceContext.communityId) persistenceContext = { ...trustedContext, reuseLatestOpenConversation: true };
  if (!persistenceContext.communityId && city) {
    const country = turn.request?.location?.country?.trim() ?? (contributionCandidate?.city ? "Zimbabwe" : null);
    const communities = await trustHubClient.listCommunitiesByLocation(country, city);
    const exactMatches = communities.filter((community) => community.city.trim().toLocaleLowerCase() === city.toLocaleLowerCase()
      && (!country || community.country.trim().toLocaleLowerCase() === country.toLocaleLowerCase()));
    console.info(JSON.stringify({ event: "whatsapp.community_resolution", requestId: turn.correlationId ?? null, status: exactMatches.length ? "checked" : "empty", candidateCount: exactMatches.length }));
    if (exactMatches.length === 1) persistenceContext = { ...trustedContext, communityId: exactMatches[0].id };
  }
  const repository = new SupabaseRuntimeConversationRepository(client, turn.correlationId);
  let conversationId: string;
  try {
    conversationId = await repository.findOrStartConversation(persistenceContext);
  } catch (error) {
    if (turn.correlationId) logWhatsAppDiagnostic(turn.correlationId, "conversation_resolved_or_created", { outcome: "failed", ...diagnosticError(error), durationMs: Date.now() - startedAt });
    throw error;
  }
  if (turn.correlationId) {
    logWhatsAppDiagnostic(turn.correlationId, "conversation_resolved_or_created", { outcome: "passed", conversationId });
  }
  if (!persistenceContext.communityId && !city) {
    const pendingCommunityId = await resolveCommunityFromPendingRequest(repository, trustHubClient, conversationId);
    if (pendingCommunityId) persistenceContext = { ...persistenceContext, communityId: pendingCommunityId };
  }  const duplicate = turn.providerMessageId ? await repository.getByProviderMessageId(turn.providerMessageId) : null;
  let result;
  const aiStatus = readAiConfig();
  const answerGenerator = aiStatus.enabled && turn.providerMessageId
    ? new AiAnswerGenerator(createAnswerGenerator(), new AiGateway(aiStatus, new RuntimeEventAiSpendLedger(client)), turn.providerMessageId)
    : undefined;
  try {
    result = await createConversationRuntime({ trustHubClient, repository, knowledgeRecordReader, contributionReader: new SupabaseContributionRepository(client), answerGenerator }).handleTurn({
      ...turn,
      contributionCandidate,
      conversationId,
      channel: persistenceContext.channel,
      profileLinked: !!persistenceContext.profileId,
    });
  } catch (error) {
    if (turn.correlationId) logWhatsAppDiagnostic(turn.correlationId, "conversation_coordinator_completed", { outcome: "failed", ...diagnosticError(error), durationMs: Date.now() - startedAt });
    throw error;
  }
  if (turn.correlationId) {
    logWhatsAppDiagnostic(turn.correlationId, "conversation_coordinator_completed", {
      outcome: "passed",
      state: result.state,
      resolutionStatus: result.resolution?.status ?? "none",
      durationMs: Date.now() - startedAt,
    });
  }
  if (result.notificationPreference && persistenceContext.whatsappIdentityId) {
    await recordOperationalEvent(client, {
      kind: "notification_preference", sourceId: turn.providerMessageId ?? `${conversationId}:${Date.now()}`, correlationId: `identity:${persistenceContext.whatsappIdentityId}`,
      actor: "user", attributes: { level: result.notificationPreference },
    });
  }
  if (result.completedTask && persistenceContext.whatsappIdentityId) {
    // A bookkeeping failure must not cost the user their answer; the task id keeps a later retry idempotent.
    try {
      await new RuntimeEventSearchTaskLedger(client).recordCompleted({ identityId: persistenceContext.whatsappIdentityId, taskId: result.completedTask.taskId, at: new Date().toISOString() });
    } catch (error) {
      console.error(JSON.stringify({ event: "usage.task_record_failed", requestId: turn.correlationId ?? null, ...diagnosticError(error) }));
    }
  }
  const inboundIndex = duplicate?.messages.findIndex((message) => message.providerMessageId === turn.providerMessageId) ?? -1;
  const alreadyDelivered = inboundIndex >= 0 && duplicate!.messages.slice(inboundIndex + 1)
    .some((message) => message.direction === "outbound" && !!message.providerMessageId);
  let contributionId: string | null = null;
  if (contributionCandidate && turn.providerMessageId) {
    if (!persistenceContext.profileId) throw new Error("Cannot persist a contribution without a canonical TrustHub profile.");
    const sourceMessageId = await repository.getDatabaseMessageIdByProviderMessageId(turn.providerMessageId);
    if (!sourceMessageId) throw new Error("Cannot persist a contribution without its stored source message.");
    contributionId = await new SupabaseContributionRepository(client).recordDetectedContribution({
      candidate: contributionCandidate,
      contributorProfileId: persistenceContext.profileId,
      communityId: persistenceContext.communityId,
      conversationId,
      sourceMessageId,
    });
  }
  let helpRequestId: string | null = null;
  if (result.communityConsentGranted) {
    const request = result.conversation.lastRequest;
    const communityId = result.conversation.persistence?.communityId ?? persistenceContext.communityId;
    const profileId = result.conversation.persistence?.profileId ?? persistenceContext.profileId;
    const country = request?.location?.country?.trim();
    const cityName = request?.location?.city?.trim();
    const consentAt = result.communityConsentAt;
if (!turn.providerMessageId || !profileId || !communityId || !request || !country || !cityName || !consentAt) {
      // Naming the missing precondition keeps this diagnosable from the server
      // log instead of leaving one generic message for four different causes.
      const missing = [
        !turn.providerMessageId ? "stored message id" : null,
        !profileId ? "linked TrustHub profile" : null,
        !communityId ? "resolved community for the requested city" : null,
        !request ? "the answered request" : null,
        !country ? "request country" : null,
        !cityName ? "request city" : null,
        !consentAt ? "recorded consent timestamp" : null,
      ].filter(Boolean).join(", ");
      console.error(JSON.stringify({ event: "whatsapp.community_consent_incomplete", correlationId: turn.correlationId ?? null, conversationId, communityId: communityId ?? null, profileId: profileId ?? null, city: cityName ?? null, missing }));
      throw new Error("Cannot persist community consent without: " + missing + ".");
    }
    const communityKey = createCityLevelOrFullCommunityKey(country, cityName, request.location?.area);
    if (!communityKey) throw new Error("Cannot persist community consent without a valid community key.");
    const persistedRequest = await new SupabaseServiceRequestRepository(client).create({
      conversationId,
      trustHubProfileId: profileId,
      communityKey,
      communityId,
      area: request.location?.area ?? null,
      sourceChannel: persistenceContext.channel,
      requestedCategory: request.category ?? null,
      requestText: request.text,
      intent: request.intent ?? null,
      status: "open",
      resolvedAt: null,
      timeToUsefulAnswerSeconds: null,
      idempotencyKey: createRequestIdempotencyKey(persistenceContext.channel, turn.providerMessageId),
      communityConsentAt: consentAt,
      communityConsentVersion: COMMUNITY_HELP_CONSENT_VERSION,
    });
    helpRequestId = persistedRequest.id;
    const communityRequest = await createOrGetCommunityHelpRequest(new SupabaseCommunityHelpRequestRepository(client), {
      id: persistedRequest.id,
      serviceRequestId: persistedRequest.id,
      communityId,
      communityKey,
      city: cityName,
      area: request.location?.area ?? null,
      category: request.category ?? null,
      question: request.text,
      requesterConsent: true,
      requesterConsentAt: consentAt,
      createdAt: persistedRequest.createdAt,
    });
    await new SupabaseRuntimeEventRecorder(client).record({
      id: createRuntimeEventId("community_help_planned", turn.providerMessageId),
      name: "community_help_planned",
      occurredAt: consentAt,
      correlationId: conversationId,
      actor: "user",
      entityType: "community_help",
      entityId: communityRequest.request.id,
      attributes: { status: communityRequest.request.status, created: communityRequest.created },
    });
  }
  let outcomeConfirmed = false;
  if (result.outcomeConfirmation) {
    outcomeConfirmed = (await recordRequestOutcomeConfirmation(new SupabaseServiceRequestRepository(client), {
      conversationId,
      confirmation: result.outcomeConfirmation,
    })) === "recorded";
  }
  const communityLookupStatus = result.resolution?.communityLookup?.status
    ?? (result.resolution?.sourceAttempts.some((attempt) => attempt.source === "trusthub" && attempt.status === "unavailable") ? "unavailable" : "not_checked");
  console.info(JSON.stringify({ event: "whatsapp.turn_persisted", requestId: turn.correlationId ?? null, state: result.state, resolutionStatus: result.resolution?.status ?? "none", communityLookupStatus, sourceAttempts: result.resolution?.sourceAttempts.map(({ source, status }) => ({ source, status })) ?? [], contributionRecorded: !!contributionId, outcomeConfirmed, durationMs: Date.now() - startedAt }));
  return { ...result, duplicate: !!duplicate, alreadyDelivered, outcomeConfirmed, ...(contributionId ? { contributionId } : {}), ...(helpRequestId ? { helpRequestId } : {}) };
}

/** Error helper for a server caller to distinguish unavailable configuration from no data. */
export function isTrustHubServerConfigurationError(error: unknown): error is SupabaseConfigurationError {
  return error instanceof SupabaseConfigurationError;
}
