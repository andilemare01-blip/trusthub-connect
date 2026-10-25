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

import { formatServiceBoard, isMenuCommand, resolveMenuNumber, SERVICE_BOARD_OPTIONS } from "../lib/conversation-coordinator/service-board.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";

function say(coordinator: ConversationCoordinator, conversationId: string, text: string, providerMessageId: string) {
  return coordinator.handleTurn({ conversationId, channel: "whatsapp", text, providerMessageId });
}
async function understood(coordinator: ConversationCoordinator, conversationId: string, text: string, providerMessageId: string) {
  const understanding = await new DeterministicUnderstandingProvider().understand(text);
  return coordinator.handleTurn({ conversationId, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId });
}

test("the Service Board is a single shared definition with all ten options", () => {
  assert.equal(SERVICE_BOARD_OPTIONS.length, 10);
  assert.equal(SERVICE_BOARD_OPTIONS.map((option) => option.number).join(","), "1,2,3,4,5,6,7,8,9,10");
  assert.ok(SERVICE_BOARD_OPTIONS.every((option) => option.description.length > 0));
  assert.ok(SERVICE_BOARD_OPTIONS.every((option) => option.journey.length > 0));
  assert.ok(SERVICE_BOARD_OPTIONS.some((option) => option.status === "implemented"));
});

test("MENU shows the Service Board without corrupting an active task", async () => {
  const { coordinator, repository } = runtime({ trusthub: source() });
  const started = await understood(coordinator, "menu-active", "I need a plumber", "m1");
  assert.equal(started.state, "clarification_needed");
  const shown = await say(coordinator, "menu-active", "MENU", "m2");
  assert.equal(shown.action, "show_menu");
  assert.match(shown.reply, /Service Board/);
  assert.match(shown.reply, /Find a Business or Service|🔎 Find/);
  assert.match(shown.reply, /Community Intelligence|🧠 Community/);
  assert.match(shown.reply, /You don't have to choose a number/);
  // The pending request is preserved so the user can still answer it.
  assert.equal((await repository.get("menu-active"))?.lastRequest?.category, "plumber");
  assert.equal((await repository.get("menu-active"))?.state, "clarification_needed");
});

test("a bare menu number enters its journey and never overrides an active clarification", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await understood(coordinator, "menu-number", "I need a plumber", "n1");
  const result = await say(coordinator, "menu-number", "1", "n2");
  assert.equal(result.action, "start_journey");
  assert.match(result.reply, /Service Board/);
  assert.match(result.reply, /What would you like to find, and where\?/);
  // The active clarification is preserved; the number did not answer it.
  assert.equal(result.state, "clarification_needed");
  assert.equal(result.conversation.lastRequest?.category, "plumber");
});

test("a placeholder option gives an honest coming-soon reply instead of a fabricated result", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await say(coordinator, "placeholder", "4", "p1");
  assert.equal(result.action, "placeholder");
  assert.match(result.reply, /Service Board/);
  assert.match(result.reply, /not available yet/);
  assert.doesNotMatch(result.reply, /rating recorded|saved|confirmed/);
});

test("natural-language and numbered entry reach the same journey", async () => {
  const natural = runtime({ trusthub: source() });
  const numbered = runtime({ trusthub: source() });
  const a = await understood(natural.coordinator, "nat", "I want to write a review", "r1");
  const b = await say(numbered.coordinator, "num", "3", "r2");
  // Both routes enter the review journey and ask the user the next relevant question.
  assert.equal(a.state, "clarification_needed");
  assert.equal(b.state, "ready_for_request");
  assert.match(a.reply, /review/i);
  assert.match(b.reply, /Which business, and what was your experience\?/);
});

test("a clarification reply is not misinterpreted as a menu selection", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await understood(coordinator, "clarify-menu", "I need a plumber", "c1");
  const result = await say(coordinator, "clarify-menu", "Harare", "c2");
  assert.notEqual(result.action, "start_journey");
  assert.notEqual(result.action, "placeholder");
  assert.notEqual(result.action, "show_menu");
});

