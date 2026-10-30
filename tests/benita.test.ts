import assert from "node:assert/strict";
import test from "node:test";
import { benitaLine, benitaReply, factIntent, factReply, mapBenitaResult, type BenitaFact, type BenitaResult } from "../lib/benita/index.ts";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";
import { ConnectJourneys } from "../lib/connect/journeys.ts";
import { InMemoryConnectStore } from "../lib/connect/store.ts";
import { SupabaseConnectStore, type ConnectDbClient } from "../lib/connect/supabase-store.ts";

import { correctTown } from "../lib/connect/parse.ts";
import { evidenceMatchesRequest } from "../lib/conversation-coordinator/coordinator.ts";
import type { EvidenceItem, NormalizedRequest } from "../lib/answer-resolution/types.ts";

const NOW = "2026-10-29T10:00:00.000Z";

function result(overrides: Partial<BenitaResult> = {}): BenitaResult {
  return {
    kind: "place", id: "k1", businessId: null, name: "Lobengula Bakery", category: "Food & Dining", subcategory: "bakery", city: "Bulawayo", area: "Lobengula",
    phone: "+263771234567", whatsapp: null, website: null, address: null, priceText: null, intent: null, tier: "discovered",
    tierLabel: "Found online, check before paying", sourceKey: "zimplaza_discovery", sourceUrl: "https://www.zimplaza.co.zw/bakery", score: 1.07, ...overrides,
  };
}

const FUEL: BenitaFact[] = [
  { key: "fuel.diesel", label: "Diesel (D50), ZERA maximum", value: 2.04, valueText: null, unit: "per litre", currency: "USD", effectiveFrom: "2026-10-29", sourceKey: "zera", sourceUrl: "https://www.zera.co.zw/" },
  { key: "fuel.petrol_blend", label: "Petrol blend (E20), ZERA maximum", value: 2.05, valueText: null, unit: "per litre", currency: "USD", effectiveFrom: "2026-10-29", sourceKey: "zera", sourceUrl: "https://www.zera.co.zw/" },
];
const FX: BenitaFact[] = [{ key: "fx.usd_zwg", label: "Official interbank rate, ZiG per USD", value: 26.6053, valueText: null, unit: "ZWG per USD", currency: "ZWG", effectiveFrom: "2026-10-29", sourceKey: "rbz", sourceUrl: "https://www.rbz.co.zw/" }];

// ------------------------------------------------------------- pure helpers

test("fact questions are recognised in the ways people actually ask them", () => {
  for (const text of ["fuel price today", "How much is diesel?", "petrol", "what is the zera price for blend", "current petrol prices"]) assert.equal(factIntent(text), "fuel", text);
  for (const text of ["exchange rate", "what's the ZiG rate today", "usd to zig", "RBZ official rate"]) assert.equal(factIntent(text), "fx", text);
  for (const text of ["I need a plumber in Harare", "who sells gas stoves in Gweru near the market", "rate my plumber"]) assert.equal(factIntent(text), null, text);
});

test("fuel and rate replies quote the value, the unit and the date, never a guess", () => {
  const fuel = factReply("fuel", [...FUEL, ...FX])!;
  assert.match(fuel, /Diesel \(D50\): US\$2\.04 per litre/);
  assert.match(fuel, /Petrol blend \(E20\): US\$2\.05 per litre/);
  assert.match(fuel, /29 October 2026/);
  assert.doesNotMatch(fuel, /ZiG 26/);
  const fx = factReply("fx", [...FUEL, ...FX])!;
  assert.match(fx, /1 US dollar = ZiG 26\.61/);
  assert.equal(factReply("fuel", FX), null, "no fuel facts means no fuel answer");
});

