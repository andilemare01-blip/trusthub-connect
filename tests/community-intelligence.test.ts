import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDemandMetrics, aggregateOutcomeMetrics } from "../lib/analytics/aggregation.ts";
import { rankTrustAgentCandidates } from "../lib/agents/matching.ts";
import { InMemoryTrustAgentHandoffProvider, requestTrustAgentHandoff } from "../lib/agents/handoff.ts";
import { createCommunityHelpRequest, createOrGetCommunityHelpRequest, InMemoryCommunityHelpRequestRepository } from "../lib/community/help-requests.ts";
import { detectKnowledgeGaps } from "../lib/knowledge/gap-detection.ts";
import { evaluateOutreachRecipients, planCommunityOutreach } from "../lib/outreach/policy.ts";
import { InMemoryNotificationProvider } from "../lib/notifications/provider.ts";
import { InMemoryRuntimeEventRecorder, validateRuntimeEvent } from "../lib/observability/events.ts";
import type { ServiceRequest } from "../types/service-request.ts";

const baseRequest: ServiceRequest = {
  id: "request-1", conversationId: "21", trustHubProfileId: "42", communityKey: "zimbabwe:bulawayo",
  communityId: "community-byo", area: null, sourceChannel: "whatsapp", requestedCategory: "plumber",
  requestText: "Find a plumber", intent: "find_provider", status: "open",
  createdAt: "2026-09-29T08:00:00.000Z", resolvedAt: null, timeToUsefulAnswerSeconds: null,
};

test("community-help request requires consent and only shares the selected city/optional area context", () => {
  const input = {
    id: "help-1", serviceRequestId: "request-1", communityId: "community-byo", communityKey: "zimbabwe:bulawayo",
    city: "Bulawayo", area: null, category: "plumber", question: "Can anyone recommend a plumber?",
    requesterConsent: true, requesterConsentAt: "2026-09-29T08:01:00.000Z", createdAt: "2026-09-29T08:01:00.000Z",
  };
  assert.throws(() => createCommunityHelpRequest({ ...input, requesterConsent: false }), /explicit requester consent/);
  const request = createCommunityHelpRequest(input);
  assert.equal(request.status, "open");
  assert.equal(request.city, "Bulawayo");
  assert.equal(request.area, null);
  assert.equal("latitude" in request, false);
});

test("community-help request creation is idempotent by service request and rejects cross-community replay", async () => {
  const repository = new InMemoryCommunityHelpRequestRepository();
  const input = {
    id: "help-1", serviceRequestId: "request-1", communityId: "community-byo", communityKey: "zimbabwe:bulawayo",
    city: "Bulawayo", area: null, category: "plumber", question: "Need help finding a plumber.",
    requesterConsent: true, requesterConsentAt: "2026-09-29T08:01:00.000Z", createdAt: "2026-09-29T08:01:00.000Z",
  };
  assert.equal((await createOrGetCommunityHelpRequest(repository, input)).created, true);
  assert.equal((await createOrGetCommunityHelpRequest(repository, { ...input, id: "replay-id" })).created, false);
  await assert.rejects(createOrGetCommunityHelpRequest(repository, { ...input, communityId: "community-hre", city: "Harare" }), /different community/);
});

test("agent matching requires exact community and availability, preferring exact service coverage", () => {
  const candidate = (id: string, city: string, category: string | null, available: boolean) => ({
    agent: { id, trustHubProfileId: `profile-${id}`, role: "TRUST_AGENT" as const, createdAt: "2026-09-29T00:00:00.000Z" },
    availability: { agentId: id, isAvailable: available, note: null, updatedAt: "2026-09-29T00:00:00.000Z" },
    coverage: [{ agentId: id, communityKey: city, category }],
  });
  const results = rankTrustAgentCandidates({ communityKey: "Zimbabwe:Bulawayo", requestedCategory: "Plumber" }, [
    candidate("general", "zimbabwe:bulawayo", null, true), candidate("exact", "zimbabwe:bulawayo", "plumber", true),
    candidate("harare", "zimbabwe:harare", "plumber", true), candidate("offline", "zimbabwe:bulawayo", "plumber", false),
  ]);
  assert.deepEqual(results.map(({ id, score }) => [id, score]), [["exact", 100], ["general", 70]]);
  assert.deepEqual(rankTrustAgentCandidates({ communityKey: null, requestedCategory: "plumber" }, [candidate("any", "zimbabwe:bulawayo", null, true)]), []);
});

test("agent handoff requires consent, keeps status queryable, and accepts duplicate requests idempotently", async () => {
  const provider = new InMemoryTrustAgentHandoffProvider(() => "2026-09-29T08:05:00.000Z");
  const candidates = [{
    agent: { id: "agent-1", trustHubProfileId: "profile-1", role: "TRUST_AGENT" as const, createdAt: "2026-09-29T00:00:00.000Z" },
    availability: { agentId: "agent-1", isAvailable: true, note: null, updatedAt: "2026-09-29T08:00:00.000Z" },
    coverage: [{ agentId: "agent-1", communityKey: "zimbabwe:bulawayo", category: "plumber" }],
  }];
  const request = { ...baseRequest, id: "request-handoff" };
  assert.equal((await requestTrustAgentHandoff({ request, consentGiven: false, candidates, provider })).status, "consent_required");
  assert.equal(provider.requests.length, 0);

  const result = await requestTrustAgentHandoff({ request, consentGiven: true, candidates, provider });
  assert.equal(result.status, "requested");
  if (result.status !== "requested") return;
  assert.equal(await provider.getStatus(result.assignment.id), "assigned");
  await provider.acknowledge(result.assignment.id, "accepted");
  assert.equal(await provider.getStatus(result.assignment.id), "accepted");
  await requestTrustAgentHandoff({ request, consentGiven: true, candidates, provider });
  assert.equal(provider.requests.length, 1);
});

