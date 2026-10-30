import assert from "node:assert/strict";
import test from "node:test";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import { TrustHubBusinessAnswerSource } from "../lib/answer-resolution/trusthub-source.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

type Row = Record<string, unknown>;
const business = (id: string, name: string, overrides: Row = {}): Row => ({
  id, name, category: null, subcategory: null, province: null, country: "Zimbabwe", city: "Harare", area: null, address: null, phone: null, website: null,
  latitude: null, longitude: null, source: "import", source_id: `src-${id}`, trust_score: null, reviews_count: null, created_at: "2026-01-01T00:00:00Z", ...overrides,
});
const BUSINESSES: Row[] = [
  business("b1", "Safe Roads Driving School"),
  business("b2", "Harare Driving School Academy", { subcategory: "Driver training" }),
  business("b3", "Premier Motors", { category: "Driving School" }),
  business("b4", "Eastlea Plumbing", { category: null }),
  business("b5", "Bulawayo Driving School", { city: "Bulawayo" }),
  business("b6", "Corner Bakery", { category: "Bakery" }),
];
const COMMUNITIES: Row[] = [{ id: "c1", name: "Harare", city: "Harare", country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: "2026-01-01T00:00:00Z" }];

class Query implements SupabaseReadQuery {
  private readonly rows: Row[];
  private readonly log: Fake;
  private readonly filters: ((row: Row) => boolean)[] = [];
  constructor(rows: Row[], log: Fake) { this.rows = rows; this.log = log; }
  select() { return this; }
  eq(column: string, value: string) { this.filters.push((row) => String(row[column] ?? "") === value); return this; }
  ilike(column: string, value: string) { const wanted = value.replace(/\\([\\%_])/g, "$1").toLocaleLowerCase(); this.filters.push((row) => String(row[column] ?? "").toLocaleLowerCase() === wanted); return this; }
  or(filters: string) {
    this.log.orFilters.push(filters);
    const clauses = filters.split(",").map((clause) => /^(\w+)\.ilike\.\*(.*)\*$/.exec(clause)!);
    this.filters.push((row) => clauses.some(([, column, term]) => String(row[column] ?? "").toLocaleLowerCase().includes(term.toLocaleLowerCase())));
    return this;
  }
  limit() { return this; }
  then<T1 = SupabaseReadResponse, T2 = never>(ok?: ((value: SupabaseReadResponse) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    const data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    this.log.returned.push(data.length);
    return Promise.resolve({ data, error: null }).then(ok, bad);
  }
}
class Fake implements SupabaseReadClient {
  readonly orFilters: string[] = [];
  readonly returned: number[] = [];
  private readonly businesses: Row[];
  private readonly communities: Row[];
  constructor(businesses = BUSINESSES, communities = COMMUNITIES) { this.businesses = businesses; this.communities = communities; }
  from(table: "businesses" | "communities") { return new Query(table === "businesses" ? this.businesses : this.communities, this); }
}

const request = (category: string, city = "Harare"): NormalizedRequest => ({ text: `find ${category}`, intent: "find_business", category, location: { country: "Zimbabwe", city }, questionType: "business_discovery" });

test("a driving school request matches NULL-category businesses by name and by subcategory, in the right city only", async () => {
  const fake = new Fake();
  const found = await new SupabaseTrustHubClient(fake).searchBusinesses(request("driving school"));
  assert.deepEqual(found.map((item) => item.id).sort(), ["b1", "b2", "b3"]);
  assert.equal(found.find((item) => item.id === "b1")?.category, null);
});

test("matching is narrowed by the database query, not by loading the whole city", async () => {
  const fake = new Fake();
  await new SupabaseTrustHubClient(fake).searchBusinesses(request("driving school"));
  assert.equal(fake.orFilters.length, 1);
  assert.match(fake.orFilters[0], /name\.ilike\.\*driving school\*/);
  assert.match(fake.orFilters[0], /subcategory\.ilike\.\*driving school\*/);
  assert.deepEqual(fake.returned, [3]);
});

test("plural and -er/-ing forms still match, and filter syntax in a category cannot inject clauses", async () => {
  const client = new SupabaseTrustHubClient(new Fake());
  assert.equal((await client.searchBusinesses(request("driving schools"))).length, 3);
  const fake = new Fake();
  await new SupabaseTrustHubClient(fake).searchBusinesses(request("school),city.eq.Bulawayo,(name.ilike.*x"));
  for (const clause of fake.orFilters[0].split(",")) assert.match(clause, /^(name|category|subcategory)\.ilike\.\*[\p{L}\p{N} -]+\*$/u);
});

test("name matches keep the existing source label and are never marked verified", async () => {
  const result = await new TrustHubBusinessAnswerSource(new SupabaseTrustHubClient(new Fake()), () => "2026-01-01T00:00:00.000Z").search(request("driving school"));
  assert.equal(result.evidence.length, 3);
  for (const item of result.evidence) {
    assert.equal(item.sourceLabel, "TrustHub businesses record");
    assert.notEqual(item.verificationStatus, "verified");
    assert.equal(item.verificationStatus, "observed");
  }
});

function conversation(fake = new Fake()) {
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient(fake), now: () => "2026-01-01T00:00:00.000Z" });
  let n = 0;
  return async (text: string) => {
    const understanding = await new DeterministicUnderstandingProvider().understand(text);
    return runtime.handleTurn({ conversationId: "conv", channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `wamid.${n++}` });
  };
}

