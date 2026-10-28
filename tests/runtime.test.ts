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

  assert.equal(result.action, "show_menu");
  assert.match(result.reply, /What would you like to do\?/);
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
  assert.match(result.reply, /I received your voice note, but I can't read media yet/);
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

import { MENU_ROWS, isMenuCommand, menuInteractive, resolveMenuSelection } from "../lib/connect/menu.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";

function say(coordinator: ConversationCoordinator, conversationId: string, text: string, providerMessageId: string) {
  return coordinator.handleTurn({ conversationId, channel: "whatsapp", text, providerMessageId });
}
async function understood(coordinator: ConversationCoordinator, conversationId: string, text: string, providerMessageId: string) {
  const understanding = await new DeterministicUnderstandingProvider().understand(text);
  return coordinator.handleTurn({ conversationId, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId });
}

test("the main menu is one definition with ten rows inside WhatsApp's list limits", () => {
  assert.equal(MENU_ROWS.length, 10);
  assert.equal(new Set(MENU_ROWS.map((row) => row.id)).size, 10);
  assert.equal(MENU_ROWS.map((row) => row.number).join(","), "1,2,3,4,5,6,7,8,9,10");
  assert.ok(MENU_ROWS.every((row) => row.title.length <= 24 && row.description.length <= 72));
  const list = menuInteractive("What would you like to do?");
  assert.equal(list.type, "list");
  assert.ok((list.buttonText ?? "").length <= 20);
  assert.equal(list.sections?.flatMap((section) => section.rows).length, 10);
  assert.ok(list.sections?.every((section) => (section.title ?? "").length <= 24));
});

test("Hi gets a short welcome under the assistant's name and the tappable menu, with real line breaks", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await say(coordinator, "welcome", "Hi", "w1");
  assert.equal(result.action, "show_menu");
  assert.equal(result.interactive?.type, "list");
  assert.ok(result.reply.includes(`I'm ${result.conversation.assistantName}`));
  assert.ok(!result.reply.includes("\\n"), "the reply must not contain a literal backslash-n");
  assert.ok((result.interactive?.body ?? "").length < 300, "the welcome stays short");
});

test("MENU, a number and a tapped row id all reach the same journey", async () => {
  assert.equal(isMenuCommand("menu"), true);
  assert.equal(isMenuCommand("menu please"), false);
  assert.equal(resolveMenuSelection("1")?.id, "menu.find");
  assert.equal(resolveMenuSelection("menu.find")?.id, "menu.find");
  assert.equal(resolveMenuSelection("10")?.id, "menu.profile");
  assert.equal(resolveMenuSelection("11"), null);
  assert.equal(resolveMenuSelection("1."), null);
  const typed = runtime({ trusthub: source() });
  const tapped = runtime({ trusthub: source() });
  const a = await say(typed.coordinator, "num", "1", "n1");
  const b = await say(tapped.coordinator, "tap", "menu.find", "n2");
  assert.equal(a.reply, b.reply);
  assert.equal(a.conversation.activeJourney, "business_discovery");
  assert.equal(b.conversation.activeJourney, "business_discovery");
});

test("option 1 runs business discovery end to end through the existing data path", async () => {
  const { coordinator } = runtime({ trusthub: source([known]) });
  const menu = await say(coordinator, "d1", "1", "d1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /What are you looking for, and where\?/);
  const follow = await understood(coordinator, "d1", "plumber in Harare", "d2");
  assert.equal(follow.conversation.lastRequest?.category, "plumber");
  assert.equal(follow.conversation.lastRequest?.location?.city, "Harare");
  assert.match(follow.reply, /Moyo Plumbing/);
  assert.equal(follow.conversation.activeJourney, undefined);
});

test("a suburb typed as the town is searched inside its town", async () => {
  const seen: NormalizedRequest[] = [];
  const recording: AnswerSource = { async search(request) { seen.push(request); return { matchStatus: "matched", evidence: [known] }; } };
  const { coordinator } = runtime({ trusthub: recording });
  await understood(coordinator, "suburb", "plumber in Avondale", "s1");
  assert.equal(seen.at(-1)?.location?.city, "Harare");
  assert.equal(seen.at(-1)?.location?.area, "Avondale");
});

test("a clarification reply is not misinterpreted as a menu selection", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await understood(coordinator, "clarify-menu", "I need a plumber", "c1");
  const result = await say(coordinator, "clarify-menu", "Harare", "c2");
  assert.notEqual(result.action, "start_journey");
  assert.notEqual(result.action, "show_menu");
});

test("MENU during a search question shows the menu but keeps the question open", async () => {
  const { coordinator, repository } = runtime({ trusthub: source([known]) });
  await understood(coordinator, "menu-active", "I need a plumber", "m1");
  const shown = await say(coordinator, "menu-active", "MENU", "m2");
  assert.equal(shown.action, "show_menu");
  assert.equal((await repository.get("menu-active"))?.state, "clarification_needed");
  const answered = await say(coordinator, "menu-active", "Harare", "m3");
  assert.equal(answered.conversation.lastRequest?.category, "plumber");
  assert.equal(answered.conversation.lastRequest?.location?.city, "Harare");
});