test("every Benita line says how far TrustHub trusts it, and where an online find came from", () => {
  const line = benitaLine(result(), 0);
  assert.match(line, /^1\. \*Lobengula Bakery\*/);
  assert.match(line, /wa\.me\/263771234567/);
  assert.match(line, /Found online, check before paying \(zimplaza\.co\.zw\)/);
  const verified = benitaLine(result({ tier: "verified", tierLabel: "TrustHub verified" }), 1);
  assert.match(verified, /TrustHub verified$/);
  assert.doesNotMatch(verified, /zimplaza/);
  const reply = benitaReply([result()], "bakery", "Bulawayo");
  assert.match(reply, /^Here's what I found for \*bakery\* in Bulawayo:/);
  assert.match(reply, /TrustHub hasn't checked them/);
});

test("database rows map to results with a safe tier when the tier is unknown", () => {
  const mapped = mapBenitaResult({ kind: "listing", id: "l1", name: "3 bed house", tier: "nonsense", price_text: "$1,500", score: "0.9" });
  assert.equal(mapped.kind, "listing");
  assert.equal(mapped.tier, "discovered");
  assert.equal(mapped.tierLabel, "Found online, check before paying");
  assert.equal(mapped.priceText, "$1,500");
  assert.equal(mapped.score, 0.9);
});

// ------------------------------------------------------------- the store

test("the Supabase store reads Benita through the database functions, and is silent without them", async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from() { throw new Error("not used"); },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const data = fn === "benita_search"
        ? [{ kind: "place", id: "k1", name: "Lobengula Bakery", city: "Bulawayo", tier: "listed", tier_label: "Listed, not verified", score: 1 }]
        : [{ fact_key: "fuel.diesel", label: "Diesel", value: "2.04", unit: "per litre", currency: "USD", effective_from: "2026-10-29", source_key: "zera" }];
      return Promise.resolve({ data, error: null });
    },
  } as unknown as ConnectDbClient;
  const store = new SupabaseConnectStore(db);
  const found = await store.benitaSearch({ text: "bakery", city: "Bulawayo", limit: 3, kinds: ["place"] });
  assert.equal(found[0].name, "Lobengula Bakery");
  assert.equal(found[0].tier, "listed");
  assert.deepEqual(calls[0], { fn: "benita_search", args: { p_query: "bakery", p_city: "Bulawayo", p_limit: 3, p_kinds: ["place"], p_extra_terms: [] } });
  const facts = await store.currentFacts("fuel.");
  assert.equal(facts[0].value, 2.04);
  assert.deepEqual(calls[1], { fn: "benita_current_facts", args: { p_prefix: "fuel." } });
  const bare = new SupabaseConnectStore({ from() { throw new Error("not used"); } } as unknown as ConnectDbClient);
  assert.deepEqual(await bare.benitaSearch({ text: "bakery" }), []);
  assert.deepEqual(await bare.currentFacts(), []);
});

// ------------------------------------------------------------- end to end through the coordinator

type Row = Record<string, unknown>;
class EmptyQuery implements SupabaseReadQuery {
  select() { return this; }
  eq() { return this; }
  ilike() { return this; }
  or() { return this; }
  limit() { return this; }
  then<T1 = SupabaseReadResponse, T2 = never>(ok?: ((value: SupabaseReadResponse) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: [] as Row[], error: null }).then(ok, bad);
  }
}
/** A TrustHub directory with Bulawayo as a known community and no businesses at all. */
class EmptyDirectory implements SupabaseReadClient {
  from(table: "businesses" | "communities") {
    if (table === "communities") {
      const rows: Row[] = [{ id: "c2", name: "Bulawayo", city: "Bulawayo", country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: NOW }];
      return { ...new EmptyQuery(), select() { return this; }, eq() { return this; }, ilike() { return this; }, or() { return this; }, limit() { return this; }, then: (ok: (v: SupabaseReadResponse) => unknown, bad?: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, bad) } as unknown as SupabaseReadQuery;
    }
    return new EmptyQuery();
  }
}

function conversation(store: InMemoryConnectStore) {
  const runtime = createConversationRuntime({
    trustHubClient: new SupabaseTrustHubClient(new EmptyDirectory()), now: () => NOW,
    connect: { store, journeys: new ConnectJourneys(store, undefined, () => new Date(NOW)) },
  });
  let n = 0;
  return async (text: string) => {
    const understanding = await new DeterministicUnderstandingProvider().understand(text);
    return runtime.handleTurn({ conversationId: "conv", channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `wamid.b.${n++}`, identityId: "101" });
  };
}