test("Hi, I'm looking for a driving school, Harare: the original category is kept and the search runs in Harare", async () => {
  const say = conversation();
  await say("Hi");
  const asked = await say("I'm looking for a driving school");
  assert.equal(asked.state, "clarification_needed");
  assert.match(asked.reply, /Which city should I look in\?/);
  assert.equal(asked.conversation.lastRequest?.category, "driving school");
  const answered = await say("Harare");
  assert.equal(answered.state, "answer_found");
  assert.equal(answered.conversation.lastRequest?.category, "driving school");
  assert.equal(answered.conversation.lastRequest?.location?.city, "Harare");
  assert.match(answered.reply, /Safe Roads Driving School/);
  assert.match(answered.reply, /Premier Motors/);
  assert.doesNotMatch(answered.reply, /Bulawayo Driving School|Eastlea Plumbing|Corner Bakery|enough reliable information/);
  assert.match(answered.reply, /Listed in TrustHub records, not independently verified/);
  assert.doesNotMatch(answered.reply, /verified by TrustHub/);
});

test("Harare, then a driving school, searches Harare for driving schools", async () => {
  const say = conversation();
  assert.equal((await say("Harare")).state, "clarification_needed");
  const answered = await say("a driving school");
  assert.equal(answered.state, "answer_found");
  assert.match(answered.reply, /Safe Roads Driving School/);
});

test("a one-message request with the city searches immediately", async () => {
  const answered = await conversation()("I'm looking for a driving school in Harare");
  assert.equal(answered.state, "answer_found");
  assert.match(answered.reply, /Safe Roads Driving School/);
});

test("'Look in the Harare community' supplies the missing city of an established search", async () => {
  const say = conversation();
  await say("I'm looking for a driving school");
  const answered = await say("Look in the Harare community");
  assert.equal(answered.state, "answer_found");
  assert.equal(answered.conversation.lastRequest?.category, "driving school");
  assert.equal(answered.conversation.lastRequest?.location?.city, "Harare");
});

test("'Look in the Harare community' redirects a finished search elsewhere without losing the category", async () => {
  const say = conversation();
  const bulawayo = await say("I'm looking for a driving school in Bulawayo");
  assert.match(bulawayo.reply, /Bulawayo Driving School/);
  const harare = await say("Look in the Harare community");
  assert.equal(harare.conversation.lastRequest?.category, "driving school");
  assert.equal(harare.conversation.lastRequest?.location?.city, "Harare");
  assert.match(harare.reply, /Safe Roads Driving School/);
  assert.doesNotMatch(harare.reply, /Bulawayo Driving School/);
});