test("a location correction updates the active task rather than starting a new search", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await understood(coordinator, "correct", "I need a plumber in Harare", "k1");
  const result = await understood(coordinator, "correct", "plumber in Chiredzi", "k2");
  assert.equal(result.conversation.lastRequest?.location?.city, "Chiredzi");
});

test("the MENU command is case-insensitive and a multi-digit number is not a menu selection", async () => {
  assert.equal(isMenuCommand("menu"), true);
  assert.equal(isMenuCommand("MENU"), true);
  assert.equal(isMenuCommand("Menu"), true);
  assert.equal(isMenuCommand("menu please"), false);
  assert.equal(resolveMenuNumber("1"), SERVICE_BOARD_OPTIONS[0]);
  assert.equal(resolveMenuNumber("10"), SERVICE_BOARD_OPTIONS[9]);
  assert.equal(resolveMenuNumber("11"), null);
  assert.equal(resolveMenuNumber("1."), null);
  assert.equal(resolveMenuNumber("one"), null);
});

test("an empty search result can lead to an honest community contribution invitation", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await understood(coordinator, "gap", "Find a good barber in Chiredzi", "g1");
  // An empty result is reported honestly and never presented as a verified answer.
  assert.doesNotMatch(result.reply, /verified listing|confirmed/);
  assert.match(result.reply, /couldn't find|haven't found|ask people in the Chiredzi community/);
});

test("a community contribution is never treated as a verified fact", async () => {
  const { coordinator, repository } = runtime({ trusthub: source() });
  const candidate = detectContribution("I know a barber called Tariro in Chiredzi.");
  assert.ok(candidate);
  const result = await coordinator.handleTurn({ conversationId: "contribution", text: candidate.originalText, contributionCandidate: candidate, channel: "whatsapp", providerMessageId: "cv1" });
  assert.equal(result.action, "contribution_recorded");
  assert.match(result.reply, /not yet a verified listing/);
  // A later search must not surface the contribution as verified evidence.
  const later = await coordinator.handleTurn({ conversationId: "contribution", text: "barber in Chiredzi", providerMessageId: "cv2" });
  assert.doesNotMatch(later.reply, /verified listing/);
});

test("an incomplete feature never fabricates a result or claims false success", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const result = await say(coordinator, "growth", "10", "bg1");
  assert.equal(result.action, "placeholder");
  assert.match(result.reply, /not available yet|planned/);
  assert.doesNotMatch(result.reply, /business listing added|saved successfully|recorded/);
});

test("option 1 runs business discovery end to end through the existing data path", async () => {
  const { coordinator } = runtime({ trusthub: source([known]) });
  const menu = await say(coordinator, "d1", "1", "d1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /What would you like to find, and where\?/);
  const follow = await understood(coordinator, "d1", "plumber in Harare", "d2");
  assert.equal(follow.conversation.lastRequest?.category, "plumber");
  assert.equal(follow.conversation.lastRequest?.location?.city, "Harare");
  assert.match(follow.reply, /Moyo Plumbing/);
  // The journey context is cleared once a real answer is delivered.
  assert.equal(follow.conversation.activeJourney, undefined);
});

test("option 6 distinguishes job seekers from recruiters and routes each", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "j6", "6", "j1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /Are you looking for work, or looking to hire someone\?/);
  const seeker = await understood(coordinator, "j6", "I am looking for a job", "j2");
  assert.equal(seeker.conversation.lastRequest?.questionType, "recruitment");
  assert.equal(seeker.conversation.lastRequest?.intent, "job_seeker");
  const recruiter = await understood(coordinator, "j6b", "6", "r1");
  await understood(coordinator, "j6b", "we need to hire a driver", "r2");
  assert.equal((await coordinator["repository"].get("j6b"))?.lastRequest?.intent, "employer_recruiting");
});

