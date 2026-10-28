import assert from "node:assert/strict";
import test from "node:test";
import { AiGateway } from "../lib/ai/gateway.ts";
import { InMemoryAiSpendLedger } from "../lib/ai/spend-ledger.ts";
import { readAiConfig, FALLBACK_OPENROUTER_MODELS, DEFAULT_OPENROUTER_MODEL } from "../lib/ai/config.ts";
import { createDeepQuestionAnswerer } from "../lib/connect/ask-wisdom.ts";
import { distribution, suggestRoutes } from "../lib/connect/intent-classifier.ts";
import { CONNECT_INTENT_MODEL } from "../lib/connect/intent-classifier.generated.ts";
import { ConnectJourneys, type ConnectContext, type DeepQuestionAnswerer } from "../lib/connect/journeys.ts";
import { MENU_ROWS } from "../lib/connect/menu.ts";
import { isDeepCue, isFeedbackCue, isSearchLike, readReviewsQuestion } from "../lib/connect/routes.ts";
import { InMemoryConnectStore } from "../lib/connect/store.ts";

const NOW = "2026-10-29T10:00:00.000Z";
const context: ConnectContext = { identityId: "101", profileName: "Tendai", providerMessageId: "wamid.1", assistantName: "Wisdom" };

// ---------------------------------------------------------------- routing rules

test("plain-language requests to read reviews are understood, with the subject and town", () => {
  assert.deepEqual(readReviewsQuestion("What do people say about chicken in Chiredzi?"), { terms: ["chicken"], city: "Chiredzi" });
  const asked = readReviewsQuestion("I would like to see what people have to say about chicken in Chiredzi");
  assert.ok(asked, "the message from the bug report is recognised");
  assert.equal(asked!.city, "Chiredzi");
  assert.ok(asked!.terms.includes("chicken"));
  assert.deepEqual(readReviewsQuestion("reviews for Sunny Bakery")?.terms, ["sunny", "bakery"]);
  assert.ok(readReviewsQuestion("Is Mai Zhou Catering reliable?"));
});

test("writing or answering a review is not mistaken for reading reviews", () => {
  assert.equal(readReviewsQuestion("I want to write a review"), null);
  assert.equal(readReviewsQuestion("I'd like to leave a review"), null);
  assert.equal(readReviewsQuestion("How do I respond to a bad review?"), null);
});

test("a plain search is free; a question needing judgement is a deep question", () => {
  assert.equal(isSearchLike("Find me a hotel in Harare"), true);
  assert.equal(isSearchLike("plumber in Avondale"), true);
  assert.equal(isSearchLike("What sells best in Chinhoyi?"), false, "a town alone does not make a question a search");
  assert.equal(isSearchLike("Should I open a car wash in Harare?"), false);
  assert.equal(isDeepCue("Where in Harare should I open a car wash?"), true);
});

test("complaints about the bot or requests to improve it are saved as feedback", () => {
  assert.equal(isFeedbackCue("The bot did not understand me"), true);
  assert.equal(isFeedbackCue("You're slow"), true);
  assert.equal(isFeedbackCue("please add a plumber in Chinhoyi"), true);
  assert.equal(isFeedbackCue("plumber in Harare"), false);
});

// ------------------------------------------------------------ learned suggestions

test("the trained model suggests the route for clear messages and never for nonsense", () => {
  assert.ok(CONNECT_INTENT_MODEL.intents.length > 50, "model was trained on the dataset");
  const top = distribution(CONNECT_INTENT_MODEL, "I want to sell my fridge in Harare")[0];
  assert.equal(top.intent, "sell_item");
  assert.deepEqual(suggestRoutes("zxqv blorp"), []);
  const suggestions = suggestRoutes("I want to sell my fridge in Harare");
  assert.equal(suggestions[0]?.route, "sell");
});

// ------------------------------------------------------------------ AI fallback

