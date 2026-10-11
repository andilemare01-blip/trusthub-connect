import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import { ConversationCoordinator } from "../lib/conversation-coordinator/coordinator.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { ASSISTANT_NAMES, WisdomLibrary, applyAssistantName, assignAssistantName, parseWisdomLibrary } from "../lib/conversation-coordinator/wisdom-library.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";

const library = WisdomLibrary.load();
const hit = { id: "ev-1", claim: "TrustHub lists Sunrise Guest House in Harare.", source: "trusthub" as const, sourceLabel: "TrustHub business record", verificationStatus: "verified" as const, confidence: "high" as const, retrievedAt: "2026-01-01T00:00:00.000Z", sourceRecordId: "biz-1" };
const searches: unknown[] = [];
function coordinator(repository = new InMemoryRuntimeConversationRepository()) {
  const trusthub = { async search(request: unknown) { searches.push(request); return { matchStatus: "matched" as const, evidence: [hit] }; } };
  return { repository, coordinator: new ConversationCoordinator(repository, new PolicyAnswerResolver({ trusthub }), () => "2026-01-01T00:00:00.000Z", undefined, library) };
}
async function say(c: ConversationCoordinator, conversationId: string, text: string, n: number) {
  const understanding = await new DeterministicUnderstandingProvider().understand(text);
  return c.handleTurn({ conversationId, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `${conversationId}-${n}` });
}

test("the real library file parses into the full 1,000-entry corpus", () => {
  const entries = parseWisdomLibrary(readLibraryText());
  assert.equal(entries.length, 1000);
  assert.equal(library.byCategory("new_hi").length, 15);
  assert.ok(library.byCategory("new_hi").every((entry) => /^TH-WIS-\d{4}$/.test(entry.id)));
});

test("a greeting is a library new_hi entry introduced under the assigned name", async () => {
  const { coordinator: c } = coordinator();
  const result = await say(c, "42", "Hi", 0);
  const name = assignAssistantName("42");
  assert.equal(result.conversation.assistantName, name);
  assert.match(result.reply, new RegExp(`I'm ${name}\\b`));
  const source = library.byCategory("new_hi").map((entry) => [applyAssistantName(entry.response, name), entry.nextMove]);
  assert.ok(source.some(([response, nextMove]) => result.reply === `${response}\n\n${nextMove}`));
  assert.notEqual(result.reply, "What are you trying to find or sort out?");
});

test("the name is only the self-reference: every identity yields the same entry text", () => {
  for (const name of ASSISTANT_NAMES) {
    const greeting = library.greeting("7", name)!;
    assert.equal(greeting.reply, applyAssistantName(library.greeting("7", "Wisdom")!.reply, name));
    assert.equal(greeting.reply.replaceAll(name, "Wisdom"), library.greeting("7", "Wisdom")!.reply);
  }
});

test("names are spread across conversations but fixed for any one conversation", () => {
  const seen = new Set(Array.from({ length: 200 }, (_, index) => assignAssistantName(String(index))));
  assert.equal(seen.size, ASSISTANT_NAMES.length);
  assert.equal(assignAssistantName("99"), assignAssistantName("99"));
});

test("accommodation request, then 'Anywhere in Harare', continues instead of restarting", async () => {
  const { coordinator: c, repository } = coordinator();
  const first = await say(c, "5", "Hi", 0);
  const second = await say(c, "5", "I need a place to stay", 1);
  assert.equal(second.state, "clarification_needed");
  assert.match(second.reply, /Which city/);
  searches.length = 0;
  const third = await say(c, "5", "Anywhere in Harare", 2);
  assert.doesNotMatch(third.reply, /trying to find or sort out/);
  assert.equal(third.state, "answer_found");
  assert.match(third.reply, /Sunrise Guest House/);
  assert.equal(third.conversation.lastRequest?.category, "place to stay");
  assert.equal(third.conversation.lastRequest?.location?.city, "Harare");
  assert.equal(searches.length, 1);
  assert.equal(third.conversation.assistantName, first.conversation.assistantName);
  assert.equal((await repository.get("5"))?.assistantName, first.conversation.assistantName);
});

test("a bare city reply and a repeated greeting keep the same request and name", async () => {
  const { coordinator: c } = coordinator();
  const opening = await say(c, "11", "I want a plumber", 0);
  assert.equal(opening.state, "clarification_needed");
  const greeted = await say(c, "11", "Hello", 1);
  assert.equal(greeted.state, "clarification_needed");
  const answered = await say(c, "11", "Bulawayo", 2);
  assert.equal(answered.conversation.lastRequest?.location?.city, "Bulawayo");
  assert.equal(answered.conversation.assistantName, opening.conversation.assistantName);
});

test("no request and no pending clarification keeps the generic prompt", async () => {
  const { coordinator: c } = coordinator();
  const result = await say(c, "13", "What time is it?", 0);
  assert.equal(result.reply, "What are you trying to find or sort out?");
});

import { readFileSync } from "node:fs";
function readLibraryText() { return readFileSync("docs/TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md", "utf8"); }