test("option 7 gathers accommodation requirements and uses the existing search flow", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "h7", "7", "h1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /Are you looking for a place to stay, or offering one\?/);
  const follow = await understood(coordinator, "h7", "I need a place to stay in Harare", "h2");
  assert.equal(follow.conversation.lastRequest?.category, "accommodation");
  // The accommodation journey asks for the city before searching, which is the
  // existing search flow's next relevant question.
  assert.match(follow.reply, /Which city should I look in\?/);
});

test("option 8 connects Community Intelligence to evidence and honest gaps", async () => {
  const found = runtime({ trusthub: source([known]) });
  const menu = await say(found.coordinator, "c8", "8", "c1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /What would you like to learn more about in your community\?/);
  const result = await understood(found.coordinator, "c8", "plumber in Harare", "c2");
  assert.match(result.reply, /Moyo Plumbing/);
  const gap = runtime({ trusthub: source() });
  await say(gap.coordinator, "c8b", "8", "c3");
  const gapResult = await understood(gap.coordinator, "c8b", "barber in Chiredzi", "c4");
  assert.match(gapResult.reply, /couldn't find|haven't found|ask your community/);
  assert.doesNotMatch(gapResult.reply, /verified listing/);
});

test("option 2 starts business submission and asks for the business name", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "b2", "2", "b1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /What is the business called, and where is it\?/);
  const follow = await understood(coordinator, "b2", "bakery in Harare", "b2");
  assert.equal(follow.action, "clarify");
  assert.match(follow.reply, /What's the business name\?/);
  assert.equal(follow.conversation.lastRequest?.category, "bakery");
  assert.equal(follow.conversation.lastRequest?.location?.city, "Harare");
});

test("option 3 starts review submission and asks which business", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "r3", "3", "r1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /Which business, and what was your experience\?/);
  const follow = await understood(coordinator, "r3", "plumber in Harare", "r2");
  assert.equal(follow.action, "clarify");
  assert.match(follow.reply, /Which business did you use\?/);
  assert.equal(follow.conversation.lastRequest?.category, "plumber");
  assert.equal(follow.conversation.lastRequest?.location?.city, "Harare");
});

test("a menu number followed by a correction updates the active task", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await say(coordinator, "corr", "1", "c1");
  await understood(coordinator, "corr", "plumber in Harare", "c2");
  const corrected = await understood(coordinator, "corr", "plumber in Chiredzi", "c3");
  assert.equal(corrected.conversation.lastRequest?.location?.city, "Chiredzi");
});

test("MENU during an active journey preserves the journey and task", async () => {
  const { coordinator, repository } = runtime({ trusthub: source() });
  await say(coordinator, "mj", "1", "m1");
  await understood(coordinator, "mj", "plumber in Harare", "m2");
  const menu = await say(coordinator, "mj", "MENU", "m3");
  assert.equal(menu.action, "show_menu");
  assert.equal((await repository.get("mj"))?.activeJourney, "business_discovery");
  assert.equal((await repository.get("mj"))?.lastRequest?.category, "plumber");
  // The user can still answer the pending question after MENU.
  const answer = await understood(coordinator, "mj", "plumber in Chiredzi", "m4");
  assert.equal(answer.conversation.lastRequest?.location?.city, "Chiredzi");
});

test("a cancelled journey returns to the menu cleanly", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await say(coordinator, "cancel", "1", "x1");
  await understood(coordinator, "cancel", "plumber in Harare", "x2");
  const menu = await say(coordinator, "cancel", "MENU", "x3");
  assert.equal(menu.action, "show_menu");
  // MENU preserves the current state verbatim, including community consent waits.
  assert.equal(menu.state, "asking_community");
  assert.equal((await coordinator["repository"].get("cancel"))?.activeJourney, "business_discovery");
});