test("a retired model is skipped: the next model answers and both attempts are accounted for", async () => {
  const status = readAiConfig({ AI_PROVIDER_API_KEY: "key-for-test" });
  assert.equal(status.enabled, true);
  if (!status.enabled) return;
  assert.equal(status.config.models[0], DEFAULT_OPENROUTER_MODEL);
  assert.ok(FALLBACK_OPENROUTER_MODELS.every((model) => status.config.models.includes(model)));

  const called: string[] = [];
  const failures: { reason: string; model: string; providerStatus?: number }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model as string;
    called.push(model);
    if (called.length === 1) return new Response(JSON.stringify({ error: { message: "No endpoints found" } }), { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Plenty of plumbers." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }) as typeof fetch;
  const ledger = new InMemoryAiSpendLedger();
  const gateway = new AiGateway(status, ledger, fetchImpl, () => NOW, (failure) => { failures.push(failure); });

  const result = await gateway.complete({ key: "k1", purpose: "deep_question", system: "s", user: "u" });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.text, "Plenty of plumbers.");
  assert.deepEqual(called, [status.config.models[0], status.config.models[1]]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "model_access");
  assert.equal(failures[0].providerStatus, 404);
  assert.equal(ledger.entries.length, 1, "only the answered attempt costs anything to record");
  assert.equal(ledger.entries[0].key, "k1~1", "each attempt has its own ledger key");
});

test("when no model answers, the caller gets a failure and no answer is invented", async () => {
  const status = readAiConfig({ AI_PROVIDER_API_KEY: "key-for-test" });
  if (!status.enabled) return;
  const fetchImpl = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  const gateway = new AiGateway(status, new InMemoryAiSpendLedger(), fetchImpl, () => NOW);
  const answerer = createDeepQuestionAnswerer(gateway, new InMemoryConnectStore(() => NOW));
  assert.equal(await answerer("Where should I open a car wash?", "Harare", "k2"), null);
});

// ----------------------------------------------------------- Ask Wisdom behaviour

function journeys(answerer?: DeepQuestionAnswerer) {
  const store = new InMemoryConnectStore(() => NOW);
  store.businesses.push({ id: "11111111-1111-4111-8111-111111111111", name: "Sunny Bakery", category: "bakery", city: "Chinhoyi", area: null, phone: null, reviewsCount: 3 });
  return { store, journeys: new ConnectJourneys(store, answerer, () => new Date(NOW)) };
}

test("without an answer, Ask Wisdom costs nothing and says so", async () => {
  const { store, journeys: engine } = journeys(async () => null);
  await store.addCredits("101", 10, "welcome", "welcome");
  await engine.handle("Ask Wisdom", context, null);
  await engine.handle("Where in Harare should I open a car wash?", context, { flow: "ask", step: "question", data: {} });
  const confirmed = await engine.handle("btn.use_credit", context, { flow: "ask", step: "confirm", data: { question: "Where in Harare should I open a car wash?" } });
  assert.match(confirmed?.reply ?? "", /nothing was charged/);
  assert.equal(await store.creditBalance("101"), 10);
});

test("with no AI configured, deep questions are declined without a charge, and searches still work", async () => {
  const { store, journeys: engine } = journeys(undefined);
  await store.addCredits("101", 10, "welcome", "welcome");
  const deep = await engine.handle("Should I open a car wash in Harare?", context, { flow: "ask", step: "question", data: {} });
  assert.match(deep?.reply ?? "", /resting right now/);
  assert.equal(await store.creditBalance("101"), 10);
  const search = await engine.handle("Find me a hotel in Harare", context, { flow: "ask", step: "question", data: {} });
  assert.equal(search?.pass, true, "a plain search goes to the free search path");
});

test("feedback typed inside Ask Wisdom is saved, not treated as a question", async () => {
  const { store, journeys: engine } = journeys(async () => "unused");
  await engine.handle("Ask Wisdom", context, null);
  const reply = await engine.handle("The bot did not understand me", context, { flow: "ask", step: "question", data: {} });
  assert.match(reply?.reply ?? "", /noted/);
  assert.equal(store.feedback.length, 1);
  assert.equal(await store.creditBalance("101"), 0);
});

// ----------------------------------------------------------------- review reading

test("people can read what others said about a kind of business in a town", async () => {
  const { store, journeys: engine } = journeys();
  store.businesses.push({ id: "44444444-4444-4444-8444-444444444444", name: "Chiredzi Chicken Inn", category: "food", city: "Chiredzi", area: null, phone: null, reviewsCount: 1 });
  await store.saveReview({ businessId: "44444444-4444-4444-8444-444444444444", identityId: "202", rating: 5, text: "Crispy and fast, best in town", verifiedVisit: true, cardCode: null, sourceMessageId: "m-1" });
  const reply = await engine.handle("I would like to see what people have to say about chicken in Chiredzi", context, null);
  assert.ok(reply, "the question is answered by the reviews path");
  assert.match(reply!.reply, /Crispy and fast/);
  assert.match(reply!.reply, /Chiredzi Chicken Inn/);
  assert.match(reply!.reply, /Verified visit/);
});

test("a question with no reviews invites the first one instead of guessing", async () => {
  const { journeys: engine } = journeys();
  const reply = await engine.handle("What do people say about pizza in Bindura?", context, null);
  assert.match(reply?.reply ?? "", /Be the first/);
});

test("the review menu offers writing or reading, and reading asks which business", async () => {
  const { journeys: engine } = journeys();
  const menu = await engine.begin("menu.review", context);
  assert.equal(menu.interactive?.type, "button");
  const read = await engine.handle("btn.read_reviews", context, menu.state);
  assert.match(read?.reply ?? "", /Which business/);
  const answered = await engine.handle("chicken in Chiredzi", context, read?.state ?? null);
  assert.match(answered?.reply ?? "", /chicken/);
});

// --------------------------------------------------------------- persona and copy

test("small talk and requests for a joke get a witty reply under the assistant's name", async () => {
  const { journeys: engine } = journeys();
  const joke = await engine.handle("Tell me a joke", context, null);
  assert.ok(joke?.reply && joke.reply.length > 20);
  const hi = await engine.handle("How are you?", { ...context, assistantName: "Tanaka" }, null);
  assert.match(hi?.reply ?? "", /Tanaka/);
});

test("'Thanks' during a pending question is not swallowed by small talk", async () => {
  const { journeys: engine } = journeys();
  assert.equal(await engine.handle("Thanks", context, null), null, "the coordinator decides what 'Thanks' means mid-question");
});

test("every menu title fits WhatsApp's 24-character limit, and carries an emoji", () => {
  for (const row of MENU_ROWS) {
    assert.ok([...row.title].length <= 24, row.title);
    assert.match(row.title, /^\p{Extended_Pictographic}/u, `${row.title} starts with an emoji`);
  }
});

// ------------------------------------------------------------ listing titles

test("messy listing descriptions become clean titles", async () => {
  const { listingTitle } = await import("../lib/connect/parse.ts");
  assert.equal(listingTitle("Its an I Phone 12 and its and its, $250, Harare"), "iPhone 12");
  assert.equal(listingTitle("I have a iphone 12 for sale $250 Harare"), "iPhone 12");
  assert.equal(listingTitle("selling Samsung A15 $120 Chinhoyi"), "Samsung A15");
  assert.equal(listingTitle("Its a 2 room cottage $180 a month Waterfalls Harare"), "2 room cottage");
  assert.equal(listingTitle("Its an I Pad 2021 for sale $300 Chinhoyi"), "iPad 2021");
});
