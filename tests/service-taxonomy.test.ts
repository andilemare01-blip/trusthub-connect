import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_CONCEPTS, SERVICE_TAXONOMY, ServiceTaxonomy, databaseFilterTerms, expandTerm, normalizeServiceText, scoreServiceMatch, serviceMatchIntent } from "../lib/discovery/service-taxonomy.ts";
import { auditBusinessCategories, type AuditBusiness } from "../lib/discovery/category-audit.ts";
import { parseLocalSearchRequest } from "../lib/whatsapp/intent-parser.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import { TrustHubBusinessAnswerSource } from "../lib/answer-resolution/trusthub-source.ts";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

const idOf = (phrase: string) => { const intent = SERVICE_TAXONOMY.resolve(phrase); return intent?.kind === "concept" ? intent.concept.id : intent?.kind ?? null; };

test("normalisation lowercases, strips accents and apostrophes, collapses punctuation and bounds length", () => {
  assert.equal(normalizeServiceText("  Driving   SCHOOL!!  "), "driving school");
  assert.equal(normalizeServiceText("my car won't start"), "my car wont start");
  assert.equal(normalizeServiceText("Crèche & Café"), "creche cafe");
  assert.equal(normalizeServiceText(null), "");
  assert.equal(normalizeServiceText("😀 ☎ ???"), "");
  assert.ok(normalizeServiceText("a".repeat(10_000)).length <= 300);
  assert.deepEqual(expandTerm("plumber").sort(), ["plumber", "plumbers"]);
  assert.ok(expandTerm("pharmacy").includes("pharmacies"));
});

test("different ways of asking for a driving school resolve to one service intent", () => {
  for (const phrase of ["I need driving lessons.", "Where can I learn to drive?", "Find a driving school.", "Driving instructors near me.", "I want to get a drivers license", "driving schools", "DRIVING   LESSON"]) {
    const request = parseLocalSearchRequest(phrase);
    assert.equal(request?.serviceConcept, "driving_school", phrase);
    assert.equal(request?.questionType, "business_discovery", phrase);
  }
  assert.equal(parseLocalSearchRequest("Where can I learn to drive?")?.category, "driving school");
});

test("symptoms suggest the right service, and a phrase with materially different meanings becomes a question", () => {
  assert.equal(parseLocalSearchRequest("my tap is leaking")?.serviceConcept, "plumber");
  assert.equal(parseLocalSearchRequest("my fridge is not cooling")?.serviceConcept, "appliance_repair");
  assert.equal(parseLocalSearchRequest("my laptop wont turn on")?.serviceConcept, "computer_repair");
  const stuck = parseLocalSearchRequest("my car won't start");
  assert.equal(stuck?.category, null);
  assert.deepEqual(stuck?.ambiguity?.options.sort(), ["mechanic", "roadside assistance"]);
  assert.match(stuck?.ambiguity?.question ?? "", /mechanic or roadside assistance/);
  // "school" on its own means a school; people who want driving lessons say so.
  const bare = parseLocalSearchRequest("I need a school in Gweru");
  assert.equal(bare?.ambiguity ?? null, null);
  assert.equal(bare?.serviceConcept, "school");
  assert.equal(parseLocalSearchRequest("I need lessons")?.ambiguity?.options.length, 2);
});