test("an empty TrustHub directory no longer dead-ends: Benita's wider index answers with honest labels", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.benitaResults.push(result(), result({ id: "k2", name: "Harare Bread Co", city: "Harare", area: null }));
  const say = conversation(store);
  const answered = await say("I'm looking for a bakery in Bulawayo");
  assert.match(answered.reply, /Here's what I found for \*bakery\* in Bulawayo/);
  assert.match(answered.reply, /Lobengula Bakery/);
  assert.doesNotMatch(answered.reply, /Harare Bread Co/, "Benita keeps to the town asked for");
  assert.match(answered.reply, /Found online, check before paying/);
  assert.doesNotMatch(answered.reply, /couldn't find any bakery/);
  assert.equal(answered.state, "answer_uncertain");
  assert.equal(store.searches.at(-1)?.resultCount, 0, "demand intelligence still records that TrustHub itself had nothing");
});

test("when Benita has nothing either, the existing honest no-match reply is unchanged", async () => {
  const say = conversation(new InMemoryConnectStore(() => NOW));
  const result = await say("I'm looking for a bakery in Bulawayo");
  assert.match(result.reply, /couldn't find any bakery listed in Bulawayo/);
});

test("fuel prices are answered from Benita's facts without starting a search", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.facts.push(...FUEL, ...FX);
  const say = conversation(store);
  const fuel = await say("fuel price today");
  assert.match(fuel.reply, /Fuel prices in Zimbabwe/);
  assert.match(fuel.reply, /US\$2\.04/);
  const fx = await say("what is the ZiG rate");
  assert.match(fx.reply, /1 US dollar = ZiG 26\.61/);
  assert.equal(store.searches.length, 0);
});

test("with no facts collected yet, a fuel question falls through to the normal flow instead of inventing a price", async () => {
  const say = conversation(new InMemoryConnectStore(() => NOW));
  const reply = await say("fuel price today");
  assert.doesNotMatch(reply.reply, /US\$\d/);
});

test("a message nothing else understands is answered by a confident Benita match, never a weak one", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.benitaResults.push(
    result({ id: "s1", name: "Gweru Solar Centre", category: "Solar & Electrical", city: "Gweru", area: null, score: 1.07 }),
    result({ id: "s2", name: "Midlands Solar Panels", category: "Solar & Electrical", city: "Gweru", area: null, score: 1.0 }),
  );
  const say = conversation(store);
  const answered = await say("solar panels wholesale gweru");
  assert.match(answered.reply, /Gweru Solar Centre/);
  assert.match(answered.reply, /Found online, check before paying/);

  const weak = new InMemoryConnectStore(() => NOW);
  weak.benitaResults.push(result({ id: "w1", name: "Gweru Solar Centre", city: "Gweru", score: 0.6 }), result({ id: "w2", name: "Solar Two", city: "Gweru", score: 0.7 }));
  const unsure = await conversation(weak)("solar panels wholesale gweru");
  assert.doesNotMatch(unsure.reply, /Gweru Solar Centre/, "low-confidence matches are not presented as answers");
});

// ------------------------------------------------------------- Benita on every search


test("misspelt and everyday town names are read as the town that was meant", () => {
  assert.equal(correctTown("beightbridge"), "Beitbridge");
  assert.equal(correctTown("masvigo"), "Masvingo");
  assert.equal(correctTown("Vic Falls"), "Victoria Falls");
  assert.equal(correctTown("bulawyo"), "Bulawayo");
  assert.equal(correctTown("Avondale"), null, "a suburb is never turned into a town");
  assert.equal(correctTown("Johannesburg"), null);
});

test("a directory result only counts when it is the kind of thing asked for", () => {
  const hotel = { category: "hotel", questionType: "business_discovery", location: { city: "Masvingo" } } as unknown as NormalizedRequest;
  const item = (name: string, category: string | null) => ({ id: name, name, category, kind: "listing" }) as unknown as EvidenceItem;
  assert.equal(evidenceMatchesRequest(item("Chicken inn", "Others - Food restaurant"), hotel), false);
  assert.equal(evidenceMatchesRequest(item("Flamboyant", "Hotels & Lodges"), hotel), true);
  assert.equal(evidenceMatchesRequest(item("Great Zimbabwe Hotel", null), hotel), true);
});

/** A directory that, like production, returns a weak match whatever was asked. */
class WeakDirectory implements SupabaseReadClient {
  private readonly town: string;
  private readonly businesses: Row[];
  constructor(town: string, businesses: Row[]) { this.town = town; this.businesses = businesses; }
  from(table: "businesses" | "communities") {
    const rows: Row[] = table === "communities"
      ? [{ id: "c9", name: this.town, city: this.town, country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: NOW }]
      : this.businesses;
    const query = { select: () => query, eq: () => query, ilike: () => query, or: () => query, limit: () => query, then: (ok: (v: SupabaseReadResponse) => unknown, bad?: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, bad) };
    return query as unknown as SupabaseReadQuery;
  }
}
const business = (id: string, name: string, category: string, city: string): Row => ({ id, name, category, subcategory: null, province: null, country: "Zimbabwe", city, area: null, address: null, phone: "+263 77 000 0000", website: null, latitude: null, longitude: null, source: "import", source_id: id, trust_score: 5, reviews_count: 3, opening_hours: null, description: null, created_at: NOW });

