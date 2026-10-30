import assert from "node:assert/strict";
import test from "node:test";
import { momentOf, personalise, voiceLine } from "../lib/connect/voice.ts";
import { rotateAssistantName } from "../lib/conversation-coordinator/coordinator.ts";
import { ASSISTANT_NAMES } from "../lib/conversation-coordinator/wisdom-library.ts";
import { InMemoryConnectStore, type Listing } from "../lib/connect/store.ts";

test("everyday moments are recognised", () => {
  assert.equal(momentOf("Thanks!"), "thanks");
  assert.equal(momentOf("thank you so much"), "thanks");
  assert.equal(momentOf("bye"), "goodbye");
  assert.equal(momentOf("tell me a joke"), "light_joke");
  assert.equal(momentOf("how are you?"), "smalltalk_weather");
  assert.equal(momentOf("are you a bot?"), "who_are_you");
  assert.equal(momentOf("you don't understand me"), "misunderstanding");
  assert.equal(momentOf("this is useless"), "frustration");
  assert.equal(momentOf("plumber in Avondale"), null);
  assert.equal(momentOf("thanks, now find me a plumber in Avondale and a builder in Ruwa please, quickly"), "thanks", "short is not required for thanks at the start");
});

test("library lines use the assistant's name, the person's own name or none, and real emoji", () => {
  assert.equal(personalise("Good morning, Tapiwa. We meet again [smile]", "Lizzie", "Andile"), "Good morning, Andile. We meet again 🙂");
  assert.equal(personalise("Good morning, Tapiwa. We meet again [smile]", "Lizzie", null), "Good morning. We meet again 🙂");
  assert.equal(personalise("You're welcome, Farai. Glad we got somewhere. <3", "Grace", null), "You're welcome. Glad we got somewhere. ❤️");
  assert.equal(personalise("I'm Wisdom from TrustHub.", "Daniel", null), "I'm Daniel from TrustHub.");
});

test("the same moment never gives the same line twice in a row", () => {
  const first = voiceLine("thanks", "Lizzie", null, () => 0);
  const second = voiceLine("thanks", "Lizzie", null, () => 0);
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.doesNotMatch(`${first} ${second}`, /\b(Tapiwa|Farai|Tendai|Rudo|Chipo|Brian|Nyasha|Tawanda)\b|\[smile\]/);
});

test("a new visit brings a different one of the ten names", () => {
  for (const current of ASSISTANT_NAMES) {
    const next = rotateAssistantName("identity:7", "2026-10-30T09:00:00.000Z", current);
    assert.notEqual(next, current);
    assert.ok(ASSISTANT_NAMES.includes(next as never));
  }
});

test("a business named in the wrong town is still found, so the person can confirm it", async () => {
  const store = new InMemoryConnectStore(() => "2026-10-30T08:00:00.000Z");
  store.businesses.push({ id: "b1", name: "Clevers Hotel", city: "Chiredzi", area: null } as never);
  assert.equal((await store.searchDirectory("Clevers Hotel", "Zvishavane", 5)).length, 0, "adding a business still checks only its own town");
  assert.equal((await store.searchDirectory("Clevers Hotel", "Zvishavane", 5, true))[0]?.city, "Chiredzi");
});

test("listings that match more of the words come first, and Jobs/jobs category case does not matter", async () => {
  const store = new InMemoryConnectStore(() => "2026-10-30T08:00:00.000Z");
  const item = (id: string, title: string, category = "Vehicles", intent = "offering") => ({ id, intent, category, title, priceText: null, city: "Harare", area: null, phone: null, status: "pending", createdAt: "2026-10-30T08:00:00.000Z" }) as Listing;
  store.listings.push(item("k", "Fitted kitchen units"), item("h", "Honda Fit 2015 for sale"), item("j", "Accountant wanted", "Jobs", "recruiting"));
  const cars = await store.searchListings({ intents: ["offering"], words: ["honda", "fit"], limit: 5 });
  assert.equal(cars[0].id, "h");
  const jobs = await store.searchListings({ intents: ["recruiting"], words: [], category: "jobs", city: "Harare", limit: 5 });
  assert.deepEqual(jobs.map((job) => job.id), ["j"]);
});