test("a location correction updates the active task rather than starting a new search", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await understood(coordinator, "correct", "I need a plumber in Harare", "k1");
  const result = await understood(coordinator, "correct", "plumber in Chiredzi", "k2");
  assert.equal(result.conversation.lastRequest?.location?.city, "Chiredzi");
});

test("an empty search result can lead to an honest community contribution invitation", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await understood(coordinator, "gap", "Find a good barber in Chiredzi", "g1");
  assert.doesNotMatch(result.reply, /verified listing|confirmed/);
  assert.match(result.reply, /couldn't find|haven't found|ask people in the Chiredzi community/);
  assert.equal(result.interactive?.type, "button");
});

test("a community contribution is never treated as a verified fact", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const candidate = detectContribution("I know a barber called Tariro in Chiredzi.");
  assert.ok(candidate);
  const result = await coordinator.handleTurn({ conversationId: "contribution", text: candidate.originalText, contributionCandidate: candidate, channel: "whatsapp", providerMessageId: "cv1" });
  assert.equal(result.action, "contribution_recorded");
  assert.match(result.reply, /not yet a verified listing/);
  const later = await coordinator.handleTurn({ conversationId: "contribution", text: "barber in Chiredzi", providerMessageId: "cv2" });
  assert.doesNotMatch(later.reply, /verified listing/);
});

test("a guest's business tip becomes an add-a-business flow instead of a crash", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const candidate = detectContribution("I know a plumber called Tariro in Chiredzi.");
  const result = await coordinator.handleTurn({ conversationId: "guest-tip", text: candidate!.originalText, contributionCandidate: candidate, channel: "whatsapp", providerMessageId: "gt1", profileLinked: false, identityId: "7" });
  assert.notEqual(result.action, "contribution_recorded");
  assert.equal(result.conversation.connect?.flow, "add_business");
  assert.match(result.reply, /Tariro/);
});

test("a plain-language review or profile request joins the flow that saves it", async () => {
  const review = runtime({ trusthub: source() });
  const reviewed = await understood(review.coordinator, "nl-review", "I want to write a review", "r1");
  assert.equal(reviewed.conversation.connect?.flow, "review");
  const profile = runtime({ trusthub: source() });
  const created = await profile.coordinator.handleTurn({ conversationId: "nl-profile", channel: "whatsapp", text: "create my profile", providerMessageId: "p1", profileLinked: false, identityId: "8" });
  assert.match(created.reply, /Your TrustHub profile/);
});

test("the assistant name follows the person, not the conversation", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const first = await coordinator.handleTurn({ conversationId: "conv-a", channel: "whatsapp", text: "Hi", providerMessageId: "a1", identityId: "42" });
  const second = await coordinator.handleTurn({ conversationId: "conv-b", channel: "whatsapp", text: "Hi", providerMessageId: "b1", identityId: "42" });
  assert.equal(first.conversation.assistantName, second.conversation.assistantName);
});

test("a genuine contribution is recorded as unverified and never presented as a verified listing", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await coordinator.handleTurn({ conversationId: "contrib", text: "I know a plumber called Tariro in Chiredzi.", contributionCandidate: detectContribution("I know a plumber called Tariro in Chiredzi."), channel: "whatsapp", providerMessageId: "cv1" });
  assert.equal(result.action, "contribution_recorded");
  assert.match(result.reply, /unverified community contribution/);
  // The reply states the contribution is NOT verified; it never claims verified status.
  assert.match(result.reply, /not yet a verified listing/);
  assert.doesNotMatch(result.reply, /is now a verified listing|has been verified/);
});

test("a contribution during an active journey does not abandon the journey", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await say(coordinator, "cj", "1", "j1");
  await understood(coordinator, "cj", "plumber in Harare", "j2");
  const contribution = await coordinator.handleTurn({ conversationId: "cj", text: "I know a plumber called Tariro in Chiredzi.", contributionCandidate: detectContribution("I know a plumber called Tariro in Chiredzi."), channel: "whatsapp", providerMessageId: "j3" });
  assert.equal(contribution.conversation.activeJourney, "business_discovery");
  assert.equal(contribution.conversation.lastRequest?.category, "plumber");
  assert.equal(contribution.conversation.lastRequest?.location?.city, "Harare");
});

test("a search request is never stored as the sender's own capability", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await understood(coordinator, "notcap", "I'm looking for a plumber in Harare", "nc1");
  assert.notEqual(result.action, "contribution_recorded");
  assert.equal(result.conversation.lastRequest?.category, "plumber");
});

test("a contribution is never treated as verified evidence on a later search", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await coordinator.handleTurn({ conversationId: "ev", text: "I know a plumber called Tariro in Chiredzi.", contributionCandidate: detectContribution("I know a plumber called Tariro in Chiredzi."), channel: "whatsapp", providerMessageId: "e1" });
  const later = await understood(coordinator, "ev", "plumber in Chiredzi", "e2");
  assert.doesNotMatch(later.reply, /verified listing/);
});