function chatWith(directory: SupabaseReadClient, store: InMemoryConnectStore) {
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient(directory), now: () => NOW, connect: { store, journeys: new ConnectJourneys(store, undefined, () => new Date(NOW)) } });
  let n = 0;
  return async (text: string) => {
    const understanding = await new DeterministicUnderstandingProvider().understand(text);
    return runtime.handleTurn({ conversationId: "conv2", channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `wamid.c.${n++}`, identityId: "102" });
  };
}

test("Hotel in Masvingo: an off-topic directory match no longer hides Benita's hotels", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.benitaResults.push(
    result({ id: "h1", name: "Regency Hotel Flamboyant", category: "Accommodation", subcategory: "hotel", city: "Masvingo", area: null, tier: "listed", tierLabel: "Listed, not verified" }),
    result({ id: "h2", name: "Mineheart Boutique Hotel", category: "Accommodation", subcategory: "hotel", city: "Masvingo", area: null, tier: "listed", tierLabel: "Listed, not verified" }),
  );
  const say = chatWith(new WeakDirectory("Masvingo", [business("b1", "Chicken inn", "Others - Food restaurant", "Masvingo")]), store);
  const answered = await say("Hotel in Masvingo");
  assert.match(answered.reply, /Regency Hotel Flamboyant/);
  assert.match(answered.reply, /Mineheart Boutique Hotel/);
  assert.doesNotMatch(answered.reply, /Chicken inn/i);
  assert.match(answered.reply, /Listed, not verified/);
  assert.match(answered.reply, /Tap \*Add a business\*/);
});

test("when TrustHub has a real match, Benita adds more underneath instead of replacing it", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.benitaResults.push(result({ id: "h3", name: "Hotel Victoria", category: "Accommodation", subcategory: "hotel", city: "Masvingo", area: null }));
  const say = chatWith(new WeakDirectory("Masvingo", [business("b2", "Great Zimbabwe Hotel", "Hotels & Lodges", "Masvingo")]), store);
  const answered = await say("Hotel in Masvingo");
  assert.match(answered.reply, /Great Zimbabwe Hotel/);
  assert.match(answered.reply, /More hotel in Masvingo that Benita found:\*\n1\. \*Hotel Victoria\*/);
  assert.ok(answered.reply.indexOf("Great Zimbabwe Hotel") < answered.reply.indexOf("Hotel Victoria"), "TrustHub's own result comes first");
});

test("Hotel in beightbridge: the town is understood, and with nothing stored Benita looks it up live", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.liveFinds.push(result({ id: "live1", name: "Rainbow Beitbridge Hotel", category: "Accommodation", subcategory: "hotel", city: "Beitbridge", area: null }));
  const say = chatWith(new WeakDirectory("Beitbridge", []), store);
  const answered = await say("Hotel in beightbridge");
  assert.equal(store.liveRequests[0]?.city, "Beitbridge");
  assert.ok(store.liveRequests[0]?.terms.includes("lodge"), "the live lookup knows a lodge is a kind of hotel");
  assert.match(answered.reply, /Rainbow Beitbridge Hotel/);
  assert.match(answered.reply, /Found online, check before paying/);
  assert.doesNotMatch(answered.reply, /couldn't find/);
});

test("'Thanks' and 'who are you?' get a lively Wisdom line, never 'I didn't understand'", async () => {
  const say = conversation(new InMemoryConnectStore(() => NOW));
  const thanks = await say("Thanks");
  assert.doesNotMatch(thanks.reply, /didn't quite get|ears are on holiday|Lost me|riddle|beyond me/i);
  assert.match(thanks.reply, /Anything else I can find for you\?/);
  const who = await say("are you a bot?");
  assert.ok(who.reply.includes(who.conversation.assistantName ?? "?"), who.reply);
});

test("the exchange-rate answer always quotes the US dollar rate, whatever order the facts come in", () => {
  const facts: BenitaFact[] = [
    { key: "fx.bwp_zwg", label: "ZiG per BWP", value: 1.8781, valueText: null, unit: "ZWG per BWP", currency: "ZWG", effectiveFrom: "2026-10-29", sourceKey: "rbz", sourceUrl: null },
    ...FX,
  ];
  const reply = factReply("fx", facts)!;
  assert.match(reply, /1 US dollar = ZiG 26\.61/);
  assert.match(reply, /1 Botswana pula = ZiG 1\.88/);
  assert.equal(factReply("fx", facts.slice(0, 1)), null, "no dollar rate, no dollar answer");
});
