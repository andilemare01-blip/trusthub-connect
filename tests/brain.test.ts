import assert from "node:assert/strict";
import test from "node:test";
import { brainFallback, isAdviceQuestion, isOpenQuestion } from "../lib/connect/brain.ts";
import { ConnectJourneys, type ConnectContext } from "../lib/connect/journeys.ts";
import { InMemoryConnectStore } from "../lib/connect/store.ts";

const NOW = "2026-10-30T09:00:00.000Z";
const context: ConnectContext = { identityId: "301", profileName: "Andile", providerMessageId: "wamid.brain.1", assistantName: "Lizzie" };

test("open questions go to the brain; searches stay searches", () => {
  for (const text of ["I want to start a business in Harare, what would you advise?", "what businesses are in demand in Bulawayo?", "how much is rent in Avondale?", "is it a good idea to sell solar panels in Chinhoyi?"]) assert.equal(isOpenQuestion(text), true, text);
  for (const text of ["plumber in Avondale", "find phone shops in Harare", "where can I buy cement in Chinhoyi", "Hi"]) assert.equal(isOpenQuestion(text), false, text);
  assert.equal(isAdviceQuestion("Can you recommend a good plumber in Harare?"), false, "a recommendation for a provider is a search");
});

test("without the AI, business advice is laid out from the town's real demand, never from a typed question", () => {
  const pulse = { city: "Harare", topSearches: [{ label: "plumber", count: 4 }, { label: "to start a business", count: 1 }], notFound: [{ label: "solar installer", count: 3 }], newBusinesses: 0, newListings: 0, typicalPrices: [] };
  const reply = brainFallback("I want to start a business in Harare", "Harare", pulse, null, []);
  assert.match(reply, /solar installer: asked 3 times, nobody found/);
  assert.match(reply, /plumber \(4\)/);
  assert.doesNotMatch(reply, /to start a business/);
});

test("a follow-up carries the last exchange, so the conversation continues", async () => {
  const asked: string[] = [];
  const store = new InMemoryConnectStore(() => NOW);
  const engine = new ConnectJourneys(store, async (question) => { asked.push(question); return asked.length === 1 ? "Solar installers are in demand in Harare." : "In Bulawayo, plumbers are scarce."; }, () => new Date(NOW));
  const first = await engine.brainAnswer("what business should I start in Harare?", context);
  assert.match(first?.reply ?? "", /Solar installers are in demand/);
  assert.equal(first?.state?.flow, "brain");
  const next = await engine.handle("what about Bulawayo?", context, first!.state);
  assert.match(next?.reply ?? "", /In Bulawayo, plumbers are scarce/);
  assert.match(asked[1], /Earlier in this chat they asked: "what business should I start in Harare\?"/);
  const moved = await engine.handle("plumber in Avondale", context, next!.state);
  assert.equal(moved?.pass, true, "a plain search after an answer goes back to the normal search");
});
