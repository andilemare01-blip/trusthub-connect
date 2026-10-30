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
import { AiGateway, type AiAttemptFailure } from "../ai/gateway.ts";
import { AiAnswerGenerator } from "../ai/answer-generator.ts";
import { RuntimeEventAiSpendLedger } from "../ai/spend-ledger.ts";
import { createAnswerGenerator } from "../answer-resolution/response-generator.ts";
import { RuntimeEventSearchTaskLedger } from "../usage/search-tasks.ts";
import { recordOperationalEvent } from "../observability/operational-events.ts";
import { diagnosticError, logWhatsAppDiagnostic } from "../whatsapp/diagnostics.ts";
import { ConnectJourneys } from "../connect/journeys.ts";
import { SupabaseConnectStore, type ConnectDbClient } from "../connect/supabase-store.ts";
import { createDeepQuestionAnswerer } from "../connect/ask-wisdom.ts";

export type TrustedTurnContext = StartPersistentConversation;

const REFERRAL = /\(?\s*\bref[:\s-]*([A-Za-z0-9]{4,12})\s*\)?/i;

/**
 * Reads the name a person left (whatsapp_identities.display_name) when their TrustHub profile has none, and
 * records the agent behind a referral code in the message (first agent wins), removing the code from the text.
 */
async function personContext(client: ReturnType<typeof createSupabaseServerClient>, identityId: string | number | null, text: string, profileName: string | null): Promise<{ text: string; profileName: string | null }> {
  if (!identityId) return { text, profileName };
  let cleaned = text;
  const ref = REFERRAL.exec(text);
  if (ref) {
    cleaned = text.replace(ref[0], " ").replace(/\s+/g, " ").trim() || "Hi";
    const agent = await client.from("connect_agents").select("id").eq("code", ref[1].toUpperCase()).eq("active", true).limit(1);
    const agentId = Array.isArray(agent.data) ? (agent.data[0] as { id?: unknown } | undefined)?.id : undefined;
    if (agentId) await client.from("connect_referrals").upsert({ whatsapp_identity_id: identityId, agent_id: agentId }, { onConflict: "whatsapp_identity_id", ignoreDuplicates: true });
  }
  if (profileName) return { text: cleaned, profileName };
  const found = await client.from("whatsapp_identities").select("display_name").eq("id", identityId).limit(1);
  const name = Array.isArray(found.data) ? (found.data[0] as { display_name?: unknown } | undefined)?.display_name : null;
  return { text: cleaned, profileName: typeof name === "string" && name.trim() ? name.trim() : null };
}

export async function handlePersistentTrustHubTurn(
  incomingTurn: Omit<IncomingTurn, "conversationId">,
  trustedContext: TrustedTurnContext,
) {
  let turn = incomingTurn;
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
  // A person in the middle of a guided flow or a menu search stays in that
  // conversation even when this message names a city; otherwise the city's
  // own conversation would start and the step they are answering would be lost.
  if (persistenceContext.whatsappIdentityId && !persistenceContext.reuseLatestOpenConversation) {
    const latestId = await repository.findLatestOpenConversationId(persistenceContext);
    const latest = latestId ? await repository.get(latestId) : null;
    if (latest?.connect || latest?.activeJourney) persistenceContext = { ...persistenceContext, reuseLatestOpenConversation: true };
  }
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
  if (!aiStatus.enabled) console.log(JSON.stringify({ event: "ai.disabled", reason: aiStatus.reason }));
  // Every failed provider attempt is recorded with its reason, so an outage or a retired model is visible in the database.
  const aiFailures = (failure: AiAttemptFailure) => {
    const recorder = new SupabaseRuntimeEventRecorder(client);
    const occurredAt = new Date().toISOString();
    return recorder.record({
      id: createRuntimeEventId("ai_call_failed", `${occurredAt}:${failure.model}:${failure.reason}:${Math.random()}`),
      name: "ai_call_failed", occurredAt, correlationId: "ai-failure", actor: "provider", entityType: "conversation", entityId: failure.model.slice(0, 100),
      attributes: { reason: failure.reason, model: failure.model.slice(0, 100), providerStatus: failure.providerStatus ?? null, providerMessage: failure.providerMessage?.slice(0, 200) ?? null },
    }).catch(() => undefined);
  };
  const answerGenerator = aiStatus.enabled && turn.providerMessageId
    ? new AiAnswerGenerator(createAnswerGenerator(), new AiGateway(aiStatus, new RuntimeEventAiSpendLedger(client), undefined, undefined, aiFailures), turn.providerMessageId)
    : undefined;
  const connectStore = new SupabaseConnectStore(client as unknown as ConnectDbClient);
  // The name someone gave Wisdom, and the agent whose link brought them ("Hi (ref TINO1)").
  const person = await personContext(client, persistenceContext.whatsappIdentityId ?? null, turn.text, turn.profileName ?? null).catch(() => ({ text: turn.text, profileName: turn.profileName ?? null }));
  turn = { ...turn, text: person.text, profileName: person.profileName };
  const deepAnswerer = aiStatus.enabled ? createDeepQuestionAnswerer(new AiGateway(aiStatus, new RuntimeEventAiSpendLedger(client), undefined, undefined, aiFailures), connectStore) : undefined;
  const connect = { store: connectStore, journeys: new ConnectJourneys(connectStore, deepAnswerer) };
  try {
    result = await createConversationRuntime({ trustHubClient, repository, knowledgeRecordReader, contributionReader: new SupabaseContributionRepository(client), answerGenerator, connect }).handleTurn({
      ...turn,
      contributionCandidate,
      conversationId,
      channel: persistenceContext.channel,
      profileLinked: !!persistenceContext.profileId,
      identityId: turn.identityId ?? persistenceContext.whatsappIdentityId,
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
  // Only a reply that told the person their tip was saved may save it. A guest's
  // tip goes through "add a business" instead, because contributions need a profile;
  // throwing here used to leave guests with no reply at all.
  if (contributionCandidate && turn.providerMessageId && result.action === "contribution_recorded" && persistenceContext.profileId) {
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
