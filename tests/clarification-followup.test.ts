import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import { ConversationCoordinator, type CityValidator } from "../lib/conversation-coordinator/coordinator.ts";
import { resolveCommunityFromPendingRequest } from "../lib/conversation-coordinator/community-follow-up.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { ASSISTANT_NAMES, WisdomLibrary } from "../lib/conversation-coordinator/wisdom-library.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";

const library = WisdomLibrary.load();
const knownCities = new Set(["harare", "bulawayo"]);
const cityValidator: CityValidator = async (city) => knownCities.has(city.toLowerCase());
const community = { id: "11111111-1111-4111-8111-111111111111", city: "Harare", country: "Zimbabwe" };
const trustHubClient = { async listCommunitiesByLocation(_country: string | null, city: string) { return city.toLowerCase() === "harare" ? [community] : []; } } as never;

function setup(repository = new InMemoryRuntimeConversationRepository()) {
  const trusthub = { async search() { return { matchStatus: "none" as const, evidence: [] }; } };
  return { repository, coordinator: new ConversationCoordinator(repository, new PolicyAnswerResolver({ trusthub }), () => "2026-01-01T00:00:00.000Z", undefined, library, cityValidator) };
}
async function say(c: ConversationCoordinator, id: string, text: string, n: number) {
  const understanding = await new DeterministicUnderstandingProvider().understand(text);
  return c.handleTurn({ conversationId: id, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `${id}-${n}` });
}

test("no city, then city, then consent: the community resolves from the saved request and consent processes", async () => {
  const { coordinator, repository } = setup();
  await say(coordinator, "21", "I need a reliable plumber", 0);
  const withCity = await say(coordinator, "21", "Anywhere in Harare", 1);
  assert.equal(withCity.action, "ask_community_permission");
  assert.equal(withCity.conversation.lastRequest?.location?.city, "Harare");
  assert.equal(await resolveCommunityFromPendingRequest(repository, trustHubClient, "21"), community.id);
  const consented = await say(coordinator, "21", "Yes", 2);
  assert.equal(consented.communityConsentGranted, true);
  assert.equal(consented.conversationId, "21");
  assert.equal(consented.conversation.lastRequest?.location?.city, "Harare");
  assert.equal(consented.conversation.lastRequest?.location?.country, "Zimbabwe");
});

test("a conversation with no saved city or an already-scoped community resolves no community", async () => {
  const { coordinator, repository } = setup();
  await say(coordinator, "22", "I need a place to stay", 0);
  assert.equal(await resolveCommunityFromPendingRequest(repository, trustHubClient, "22"), null);
  assert.equal(await resolveCommunityFromPendingRequest(repository, trustHubClient, "missing"), null);
});

test("short non-location replies are not taken as a city and the question is asked again", async () => {
  const { coordinator } = setup();
  await say(coordinator, "31", "I need a place to stay", 0);
  for (const [index, reply] of ["Thanks", "Okay", "Hello", "Yes"].entries()) {
    const result = await say(coordinator, "31", reply, index + 1);
    assert.equal(result.state, "clarification_needed", reply);
    assert.equal(result.conversation.lastRequest?.location?.city ?? null, null, reply);
    assert.match(result.reply, /Which city should I look in\?/, reply);
  }
});

test("an unrecognised place is not accepted as a city", async () => {
  const { coordinator } = setup();
  await say(coordinator, "32", "I need a place to stay", 0);
  const result = await say(coordinator, "32", "Narnia", 1);
  assert.equal(result.state, "clarification_needed");
  assert.equal(result.conversation.lastRequest?.location?.city ?? null, null);
});

test("legitimate city replies still continue the request", async () => {
  for (const [index, reply] of ["Harare", "Bulawayo", "Anywhere in Harare", "in Bulawayo"].entries()) {
    const { coordinator } = setup();
    await say(coordinator, `4${index}`, "I need a place to stay", 0);
    const result = await say(coordinator, `4${index}`, reply, 1);
    assert.equal(result.conversation.lastRequest?.category, "accommodation", reply);
    assert.match(result.conversation.lastRequest?.location?.city ?? "", /^(Harare|Bulawayo)$/, reply);
    assert.notEqual(result.state, "clarification_needed", reply);
  }
});

test("a greeting during clarification greets by name, keeps the pending request and re-asks the city", async () => {
  const { coordinator } = setup();
  const first = await say(coordinator, "51", "I need a place to stay", 0);
  const greeted = await say(coordinator, "51", "Hello", 1);
  assert.equal(greeted.state, "clarification_needed");
  assert.match(greeted.reply, new RegExp(`I'm ${first.conversation.assistantName}\\b`));
  assert.match(greeted.reply, /Which city should I look in\?/);
  assert.equal(greeted.conversation.lastRequest?.category, "accommodation");
  const answered = await say(coordinator, "51", "Harare", 2);
  assert.equal(answered.conversation.lastRequest?.location?.city, "Harare");
});

test("all ten identities run the same engine and library: replies differ only by the name", async () => {
  const script = ["Hi", "I need a place to stay", "Hello", "Thanks", "Anywhere in Harare"];
  const transcripts = new Map<string, string[]>();
  for (const name of ASSISTANT_NAMES) {
    const { coordinator } = setup();
    const id = await findConversationIdFor(name);
    const replies: string[] = [];
    for (const [index, text] of script.entries()) {
      const result = await say(coordinator, id, text, index);
      assert.equal(result.conversation.assistantName, name);
      replies.push(result.reply.replaceAll(name, "Wisdom"));
    }
    transcripts.set(name, replies);
  }
  assert.equal(transcripts.size, ASSISTANT_NAMES.length);
  const baseline = transcripts.get("Wisdom")!;
  const engineReplies = (replies: string[]) => [replies[1], replies[3], replies[4]];
  for (const [name, replies] of transcripts) assert.deepEqual(engineReplies(replies), engineReplies(baseline), name);
});

import { assignAssistantName } from "../lib/conversation-coordinator/wisdom-library.ts";
async function findConversationIdFor(name: string): Promise<string> {
  for (let index = 1; index < 10_000; index += 1) if (assignAssistantName(String(index)) === name) return String(index);
  throw new Error(`no conversation id maps to ${name}`);
}