test("demand aggregation separates communities and counts unresolved requests only", () => {
  const other = { ...baseRequest, id: "request-other", communityKey: "zimbabwe:harare", status: "open" as const };
  const answered = { ...baseRequest, id: "request-answered", status: "resolved" as const };
  assert.deepEqual(aggregateDemandMetrics([baseRequest, other, answered], "zimbabwe:bulawayo"), [
    { communityKey: "zimbabwe:bulawayo", category: "plumber", requestCount: 2, unansweredCount: 1 },
  ]);
});

test("outcome metrics count explicit confirmations and calculate useful-answer time once per request", () => {
  const solved = { ...baseRequest, status: "resolved" as const };
  const outcomes = [
    { serviceRequestId: solved.id, usefulAnswerConfirmed: true, matchConfirmed: true, resolvedAt: "2026-09-29T08:10:00.000Z" },
    { serviceRequestId: solved.id, usefulAnswerConfirmed: true, matchConfirmed: true, resolvedAt: "2026-09-29T08:10:00.000Z" },
    { serviceRequestId: baseRequest.id, usefulAnswerConfirmed: false, matchConfirmed: false, resolvedAt: "2026-09-29T08:20:00.000Z" },
  ];
  assert.deepEqual(aggregateOutcomeMetrics([solved, baseRequest], outcomes, "zimbabwe:bulawayo"), {
    communityKey: "zimbabwe:bulawayo", problemsSolved: 1, successfulMatches: 1, averageTimeToUsefulAnswerSeconds: 600,
  });
});

test("knowledge gaps reflect repeated or unanswered demand without copying request text", () => {
  const samples = [1, 2, 3].map((n) => ({
    city: "Bulawayo",
    request: { ...baseRequest, id: `request-${n}`, status: "open" as const, requestText: `Private details ${n}` },
  }));
  const gaps = detectKnowledgeGaps(samples, { now: "2026-09-29T09:00:00.000Z" });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "repeated_service_request");
  assert.match(gaps[0].description, /plumber in Bulawayo/);
  assert.doesNotMatch(gaps[0].description, /Private details/);
});

test("knowledge-gap detection excludes stale, resolved, and cross-city requests", () => {
  const samples = [
    { city: "Bulawayo", request: { ...baseRequest, id: "old", status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" } },
    { city: "Bulawayo", request: { ...baseRequest, id: "resolved", status: "resolved" as const } },
    { city: "Harare", request: { ...baseRequest, id: "other-city", communityKey: "zimbabwe:harare", status: "in_progress" as const } },
    { city: "Bulawayo", request: { ...baseRequest, id: "unanswered", status: "open" as const } },
  ];
  const gaps = detectKnowledgeGaps(samples, { now: "2026-09-29T09:00:00.000Z" });
  assert.deepEqual(gaps.map((gap) => [gap.reason, gap.communityKey]), [["unanswered_request", "zimbabwe:bulawayo"]]);
});

test("outreach planning and recipient selection require opt-in and enforce frequency limits", () => {
  const gap = { id: "gap-1", reason: "unanswered_request" as const, category: "plumber", communityKey: "zimbabwe:bulawayo", description: "Need for plumber", status: "open" as const, detectedAt: "2026-09-29T08:00:00.000Z", resolvedAt: null };
  const outreach = planCommunityOutreach({ id: "outreach-1", gap, channel: "notification", message: "Can you help with a local plumbing request?", createdAt: "2026-09-29T08:01:00.000Z" });
  const recipients = evaluateOutreachRecipients({
    outreachId: outreach.id,
    now: "2026-09-29T09:00:00.000Z",
    policy: { minIntervalHours: 24, maxPerWeek: 2, requiresOptIn: true },
    histories: [
      { profileId: "opted-out", optedIn: false, notifiedAt: [] },
      { profileId: "too-soon", optedIn: true, notifiedAt: ["2026-09-28T15:00:00.000Z"] },
      { profileId: "weekly-limit", optedIn: true, notifiedAt: ["2026-09-28T00:00:00.000Z", "2026-09-27T00:00:00.000Z"] },
      { profileId: "eligible", optedIn: true, notifiedAt: [] },
    ],
  });
  assert.deepEqual(recipients.map(({ status, skipReason }) => [status, skipReason]), [
    ["skipped_policy", "opted_out"], ["skipped_policy", "frequency_interval_not_elapsed"],
    ["skipped_policy", "weekly_limit_reached"], ["pending", null],
  ]);
});

test("notification fake is idempotent and runtime audit events reject sensitive fields", async () => {
  const notifications = new InMemoryNotificationProvider(() => "2026-09-29T09:00:00.000Z");
  const message = { recipientProfileId: "42", type: "community_help_request" as const, title: "Community request", message: "Can you help?", dedupeKey: "help-1:profile-42", communityId: "community-byo" };
  assert.equal((await notifications.dispatch(message)).status, "accepted");
  assert.equal((await notifications.dispatch(message)).status, "duplicate");
  assert.equal(notifications.dispatched.length, 1);

  const recorder = new InMemoryRuntimeEventRecorder();
  const event = { id: "event-1", name: "answer_resolved" as const, occurredAt: "2026-09-29T09:00:00.000Z", correlationId: "request-1", actor: "system" as const, entityType: "request" as const, entityId: "request-1", attributes: { status: "answered", confidence: "medium", resultCount: 1 } };
  await recorder.record(event);
  assert.equal(recorder.events.length, 1);
  assert.throws(() => validateRuntimeEvent({ ...event, attributes: { messageText: "private" } }), /Sensitive runtime event attribute/);
});
