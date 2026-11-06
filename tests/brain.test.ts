import assert from "node:assert/strict";
import test from "node:test";
import { brainFallback, fitOneMessage, isAdviceQuestion, isOpenQuestion, requestedWebsite } from "../lib/connect/brain.ts";
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

import { plausibleName } from "../lib/connect/journeys.ts";

test("names are recognised however people give them, and requests are never taken as names", () => {
  assert.equal(plausibleName("Andile"), "Andile");
  assert.equal(plausibleName("my name is tendai moyo"), "Tendai Moyo");
  assert.equal(plausibleName("call me Tino"), "Tino");
  for (const text of ["9", "plumber in Avondale", "Harare", "yes", "hi", "I need a hotel in Masvingo please"]) assert.equal(plausibleName(text), null, text);
});

test("a new person is asked for a name once, it is saved, and the profile shows it with their searches", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  const engine = new ConnectJourneys(store, undefined, () => new Date(NOW));
  const ctx: ConnectContext = { identityId: "401", profileName: null, providerMessageId: "wamid.name.1", assistantName: "Grace" };
  const hello = await engine.handle("Hi", ctx, null);
  assert.match(hello?.reply ?? "", /What should I call you\? Just type your first name\./);
  const saved = await engine.handle("Andile", ctx, hello!.state);
  assert.match(saved?.reply ?? "", /Nice to meet you, Andile! You're saved/);
  assert.equal(store.names.get("401"), "Andile");
  await store.logSearch({ identityId: "401", journey: "find", category: "plumber", city: "Harare", area: null, queryText: "plumber in Avondale", resultCount: 3, sourceMessageId: "s1" });
  const profile = await engine.handle("10", { ...ctx, profileName: "Andile" }, null);
  assert.match(profile?.reply ?? "", /\*Andile's TrustHub profile\*/);
  assert.match(profile?.reply ?? "", /Your recent searches\*\n• plumber in Avondale · Harare/);
  const menuChoice = await engine.handle("9", ctx, hello!.state);
  assert.doesNotMatch(menuChoice?.reply ?? "", /Nice to meet you/, "a menu number is never taken as a name");
});

test("freelancing questions go to the brain, but finding a freelancer stays a search", () => {
  for (const text of ["How do I start freelancing from Chiredzi?", "How can I get clients as a graphic designer?", "Can I make money on Fiverr in Zimbabwe?"]) assert.equal(isOpenQuestion(text), true, text);
  assert.equal(isOpenQuestion("find a freelance designer in Harare"), false);
});

test("a long answer fits one WhatsApp message and ends on a full sentence", () => {
  const answer = fitOneMessage("Start small with one service. ".repeat(60));
  assert.ok(answer.length <= 900);
  assert.match(answer, /service\.$/);
});

test("a site is found however it was typed", () => {
  const sites = [{ name: "Propertybook", website: "https://www.propertybook.co.zw/" }, { name: "CarMusika", website: "https://www.carmusika.com/" }];
  assert.equal(requestedWebsite("Give me the link to property book.co.zw", sites)?.name, "Propertybook");
  assert.equal(requestedWebsite("carmusika website please", sites)?.name, "CarMusika");
  assert.equal(requestedWebsite("houses on propertybook", sites), null);
  assert.equal(requestedWebsite("link to some other site", sites), null);
});

test("asking for a known site's link gets the link straight away", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.websites.push({ name: "Propertybook", website: "https://www.propertybook.co.zw/" });
  const reply = await new ConnectJourneys(store).handle("Give me the link to property book.co.zw", context, null);
  assert.match(reply?.reply ?? "", /https:\/\/www\.propertybook\.co\.zw\//);
});