test("service families resolve from ordinary language and local terms", () => {
  const expectations: [string, string][] = [
    ["a mechanic", "mechanic"], ["tyre shop", "tyre_shop"], ["car wash", "car_wash"], ["car hire", "vehicle_hire"], ["used cars", "car_dealership"], ["towing", "roadside_assistance"],
    ["plumbers", "plumber"], ["electrician", "electrician"], ["builders", "builder"], ["painting services", "painter"], ["cleaning services", "cleaning"], ["gardener", "gardening"], ["fix my fridge", "appliance_repair"],
    ["restaurants", "restaurant"], ["takeaway", "takeaway"], ["coffee shop", "cafe"], ["catering", "catering"], ["a place to stay", "accommodation"], ["guest house", "accommodation"], ["hotel", "accommodation"],
    ["dentist", "dentist"], ["pharmacies", "pharmacy"], ["optician", "optician"], ["clinic", "clinic"], ["hospital", "hospital"], ["I have a toothache", "dentist"],
    ["supermarket", "supermarket"], ["buy clothes", "clothing"], ["hardware store", "hardware"], ["furniture shop", "furniture"], ["groceries", "grocery"], ["tuckshop", "grocery"],
    ["maths tutor", "tutor"], ["primary school", "school"], ["university", "college"], ["creche", "childcare"], ["training centre", "training_centre"],
    ["kombi", "taxi"], ["courier service", "logistics"], ["bus tickets", "bus"], ["lawyer", "lawyer"], ["accountants", "accountant"], ["consultant", "consultant"], ["bank", "financial"],
    ["barber", "barber"], ["hair salon", "hair_salon"], ["do my nails", "beauty"], ["tailor", "tailor"], ["laundry", "laundry"],
    ["estate agent", "estate_agent"], ["house to rent", "property_rentals"], ["property management", "property_management"],
    ["fix my phone", "phone_repair"], ["it support", "it_support"], ["get wifi", "internet_services"], ["wedding venue", "venue"], ["gym", "gym"], ["swimming pool", "sports_facility"], ["nightclub", "entertainment"],
    ["buy fertiliser", "agriculture"], ["my dog is sick", "vet"], ["hire a crane", "industrial"], ["get a passport", "government"], ["find a church", "place_of_worship"], ["where can I volunteer", "nonprofit"], ["solar installer", "solar"],
  ];
  for (const [phrase, concept] of expectations) assert.equal(idOf(phrase), concept, phrase);
  const families = new Set(SERVICE_CONCEPTS.map((concept) => concept.family));
  for (const family of ["automotive", "home", "food", "hospitality", "health", "retail", "education", "transport", "professional", "personal", "property", "technology", "events", "agriculture", "industrial", "public"]) assert.ok(families.has(family), family);
  assert.equal(new Set(SERVICE_CONCEPTS.map((concept) => concept.id)).size, SERVICE_CONCEPTS.length);
});

test("unknown services fall back gracefully, and the taxonomy can be extended without AI", () => {
  assert.equal(parseLocalSearchRequest("who restores antique gramophones around Avondale"), undefined);
  assert.equal(SERVICE_TAXONOMY.resolve("antique gramophone restoration")?.kind, "unknown");
  assert.deepEqual(serviceMatchIntent("gramophone restoration")?.terms.includes("gramophone restoration"), true);
  const extended = SERVICE_TAXONOMY.extend([{ id: "gramophones", family: "custom", label: "gramophone restoration", terms: ["gramophone restoration"], asks: [], excludes: [] }]);
  assert.equal((extended.resolve("gramophone restoration") as { concept: { id: string } }).concept.id, "gramophones");
  assert.ok(new ServiceTaxonomy().concepts.length > 60);
});

test("a passing mention of a service inside a longer sentence is not treated as a search", () => {
  assert.equal(parseLocalSearchRequest("my plumber fixed it yesterday"), undefined);
  assert.equal(parseLocalSearchRequest("my child goes to school"), undefined);
  assert.equal(parseLocalSearchRequest("Hi"), undefined);
  assert.equal(parseLocalSearchRequest("thanks"), undefined);
});

test("malformed and excessively long input is handled safely", () => {
  assert.equal(parseLocalSearchRequest("x".repeat(100_000)), undefined);
  assert.equal(parseLocalSearchRequest(""), undefined);
  assert.equal(parseLocalSearchRequest("   "), undefined);
  assert.deepEqual(parseLocalSearchRequest("find ),(;--%_\\ \u0000 ???"), parseLocalSearchRequest("find ),(;--%_\\ \u0000 ???"));
  const started = Date.now();
  SERVICE_TAXONOMY.resolve("plumber ".repeat(5000));
  assert.ok(Date.now() - started < 1500);
});

