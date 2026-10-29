import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import type { AnswerSource } from "../lib/answer-resolution/types.ts";
import { ConversationCoordinator } from "../lib/conversation-coordinator/coordinator.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { ConnectJourneys, type DeepQuestionAnswerer } from "../lib/connect/journeys.ts";
import { InMemoryConnectStore, type ConnectStore } from "../lib/connect/store.ts";

const NOW = "2026-10-29T10:00:00.000Z";
const empty: AnswerSource = { async search() { return { matchStatus: "none", evidence: [] }; } };

function setup(options: { answerer?: DeepQuestionAnswerer; store?: InMemoryConnectStore } = {}) {
  const store = options.store ?? new InMemoryConnectStore(() => NOW);
  store.businesses.push(
    { id: "11111111-1111-4111-8111-111111111111", name: "Sunny Bakery", category: "bakery", city: "Chinhoyi", area: null, phone: null, reviewsCount: 3 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Moyo Plumbing", category: "plumber", city: "Harare", area: "Avondale", phone: "+263771111111", reviewsCount: 5 },
    { id: "33333333-3333-4333-8333-333333333333", name: "Moyo Hardware", category: "hardware", city: "Harare", area: "Belgravia", phone: null, reviewsCount: 0 },
  );
  store.cards.push({ id: "card-1", code: "TH-1042", status: "active", business: store.businesses[1] });
  const journeys = new ConnectJourneys(store, options.answerer, () => new Date(NOW));
  const coordinator = new ConversationCoordinator(new InMemoryRuntimeConversationRepository(), new PolicyAnswerResolver({ trusthub: empty }), () => NOW, undefined, null, undefined, undefined, { journeys, store });
  let n = 0;
  const say = (text: string, identityId: string | null = "101", conversationId = "c1") => coordinator.handleTurn({ conversationId, channel: "whatsapp", text, providerMessageId: `wamid.${conversationId}.${n += 1}`, identityId, senderPhoneNumber: "+263772222222" });
  return { store, say };
}

test("a first greeting grants the welcome credits once and a later one says welcome back", async () => {
  const { store, say } = setup();
  const first = await say("Hi");
  assert.match(first.reply, /I help you find trusted businesses/);
  assert.equal(await store.creditBalance("101"), 10);
  const again = await say("Hello");
  assert.match(again.reply, /^Welcome back! It's /);
  assert.equal(await store.creditBalance("101"), 10, "the welcome grant is never given twice");
});

test("tapping a review card reviews that business, marks a verified visit and earns a credit", async () => {
  const { store, say } = setup();
  await say("Hi");
  const opened = await say("REVIEW TH-1042");
  assert.match(opened.reply, /You're reviewing \*Moyo Plumbing\* in Avondale, Harare/);
  assert.equal(opened.interactive?.type, "list");
  const rated = await say("rate:4");
  assert.match(rated.reply, /add a few words/);
  const saved = await say("Came the same day and the price was fair.");
  assert.match(saved.reply, /^Saved\. Thank you!/);
  assert.match(saved.reply, /Verified visit/);
  assert.match(saved.reply, /Your review is live/);
  assert.match(saved.reply, /you now have 11/);
  assert.equal(store.reviews.length, 1);
  assert.deepEqual({ business: store.reviews[0].businessId, rating: store.reviews[0].rating, verified: store.reviews[0].verifiedVisit, card: store.reviews[0].cardCode, status: store.reviews[0].status },
    { business: "22222222-2222-4222-8222-222222222222", rating: 4, verified: true, card: "TH-1042", status: "published" });
  assert.equal(saved.conversation.connect, null);
});

test("an unknown or inactive card falls back to asking for the business name", async () => {
  const { say } = setup();
  const result = await say("REVIEW TH-9999");
  assert.match(result.reply, /isn't active/);
  assert.equal(result.conversation.connect?.step, "which");
});

test("a review from the menu finds the business, confirms it, saves as pending and blocks a repeat", async () => {
  const { store, say } = setup();
  await say("2");
  const found = await say("Sunny Bakery, Chinhoyi");
  assert.match(found.reply, /Is it \*Sunny Bakery\* in Chinhoyi\?/);
  await say("btn.yes");
  await say("5");
  const saved = await say("btn.skip");
  assert.match(saved.reply, /It will appear after a quick check/);
  assert.equal(store.reviews[0].status, "pending");
  assert.equal(store.reviews[0].text, "");
  await say("menu.review");
  await say("Sunny Bakery");
  const repeat = await say("yes");
  assert.match(repeat.reply, /You already reviewed \*Sunny Bakery\*/);
  assert.equal(store.reviews.length, 1);
});

test("several matches come back as a pick list, and a missing business offers to add it", async () => {
  const { say } = setup();
  await say("menu.review");
  const many = await say("Moyo");
  assert.equal(many.interactive?.type, "list");
  assert.equal(many.interactive?.sections?.[0].rows.length, 2);
  const picked = await say("biz:33333333-3333-4333-8333-333333333333");
  assert.match(picked.reply, /How was \*Moyo Hardware\*\?/);
  await say("menu.review");
  const none = await say("Tariro Salon in Gweru");
  assert.match(none.reply, /couldn't find \*Tariro Salon\* in Gweru/);
  const offer = await say("btn.add_it");
  assert.match(offer.reply, /What kind of business is \*Tariro Salon\*/);
});

test("adding a business asks one thing at a time, catches duplicates and saves only after Submit", async () => {
  const { store, say } = setup();
  await say("3");
  await say("Green Leaf Butchery");
  await say("butchery");
  const phone = await say("Waterfalls, Harare");
  assert.match(phone.reply, /phone number/);
  const confirm = await say("0773 333 444");
  assert.match(confirm.reply, /Here's what I'll add/);
  assert.match(confirm.reply, /Waterfalls, Harare/);
  assert.equal(store.submissions.length, 0, "nothing is saved before Submit");
  const done = await say("btn.submit");
  assert.match(done.reply, /waiting for a quick check/);
  assert.equal(store.submissions.length, 1);
  assert.deepEqual({ city: store.submissions[0].city, area: store.submissions[0].area, phone: store.submissions[0].phone }, { city: "Harare", area: "Waterfalls", phone: "+263773333444" });

  await say("3");
  await say("Moyo Plumbing");
  await say("plumber");
  await say("Harare");
  const duplicate = await say("skip");
  assert.match(duplicate.reply, /already on TrustHub/);
  const same = await say("btn.same");
  assert.match(same.reply, /Would you like to review it\?/);
  assert.equal(store.submissions.length, 1);
});

test("selling posts a pending listing from one message and tells the seller about demand", async () => {
  const { store, say } = setup();
  await store.logSearch({ identityId: "999", journey: "buy_sell", category: "phones", city: "Chinhoyi", area: null, queryText: "phone", resultCount: 0, sourceMessageId: "x" });
  await say("4");
  await say("btn.sell");
  const preview = await say("Samsung A15 128GB, good condition, $120, Chinhoyi");
  assert.match(preview.reply, /Item: \*Samsung A15 128GB, good condition\*/);
  assert.match(preview.reply, /Price: \$120/);
  assert.match(preview.reply, /Where: Chinhoyi/);
  const posted = await say("btn.post");
  assert.match(posted.reply, /Pending check/);
  assert.match(posted.reply, /1 person searched for phones in Chinhoyi/);
  assert.equal(store.listings.length, 1);
  assert.deepEqual({ intent: store.listings[0].intent, category: store.listings[0].category, status: store.listings[0].status, phone: store.listings[0].phone }, { intent: "offering", category: "phones", status: "pending", phone: "+263772222222" });
});

test("a listing without a town asks for it, and Cancel saves nothing", async () => {
  const { store, say } = setup();
  await say("menu.buy_sell");
  await say("btn.sell");
  const town = await say("Wooden table, $40");
  assert.match(town.reply, /Which town/);
  await say("Kadoma");
  const cancelled = await say("btn.cancel");
  assert.match(cancelled.reply, /didn't post it/);
  assert.equal(store.listings.length, 0);
});

test("buying searches listings, labels unchecked ones, logs the search and can post a request", async () => {
  const { store, say } = setup();
  store.listings.push({ id: "l1", intent: "offering", category: "electronics", title: "Defy fridge, 2 doors", priceText: "$250", city: "Harare", area: "Mabelreign", phone: "+263774444444", status: "pending", createdAt: NOW });
  await say("menu.buy_sell");
  await say("btn.buy");
  const results = await say("fridge in Harare under $300");
  assert.match(results.reply, /Defy fridge/);
  assert.match(results.reply, /Not yet checked/);
  assert.match(results.reply, /wa\.me\/263774444444/);
  assert.equal(store.searches.at(-1)?.resultCount, 1);
  const none = await say("generator in Gweru");
  assert.match(none.reply, /Nothing listed for that yet in Gweru/);
  assert.equal(store.searches.at(-1)?.resultCount, 0);
  const request = await say("btn.request");
  assert.match(request.reply, /Wanted: \*Generator\*/);
  await say("btn.post");
  assert.equal(store.listings.at(-1)?.intent, "seeking");
});

test("jobs and houses use the right listing types", async () => {
  const { store, say } = setup();
  await say("5");
  await say("btn.hire");
  await say("Shop assistant, Chinhoyi, $150 a month");
  await say("btn.post");
  assert.deepEqual({ intent: store.listings[0].intent, category: store.listings[0].category }, { intent: "recruiting", category: "jobs" });
  await say("5");
  await say("btn.find_work");
  const jobs = await say("shop assistant in Chinhoyi");
  assert.match(jobs.reply, /Shop assistant/);
  await say("6");
  await say("btn.list_place");
  await say("2-room cottage, $180 a month, Waterfalls, Harare");
  await say("btn.post");
  assert.deepEqual({ intent: store.listings[1].intent, category: store.listings[1].category, area: store.listings[1].area }, { intent: "offering", category: "property", area: "Waterfalls" });
});

test("scam check masks the number, shows reports and accepts one report per person", async () => {
  const { store, say } = setup();
  const clean = await say("check 0771 234 567 before I pay");
  assert.match(clean.reply, /No reports found\* for \+263 77X XXX 567/);
  assert.doesNotMatch(clean.reply, /0771 234 567|771234567/);
  await say("btn.report");
  const thanks = await say("Asked for a deposit and stopped replying");
  assert.match(thanks.reply, /never share who reported/);
  await say("menu.scam");
  const flagged = await say("0771234567");
  assert.match(flagged.reply, /reported by 1 person/);
  assert.match(flagged.reply, /Asked for a deposit/);
  await say("btn.report");
  const again = await say("Same person again");
  assert.match(again.reply, /already reported/);
  assert.equal(store.scamReports.length, 1);
});

test("the area pulse uses real searches and says so honestly when there are none", async () => {
  const { store, say } = setup();
  const quiet = await say("7");
  assert.match(quiet.reply, /Which town/);
  const early = await say("town:Mutare");
  assert.match(early.reply, /early days for Mutare/);
  for (const category of ["solar installer", "solar installer", "plumber"]) {
    await store.logSearch({ identityId: "5", journey: "find", category, city: "Harare", area: null, queryText: category, resultCount: category === "plumber" ? 2 : 0, sourceMessageId: null });
  }
  await say("menu.area");
  const pulse = await say("town:Harare");
  assert.match(pulse.reply, /\*Harare this week\*/);
  assert.match(pulse.reply, /1\. solar installer · 2 searches/);
  assert.match(pulse.reply, /Asked for, but not found/);
  const unrelated = await say("plumber in Harare");
  assert.notEqual(unrelated.conversation.connect?.flow, "area", "a new request after the pulse leaves the pulse");
});

test("Ask Wisdom confirms before spending a credit and only charges once it has answered", async () => {
  let calls = 0;
  const answerer: DeepQuestionAnswerer = async () => { calls += 1; return calls === 1 ? "Data shows 3 searches for car washes in Avondale and none listed." : null; };
  const { store, say } = setup({ answerer });
  await say("Hi");
  await say("9");
  const confirm = await say("Where in Harare should I open a car wash?");
  assert.match(confirm.reply, /uses \*1 credit\*/);
  assert.match(confirm.reply, /You have 10/);
  assert.equal(calls, 0, "nothing is spent or asked before the person confirms");
  const answered = await say("btn.use_credit");
  assert.match(answered.reply, /3 searches for car washes/);
  assert.match(answered.reply, /9 credits left/);
  await say("9");
  await say("What sells best in Chinhoyi?");
  const failed = await say("btn.use_credit");
  assert.match(failed.reply, /nothing was charged/);
  assert.equal(await store.creditBalance("101"), 9, "a question that gets no answer costs nothing, so there is nothing to refund");
});

test("without AI, Ask Wisdom hands the question to the normal free search", async () => {
  const { say } = setup();
  await say("9");
  const result = await say("plumber in Harare");
  assert.equal(result.conversation.connect, null);
  assert.notEqual(result.action, "show_menu");
});

test("profile shows credits and activity, and feedback is saved only when sent", async () => {
  const { store, say } = setup();
  await say("Hi");
  const profile = await say("10");
  assert.match(profile.reply, /Credits: 10/);
  assert.match(profile.reply, /Reviews: 0 · Listings: 0 · Businesses added: 0/);
  const passed = await say("plumber in Harare");
  assert.equal(store.feedback.length, 0, "a search typed on the profile screen is not feedback");
  assert.notEqual(passed.conversation.connect?.flow, "feedback");
  await say("10");
  await say("btn.feedback");
  const thanks = await say("The menu is easy now, thank you");
  assert.match(thanks.reply, /reads every message/);
  assert.equal(store.feedback.length, 1);
});

test("cancel and MENU leave any flow, and a store failure never claims success", async () => {
  const { say } = setup();
  await say("3");
  await say("Green Leaf");
  const left = await say("cancel");
  assert.equal(left.action, "show_menu");
  assert.equal(left.conversation.connect, null);

  const failing = new InMemoryConnectStore(() => NOW);
  (failing as unknown as ConnectStore).saveReview = async () => { throw new Error("database down"); };
  const broken = setup({ store: failing });
  await broken.say("REVIEW TH-1042");
  await broken.say("4");
  const result = await broken.say("Good service");
  assert.match(result.reply, /nothing was saved/);
  assert.doesNotMatch(result.reply, /Saved\. Thank you/);
  assert.equal(result.conversation.connect?.step, "comment", "the person can simply try again");
});

test("the same WhatsApp message delivered twice saves one review", async () => {
  const { store } = setup();
  const journeys = new ConnectJourneys(store, undefined, () => new Date(NOW));
  const context = { identityId: "101", profileName: null, providerMessageId: "wamid.same", assistantName: "Wisdom" };
  const state = { flow: "review" as const, step: "comment", data: { businessId: "22222222-2222-4222-8222-222222222222", businessName: "Moyo Plumbing", rating: 5, verified: false, cardCode: null } };
  await journeys.handle("Great", context, state);
  await journeys.handle("Great", context, state);
  assert.equal(store.reviews.length, 1);
});

test("button and list messages keep their line breaks", async () => {
  const { say } = setup();
  await say("menu.buy_sell");
  await say("btn.sell");
  const preview = await say("Samsung A15, $120, Chinhoyi");
  assert.match(preview.interactive?.body ?? "", /\nItem: \*Samsung A15\*\nPrice: \$120\nWhere: Chinhoyi/);
  const welcome = await say("Hi");
  assert.match(welcome.interactive?.body ?? "", /\n\nWhat would you like to do\?$/);
});