test("option 4 routes through the rating journey and never claims a rating was recorded", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "r4", "4", "r1");
  assert.equal(menu.action, "placeholder");
  assert.match(menu.reply, /not available yet/);
  assert.match(menu.reply, /write a review instead/);
  // The journey context is preserved so follow-ups stay coherent.
  assert.equal((await coordinator["repository"].get("r4"))?.activeJourney, "business_rating");
  const follow = await understood(coordinator, "r4", "plumber in Harare", "r2");
  assert.equal(follow.action, "clarify");
  assert.match(follow.reply, /Which business did you use\?/);
  assert.doesNotMatch(follow.reply, /rating recorded|saved|confirmed/);
});

test("option 5 routes through buy/sell and points to the supported discovery path", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "b5", "5", "b1");
  assert.equal(menu.action, "start_journey");
  assert.match(menu.reply, /Buy.*Sell/);
  assert.equal((await coordinator["repository"].get("b5"))?.activeJourney, "buy_sell");
  const follow = await understood(coordinator, "b5", "I want to sell a car in Harare", "b2");
  assert.equal(follow.action, "clarify");
  assert.match(follow.reply, /sell/);
});

test("option 9 records product feedback honestly without claiming a system save", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "f9", "9", "f1");
  assert.equal(menu.action, "placeholder");
  assert.match(menu.reply, /not available yet/);
  assert.equal((await coordinator["repository"].get("f9"))?.activeJourney, "product_feedback");
  const follow = await say(coordinator, "f9", "The menu is hard to read on my phone", "f2");
  assert.equal(follow.action, "placeholder");
  assert.match(follow.reply, /not saved to a system you can see yet/);
  assert.doesNotMatch(follow.reply, /saved successfully|recorded in our system/);
});

test("option 10 keeps Business Growth as planned and offers the supported alternative", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "g10", "10", "g1");
  assert.equal(menu.action, "placeholder");
  assert.match(menu.reply, /not available yet/);
  assert.equal((await coordinator["repository"].get("g10"))?.activeJourney, "business_growth");
  const follow = await say(coordinator, "g10", "I want insights for my shop", "g2");
  assert.equal(follow.action, "placeholder");
  assert.match(follow.reply, /planned, not available yet/);
  assert.match(follow.reply, /add or improve a business listing/);
});

test("option 2 guides business submission through the existing handler", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "p2", "2", "p1");
  assert.equal(menu.action, "start_journey");
  assert.equal((await coordinator["repository"].get("p2"))?.activeJourney, "business_contribution");
  const name = await understood(coordinator, "p2", "bakery in Harare", "p2");
  assert.equal(name.action, "clarify");
  assert.match(name.reply, /What's the business name\?/);
  const city = await understood(coordinator, "p2", "Sunny Bake", "p3");
  assert.equal(city.action, "clarify");
  assert.match(city.reply, /What's the business name\?/);
});

test("option 3 guides review submission through the existing handler", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  const menu = await say(coordinator, "p3", "3", "q1");
  assert.equal(menu.action, "start_journey");
  assert.equal((await coordinator["repository"].get("p3"))?.activeJourney, "review_submission");
  const business = await understood(coordinator, "p3", "plumber in Harare", "q2");
  assert.equal(business.action, "clarify");
  assert.match(business.reply, /Which business did you use\?/);
  const detail = await understood(coordinator, "p3", "Moyo Plumbing", "q3");
  assert.equal(detail.action, "clarify");
  assert.match(detail.reply, /Which business did you use\?/);
});

test("a placeholder journey can be cancelled back to the menu", async () => {
  const { coordinator } = runtime({ trusthub: source() });
  await say(coordinator, "pc", "9", "c1");
  await say(coordinator, "pc", "The search is confusing", "c2");
  const menu = await say(coordinator, "pc", "MENU", "c3");
  assert.equal(menu.action, "show_menu");
  assert.equal(menu.state, "ready_for_request");
  assert.equal((await coordinator["repository"].get("pc"))?.activeJourney, "product_feedback");
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