type Row = Record<string, unknown>;
const business = (id: string, name: string, overrides: Row = {}): Row => ({
  id, name, category: null, subcategory: null, province: null, country: "Zimbabwe", city: "Harare", area: null, address: null, phone: null, website: null,
  latitude: null, longitude: null, source: "import", source_id: `src-${id}`, trust_score: 5, reviews_count: 99, created_at: "2026-01-01T00:00:00Z", ...overrides,
});
const DATA: Row[] = [
  business("d1", "Safe Roads Driving School", { area: "Avondale" }),
  business("d2", "Capital Learner Driver Training", { subcategory: "Driving lessons" }),
  business("d3", "Premier Motors", { category: "Driving School" }),
  business("p1", "Kudzai Plumbing & Drainage"),
  business("p2", "Mbare Plumbers", { category: "Plumber", area: "Mbare" }),
  business("e1", "Spark Electrical Contractors"),
  business("r1", "The Grill House Restaurant"),
  business("m1", "Harare Auto Repair Centre"),
  business("m2", "Mukoma Garage", { subcategory: "Mechanic" }),
  business("ph1", "Avenues Pharmacy"),
  business("ph2", "Corner Chemist", { category: "Health" }),
  business("t1", "Bright Minds Maths Tutors"),
  business("a1", "Sunrise Guest House"),
  business("a2", "Rainbow Lodge", { category: "Accommodation" }),
  business("s1", "Harare Primary School"),
  business("x1", "Zed Holdings"),
  business("b1", "Bulawayo Plumbers", { city: "Bulawayo", category: "Plumber" }),
];