test("a genuine no-match says so plainly and offers a next step", async () => {
  const result = await conversation()("I'm looking for a bakery in Bulawayo");
  assert.match(result.reply, /couldn't find any bakery listed in Bulawayo/);
  assert.match(result.reply, /ask people in the Bulawayo community/);
  assert.match(result.reply, /never your number/);
  assert.doesNotMatch(result.reply, /enough reliable information/);
});

test("a city that has businesses but no community row is still accepted as the answer to the city question", async () => {
  const say = conversation(new Fake(BUSINESSES, []));
  await say("I'm looking for a driving school");
  const answered = await say("Harare");
  assert.equal(answered.state, "answer_found");
});

const SUBJECTS: Row[] = [
  business("s1", "Harare Primary School", { category: "Education" }),
  business("p1", "Moyo Phone Shop", { category: "Electronics", subcategory: "Cellphone Shop" }),
  business("p2", "Cellular World", { category: "Electronics" }),
];

test("finding primary schools in Harare returns the school, not phone shops", async () => {
  const result = await conversation(new Fake(SUBJECTS))("I'm looking for primary schools in Harare");
  assert.equal(result.state, "answer_found");
  assert.match(result.reply, /Harare Primary School/);
  assert.doesNotMatch(result.reply, /Phone Shop|Cellular World/);
  assert.equal(result.conversation.lastRequest?.category, "primary schools");
  assert.equal(result.conversation.lastRequest?.serviceConcept, "school");
});

test("finding phone shops in Harare returns phone shops, not the school", async () => {
  const result = await conversation(new Fake(SUBJECTS))("find phone shops in Harare");
  assert.equal(result.state, "answer_found");
  assert.match(result.reply, /Moyo Phone Shop/);
  assert.match(result.reply, /Cellular World/);
  assert.doesNotMatch(result.reply, /Primary School/);
  assert.equal(result.conversation.lastRequest?.category, "phone shops");
  assert.equal(result.conversation.lastRequest?.serviceConcept, "electronics");
});

test("a store that cells phones in Harare is understood as a phone-shop search", async () => {
  const result = await conversation(new Fake(SUBJECTS))("a store that cells phones in Harare");
  assert.equal(result.state, "answer_found");
  assert.match(result.reply, /Moyo Phone Shop/);
  assert.equal(result.conversation.lastRequest?.category, "phone shop");
  assert.equal(result.conversation.lastRequest?.serviceConcept, "electronics");
  assert.equal(result.conversation.lastRequest?.location?.city, "Harare");
});

test("changing from a school search to a phone-shop search updates the active request", async () => {
  const say = conversation(new Fake(SUBJECTS));
  const schools = await say("I'm looking for primary schools in Harare");
  assert.equal(schools.state, "answer_found");
  assert.match(schools.reply, /Harare Primary School/);
  assert.equal(schools.conversation.lastRequest?.category, "primary schools");
  const shops = await say("a store that cells phones in Harare");
  // The subject changed, so the active request is the phone-shop search,
  // not the earlier primary-school request.
  assert.equal(shops.state, "answer_found");
  assert.equal(shops.conversation.lastRequest?.category, "phone shop");
  assert.equal(shops.conversation.lastRequest?.serviceConcept, "electronics");
  assert.match(shops.reply, /Moyo Phone Shop/);
  assert.match(shops.reply, /Cellular World/);
  assert.doesNotMatch(shops.reply, /Primary School/);
});

test("continuing the same search keeps the established category", async () => {
  const say = conversation(new Fake(SUBJECTS));
  await say("I'm looking for primary schools");
  const asked = await say("Harare");
  assert.equal(asked.conversation.lastRequest?.category, "primary schools");
  assert.equal(asked.conversation.lastRequest?.location?.city, "Harare");
});
