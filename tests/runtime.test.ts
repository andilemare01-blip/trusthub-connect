import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import type { AnswerSource, AnswerSourceResult, EvidenceItem, NormalizedRequest, SourceKind } from "../lib/answer-resolution/types.ts";
import { ConversationCoordinator } from "../lib/conversation-coordinator/coordinator.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { detectContribution } from "../lib/contributions/detection.ts";

const request: NormalizedRequest = { text: "Find a plumber in Harare", intent: "find_provider", category: "plumber", location: { country: "Zimbabwe", city: "Harare" }, questionType: "provider_recommendation" };
const known: EvidenceItem = { id: "ev-1", claim: "TrustHub lists Moyo Plumbing in Harare.", source: "trusthub", sourceLabel: "TrustHub business record", verificationStatus: "verified", confidence: "high", retrievedAt: "2026-01-01T00:00:00.000Z", sourceRecordId: "biz-1" };
const source = (items: EvidenceItem[] = []): AnswerSource => ({ async search(): Promise<AnswerSourceResult> { return { matchStatus: items.length > 1 ? "multiple" : items.length ? "matched" : "none", evidence: items }; } });
function runtime(sources: Partial<Record<SourceKind, AnswerSource>>) {
  const repository = new InMemoryRuntimeConversationRepository();
  const resolver = new PolicyAnswerResolver(sources);
  return { repository, coordinator: new ConversationCoordinator(repository, resolver, () => "2026-01-01T00:00:00.000Z") };
}

test("guest greeting reaches the normal response path without a linked account", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await coordinator.handleTurn({
    conversationId: "guest-greeting",
    channel: "whatsapp",
    text: "Hi",
  });

  assert.equal(result.action, "clarify");
  assert.match(result.reply, new RegExp(`I'm ${result.conversation.assistantName}\\b`));
});

test("answers from TrustHub and preserves provenance and uncertainty", async () => {
  const { coordinator } = runtime({ trusthub: source([{ ...known, confidence: "medium", verificationStatus: "observed" }]) });
  const result = await coordinator.handleTurn({ conversationId: "known", text: request.text, request });
  assert.equal(result.resolution?.status, "community_needed");
  assert.equal(result.resolution?.evidence[0].sourceRecordId, "biz-1");
  assert.equal(result.resolution?.evidence[0].verificationStatus, "observed");
  assert.equal(result.resolution?.confidence, "medium");
  assert.match(result.reply, /TrustHub business record/);
});

test("clarifies missing category before any source lookup", async () => {
  let calls = 0;
  const { coordinator } = runtime({ trusthub: { async search() { calls += 1; return { matchStatus: "none", evidence: [] }; } } });
  const result = await coordinator.handleTurn({ conversationId: "clarify", text: "Need help", request: { ...request, category: null } });
  assert.equal(result.action, "clarify");
  assert.equal(result.state, "clarification_needed");
  assert.equal(calls, 0);
});

test("empty TrustHub lookup offers community permission before final uncertainty", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await coordinator.handleTurn({ conversationId: "missing", text: request.text, request });
  assert.equal(result.action, "ask_community_permission");
  assert.notEqual(result.state, "unresolved");
  assert.equal(result.resolution?.sourceAttempts[0].status, "empty");
});

test("community is not contacted when the requester declines", async () => {
  let calls = 0;
  const { coordinator } = runtime({ trusthub: source(), community: { async search() { calls += 1; return { matchStatus: "none", evidence: [] }; } } });
  await coordinator.handleTurn({ conversationId: "decline", text: request.text, request });
  const result = await coordinator.handleTurn({ conversationId: "decline", text: "No" });
  assert.equal(calls, 0);
  assert.equal(result.resolution?.sourceAttempts.find((attempt) => attempt.source === "community")?.status, "declined");
});

test("community consent permits lookup while keeping its evidence declared", async () => {
  const reported: EvidenceItem = { ...known, id: "community-1", source: "community", sourceLabel: "Community member", verificationStatus: "verified", confidence: "medium" };
  const { coordinator } = runtime({ trusthub: source(), community: source([reported]) });
  await coordinator.handleTurn({ conversationId: "consent", text: request.text, request });
  const result = await coordinator.handleTurn({ conversationId: "consent", text: "Yes" });
  assert.equal(result.resolution?.evidence[0].verificationStatus, "declared");
  assert.equal(result.resolution?.evidence[0].sourceRecordId, "biz-1");
  assert.equal(result.state, "answer_uncertain");
});

test("human/Trust Agent offer and consent are distinct from a completed handoff", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await coordinator.handleTurn({ conversationId: "human", text: request.text, request });
  const offer = await coordinator.handleTurn({ conversationId: "human", text: "No" });
  assert.equal(offer.action, "request_human_permission");
  assert.equal(offer.state, "trust_agent_offer");
  const consent = await coordinator.handleTurn({ conversationId: "human", text: "Yes" });
  assert.equal(consent.action, "human_handoff_consented");
  assert.equal(consent.state, "human_handoff");
  assert.match(consent.reply, /No agent connection has been made/);
});