class Query implements SupabaseReadQuery {
  private readonly rows: Row[];
  private readonly owner: Fake;
  private readonly filters: ((row: Row) => boolean)[] = [];
  constructor(rows: Row[], owner: Fake) { this.rows = rows; this.owner = owner; }
  select() { return this; }
  eq(column: string, value: string) { this.filters.push((row) => String(row[column] ?? "") === value); return this; }
  ilike(column: string, value: string) { const wanted = value.replace(/\\([\\%_])/g, "$1").toLocaleLowerCase(); this.filters.push((row) => String(row[column] ?? "").toLocaleLowerCase() === wanted); return this; }
  or(filters: string) {
    this.owner.orFilters.push(filters);
    const clauses = filters.split(",").map((clause) => { const [, column, pattern] = /^(\w+)\.ilike\.(.*)$/.exec(clause)!; return { column, regex: new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i") }; });
    this.filters.push((row) => clauses.some(({ column, regex }) => regex.test(String(row[column] ?? ""))));
    return this;
  }
  limit() { return this; }
  then<T1 = SupabaseReadResponse, T2 = never>(ok?: ((value: SupabaseReadResponse) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    if (this.owner.failure) return Promise.resolve({ data: null, error: { message: this.owner.failure } }).then(ok, bad);
    const data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    this.owner.returned.push(data.length);
    return Promise.resolve({ data, error: null }).then(ok, bad);
  }
}
class Fake implements SupabaseReadClient {
  readonly orFilters: string[] = [];
  readonly returned: number[] = [];
  failure: string | null = null;
  private readonly businesses: Row[];
  constructor(businesses: Row[] = DATA) { this.businesses = businesses; }
  from(table: "businesses" | "communities") {
    return new Query(table === "businesses" ? this.businesses : [{ id: "c1", name: "Harare", city: "Harare", country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: "2026-01-01T00:00:00Z" }], this);
  }
}

const request = (category: string, city = "Harare", extra: Partial<NormalizedRequest> = {}): NormalizedRequest => ({ text: `find ${category}`, intent: "find_business", category, location: { country: "Zimbabwe", city }, questionType: "business_discovery", ...extra });
const search = async (category: string, city = "Harare", extra: Partial<NormalizedRequest> = {}) => (await new SupabaseTrustHubClient(new Fake()).searchBusinesses(request(category, city, extra))).map((item) => item.id);

test("driving schools are found when category is NULL: by name, subcategory and category, best first", async () => {
  const ids = await search("driving school");
  assert.deepEqual([...ids].sort(), ["d1", "d2", "d3"]);
  assert.deepEqual(ids.slice(0, 2).sort(), ["d1", "d2"]);
  assert.equal(ids.at(-1), "d3");
  assert.deepEqual(await search("driving lessons"), ids);
  assert.deepEqual(await search("learn to drive"), ids);
});

test("service families match businesses with missing categories by name", async () => {
  assert.deepEqual((await search("plumber")).sort(), ["p1", "p2"]);
  assert.deepEqual(await search("electrician"), ["e1"]);
  assert.deepEqual(await search("restaurant"), ["r1"]);
  assert.deepEqual((await search("mechanic")).sort(), ["m1", "m2"]);
  assert.deepEqual((await search("pharmacy")).sort(), ["ph1", "ph2"]);
  assert.deepEqual(await search("tutor"), ["t1"]);
  assert.deepEqual((await search("accommodation")).sort(), ["a1", "a2"]);
  assert.deepEqual(await search("place to stay", "Harare", { serviceConcept: "accommodation" }).then((ids) => ids.sort()), ["a1", "a2"]);
});

test("a school search does not return driving schools, and unrelated businesses never fill the list", async () => {
  assert.deepEqual(await search("primary school", "Harare", { serviceConcept: "school" }), ["s1"]);
  assert.ok(!(await search("tutor")).includes("d1"));
  assert.deepEqual(await search("dentist"), []);
});

test("city and area constraints stay intact and filtering is applied by the database before the row limit", async () => {
  assert.deepEqual(await search("plumber", "Bulawayo"), ["b1"]);
  assert.deepEqual(await search("plumber", "Harare", { location: { country: "Zimbabwe", city: "Harare", area: "Mbare" } }), ["p2"]);
  assert.deepEqual(await search("plumber", "Gweru"), []);
  const fake = new Fake();
  await new SupabaseTrustHubClient(fake).searchBusinesses(request("plumber"));
  assert.equal(fake.orFilters.length, 1);
  assert.ok(fake.returned[0] < DATA.length);
});

test("results are capped, ranked name first and filter terms contain only safe characters", async () => {
  const many = Array.from({ length: 40 }, (_, index) => business(`g${index}`, `Great Grill ${index} Restaurant`));
  const found = await new SupabaseTrustHubClient(new Fake([...many, ...DATA])).searchBusinesses(request("restaurant"));
  assert.equal(found.length, 10);
  const fake = new Fake();
  await new SupabaseTrustHubClient(fake).searchBusinesses(request("pla),(umber; DROP %_ *"));
  for (const clause of fake.orFilters[0].split(",")) assert.match(clause, /^(name|category|subcategory)\.ilike\.[\p{L}\p{N} *]+$/u);
  const intent = serviceMatchIntent("driving school")!;
  assert.ok(scoreServiceMatch(intent, { name: "Safe Roads Driving School" }) > scoreServiceMatch(intent, { category: "Driving School" }));
  assert.ok(scoreServiceMatch(intent, { category: "Driving School" }) > scoreServiceMatch(intent, { subcategory: "driving lessons" }));
  assert.ok(scoreServiceMatch(intent, { subcategory: "driving lessons" }) > scoreServiceMatch(intent, { description: "offers driving lessons" }));
  assert.equal(scoreServiceMatch(intent, { name: "Zed Holdings", category: null }), 0);
  const terms = databaseFilterTerms(intent);
  assert.ok(!terms.substrings.includes("driving schools"));
});

test("name matches keep the existing provenance and are never marked verified", async () => {
  const result = await new TrustHubBusinessAnswerSource(new SupabaseTrustHubClient(new Fake()), () => "2026-01-01T00:00:00.000Z").search(request("driving school"));
  assert.ok(result.evidence.length >= 3);
  for (const item of result.evidence) {
    assert.equal(item.sourceLabel, "TrustHub businesses record");
    assert.equal(item.verificationStatus, "observed");
    assert.notEqual(item.verificationStatus, "verified");
  }
});

function chat(fake = new Fake()) {
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient(fake), now: () => "2026-01-01T00:00:00.000Z" });
  let n = 0;
  return async (text: string) => {
    const understanding = await new DeterministicUnderstandingProvider().understand(text);
    return runtime.handleTurn({ conversationId: "c", channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `w.${n++}` });
  };
}

test("conversations: ordinary-language requests, city follow-ups and community redirects keep the pending search", async () => {
  const say = chat();
  const asked = await say("my tap is leaking");
  assert.match(asked.reply, /Which city should I look in\?/);
  const found = await say("Harare");
  assert.equal(found.state, "answer_found");
  assert.match(found.reply, /Kudzai Plumbing|Mbare Plumbers/);
  assert.doesNotMatch(found.reply, /Bulawayo Plumbers/);

  const say2 = chat();
  await say2("Where can I learn to drive?");
  const viaCommunity = await say2("Look in the Harare community");
  assert.equal(viaCommunity.state, "answer_found");
  assert.match(viaCommunity.reply, /Safe Roads Driving School/);

  const say3 = chat();
  assert.match((await say3("Driving instructors in Harare")).reply, /Safe Roads Driving School/);
});

test("conversations: an ambiguous request asks first, keeps the city, then searches the chosen service", async () => {
  const say = chat();
  const question = await say("my car won't start in Harare");
  assert.equal(question.state, "clarification_needed");
  assert.match(question.reply, /mechanic or roadside assistance/);
  assert.equal(question.conversation.lastRequest?.location?.city, "Harare");
  const answered = await say("a mechanic");
  assert.equal(answered.state, "answer_found");
  assert.match(answered.reply, /Harare Auto Repair Centre|Mukoma Garage/);
  assert.equal(answered.conversation.lastRequest?.location?.city, "Harare");
});

test("conversations: no match and database failures are explained plainly without false claims", async () => {
  const none = await chat()("I need a dentist in Harare");
  assert.match(none.reply, /couldn't find any dentist listed in Harare/);
  assert.match(none.reply, /ask people in the Harare community/);
  assert.equal(none.action, "ask_community_permission");
  const broken = new Fake();
  broken.failure = "connection reset";
  const failed = await chat(broken)("I need a plumber in Harare");
  assert.ok(failed.reply.length > 0);
  assert.doesNotMatch(failed.reply, /TrustHub lists/);
  assert.notEqual(failed.state, "answer_found");
});

test("audit: separates high-confidence suggestions from uncertain and insufficient records without any write fields", () => {
  const records: AuditBusiness[] = [
    { id: "1", name: "Safe Roads Driving School", category: null, subcategory: null },
    { id: "2", name: "Kudzai Plumbing", category: "", subcategory: "   " },
    { id: "3", name: "Premier Motors", category: "Other", subcategory: null },
    { id: "4", name: "Zed Holdings", category: null, subcategory: null },
    { id: "5", name: "Sunrise Lodge", category: "business", subcategory: null },
    { id: "6", name: "Mystery Co", category: null, subcategory: "Mechanic" },
    { id: "7", name: "Alpha", category: "Plumber", subcategory: "x" },
    { id: "8", name: "Beta", category: "plumber", subcategory: "x" },
    { id: "9", name: "Gamma", category: "Plumbing", subcategory: "x" },
    { id: "10", name: "Dental and Pharmacy Place", category: null, subcategory: null },
  ];
  const report = auditBusinessCategories(records);
  assert.equal(report.total, 10);
  assert.equal(report.missingCategory, 5);
  assert.equal(report.blankCategory, 1);
  assert.equal(report.missingSubcategory, 6);
  assert.equal(report.missingBoth, 4);
  assert.deepEqual(report.genericCategories.map((item) => item.value).sort(), ["Other", "business"]);
  assert.ok(report.casingVariants.some((group) => group.normalized === "plumber" && group.variants.length === 2));
  assert.ok(report.namingGroups.some((group) => group.conceptId === "plumber" && group.variants.length >= 2));
  const high = report.highConfidence.map((item) => `${item.id}:${item.conceptId}`).sort();
  assert.deepEqual(high, ["1:driving_school", "2:plumber", "6:mechanic"]);
  assert.equal(report.highConfidence.find((item) => item.id === "6")?.basis, "subcategory");
  assert.ok(report.uncertain.some((item) => item.id === "3"));
  assert.ok(report.uncertain.some((item) => item.id === "5"));
  assert.ok(!report.highConfidence.some((item) => item.id === "10"));
  assert.equal(report.insufficient.count, 1);
  assert.deepEqual(report.insufficient.sampleIds, ["4"]);
  assert.ok(!JSON.stringify(report).includes("verified"));
});