test("final no-results response follows attempted and declined routes", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await coordinator.handleTurn({ conversationId: "final", text: request.text, request });
  await coordinator.handleTurn({ conversationId: "final", text: "No" });
  const result = await coordinator.handleTurn({ conversationId: "final", text: "No" });
  assert.equal(result.action, "human_handoff_declined");
  assert.equal(result.state, "unresolved");
  assert.match(result.reply, /haven't found enough reliable information/);
});

test("local facts are never invented when no source returns evidence", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await coordinator.handleTurn({ conversationId: "empty", text: request.text, request, communityConsent: false, humanConsent: false });
  assert.deepEqual(result.resolution?.evidence, []);
  assert.doesNotMatch(result.reply, /Moyo Plumbing|\+?\d{7,}/);
});

test("conversation transition and messages persist through the local repository", async () => {
  const { coordinator, repository } = runtime({ trusthub: source([known]) });
  await coordinator.handleTurn({ conversationId: "state", text: request.text, request });
  const saved = await repository.get("state");
  assert.equal(saved?.state, "asking_community");
  assert.equal(saved?.messages.length, 2);
  assert.deepEqual(saved?.transitions.map(({ from, to }) => [from, to]), [["ready_for_request", "asking_community"]]);
});

test("duplicate provider message IDs do not append or resolve a WhatsApp turn twice", async () => {
  const { coordinator, repository } = runtime({ trusthub: source([known]) });
  const first = await coordinator.handleTurn({ conversationId: "wa-dedup", channel: "whatsapp", text: request.text, request, providerMessageId: "wamid.duplicate" });
  const duplicate = await coordinator.handleTurn({ conversationId: "wa-dedup", channel: "whatsapp", text: "different replay body", request, providerMessageId: "wamid.duplicate" });
  const stored = await repository.get("wa-dedup");
  assert.equal(duplicate.reply, first.reply);
  assert.equal(stored?.messages.length, 2);
  assert.equal(stored?.messages.filter((message) => message.providerMessageId === "wamid.duplicate").length, 1);
});

test("voice/photo media is recorded as metadata and never represented as transcribed or interpreted", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await coordinator.handleTurn({
    conversationId: "wa-media", channel: "whatsapp", text: "", media: [{ providerMediaId: "media-1", kind: "voice", mimeType: "audio/ogg" }],
  });
  assert.match(result.reply, /transcription or image reading is not configured/);
  assert.deepEqual(result.conversation.messages[0].metadata?.whatsappMedia, [{ providerMediaId: "media-1", kind: "voice", mimeType: "audio/ogg" }]);
});

test("coordinator records an extracted contribution candidate without searching or upgrading its status", async () => {
  let searches = 0;
  const { coordinator, repository } = runtime({ trusthub: { async search() { searches += 1; return { matchStatus: "none", evidence: [] }; } } });
  const candidate = detectContribution("I know a plumber called Tariro in Chiredzi.");
  assert.ok(candidate);
  const result = await coordinator.handleTurn({ conversationId: "contribution", text: candidate.originalText, contributionCandidate: candidate, channel: "whatsapp" });
  const saved = await repository.get("contribution");
  assert.equal(searches, 0);
  assert.equal(result.action, "contribution_recorded");
  assert.equal(saved?.messages[0].text, candidate.originalText);
  assert.equal(saved?.messages[0].metadata?.detectedContribution && (saved.messages[0].metadata.detectedContribution as typeof candidate).verificationStatus, "declared");
  assert.match(result.reply, /not yet a verified listing/);
});

test("coordinator surfaces persistence failures instead of claiming the turn was saved", async () => {
  class FailingRepository extends InMemoryRuntimeConversationRepository {
    override async save(): Promise<void> { throw new Error("temporary persistence failure"); }
  }
  const failing = new ConversationCoordinator(new FailingRepository(), new PolicyAnswerResolver({ trusthub: source([known]) }));
  await assert.rejects(() => failing.handleTurn({ conversationId: "persistence-failure", text: request.text, request }), /temporary persistence failure/);
});

test("external listings remain potential and cannot replace absent evidence", async () => {
  const { coordinator } = runtime({ trusthub: source(), overture: source([{ ...known, source: "overture", sourceLabel: "Overture", verificationStatus: "verified" }]) });
  const discovery = { ...request, questionType: "business_discovery" as const };
  const result = await coordinator.handleTurn({ conversationId: "external", text: discovery.text, request: discovery, resolverContext: { externalDiscoveryEnabled: true, externalSources: ["overture"] } });
  assert.equal(result.resolution?.status, "partially_answered");
  assert.equal(result.resolution?.evidence[0].verificationStatus, "potential");
  assert.equal(result.resolution?.evidence[0].source, "overture");
});
