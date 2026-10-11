import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import { TrustHubBusinessAnswerSource } from "../lib/answer-resolution/trusthub-source.ts";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import { SupabaseConfigurationError } from "../lib/trusthub/supabase-types.ts";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

const BASE_REQUEST: NormalizedRequest = {
  text: "Find a plumber in Harare", intent: "find_provider", category: "plumber",
  location: { country: "Zimbabwe", city: "Harare", area: null }, questionType: "provider_recommendation",
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b0d45fa7-29d4-477b-9c08-8d07e5797890", name: "Moyo Plumbing", category: "Plumbing",
    subcategory: null, province: "Harare", country: "Zimbabwe", city: "Harare", area: "Avondale",
    address: "12 Example Road", phone: "+263 77 000 0000", website: null, latitude: null, longitude: null,
    source: "manual", source_id: "import-42", trust_score: 4.4, reviews_count: 8,
    business_verified: true, owner_claimed: false, created_at: "2025-04-01T00:00:00Z", ...overrides,
  };
}

class MemoryQuery implements SupabaseReadQuery {
  private readonly db: MemoryReadClient;
  private readonly table: "businesses" | "communities";
  private readonly filters: { method: "eq" | "ilike"; column: string; value: string }[] = [];
  constructor(db: MemoryReadClient, table: "businesses" | "communities") { this.db = db; this.table = table; }
  select() { return this; }
  eq(column: string, value: string) { this.filters.push({ method: "eq", column, value }); return this; }
  ilike(column: string, value: string) { this.filters.push({ method: "ilike", column, value }); return this; }
  limit() { return this; }
  or() { return this; }
  then<TResult1 = SupabaseReadResponse, TResult2 = never>(
    onfulfilled?: ((value: SupabaseReadResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.db.rows(this.table).filter((item) => this.filters.every(({ method, column, value }) => {
      const actual = String(item[column] ?? "");
      if (method === "eq") return actual === value;
      return actual.toLocaleLowerCase() === value.replace(/\\([\\%_])/g, "$1").toLocaleLowerCase();
    }));
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MemoryReadClient implements SupabaseReadClient {
  readonly requestedTables: string[] = [];
  private readonly records: Record<string, Record<string, unknown>[]>;
  constructor(records: Record<string, Record<string, unknown>[]>) { this.records = records; }
  from(table: "businesses" | "communities") { this.requestedTables.push(table); return new MemoryQuery(this, table); }
  rows(table: "businesses" | "communities") { return this.records[table] ?? []; }
}

function client(businesses: Record<string, unknown>[], communities: Record<string, unknown>[] = []) {
  const fake = new MemoryReadClient({ businesses, communities });
  return { fake, trustHub: new SupabaseTrustHubClient(fake) };
}

test("reads and maps a matching TrustHub business using city-scoped queries", async () => {
  const { fake, trustHub } = client([row()]);
  const [business] = await trustHub.searchBusinesses(BASE_REQUEST);
  assert.equal(business.name, "Moyo Plumbing");
  assert.equal(business.id, row().id);
  assert.equal(business.reviewsCount, 8);
  assert.equal(fake.requestedTables[0], "businesses");
});

test("multiple possible business matches remain distinct and trigger clarification for a fact query", async () => {
  const { trustHub } = client([row(), row({ id: "30465036-75a7-497d-99a7-158edb099108", name: "City Plumbing" })]);
  const source = new TrustHubBusinessAnswerSource(trustHub, () => "2026-09-27T00:00:00.000Z");
  const request = { ...BASE_REQUEST, questionType: "business_fact" as const, requestedAttribute: "phone" };
  const resolver = new PolicyAnswerResolver({ trusthub: source });
  const result = await resolver.resolve(request);
  assert.equal(result.status, "clarification_needed");
  assert.equal(result.evidence.length, 2);
  assert.match(result.clarificationQuestion ?? "", /City Plumbing, Moyo Plumbing/);
});

test("no TrustHub match is represented as an empty search and remains eligible for consented routes", async () => {
  const { trustHub } = client([]);
  const result = await new TrustHubBusinessAnswerSource(trustHub).search(BASE_REQUEST);
  assert.equal(result.matchStatus, "none");
  assert.deepEqual(result.evidence, []);
  const resolution = await new PolicyAnswerResolver({ trusthub: new TrustHubBusinessAnswerSource(trustHub) }).resolve(BASE_REQUEST);
  assert.equal(resolution.status, "community_needed");
  assert.equal(resolution.sourceAttempts[0].status, "empty");
});

test("missing requested information is a partial, explicitly unknown claim", async () => {
  const { trustHub } = client([row({ phone: null })]);
  const request = { ...BASE_REQUEST, questionType: "business_fact" as const, entityName: "Moyo Plumbing", requestedAttribute: "phone" };
  const result = await new TrustHubBusinessAnswerSource(trustHub, () => "2026-09-27T00:00:00.000Z").search(request);
  assert.equal(result.matchStatus, "partial");
  assert.equal(result.evidence[0].completeness, "partial");
  assert.equal(result.evidence[0].verificationStatus, "unknown");
  assert.match(result.evidence[0].claim, /does not include a phone number/);
});

test("business evidence preserves TrustHub record and upstream source provenance", async () => {
  const { trustHub } = client([row()]);
  const result = await new TrustHubBusinessAnswerSource(trustHub, () => "2026-09-27T00:00:00.000Z").search(BASE_REQUEST);
  const evidence = result.evidence[0];
  assert.equal(evidence.source, "trusthub");
  assert.equal(evidence.sourceRecordId, row().id);
  assert.equal(evidence.recordSource, "manual");
  assert.equal(evidence.recordSourceId, "import-42");
  assert.equal(evidence.retrievedAt, "2026-09-27T00:00:00.000Z");
});

test("missing Supabase configuration fails clearly and resolver records unavailable rather than empty", async () => {
  const unconfigured = new SupabaseTrustHubClient();
  await assert.rejects(unconfigured.searchBusinesses(BASE_REQUEST), SupabaseConfigurationError);
  const resolution = await new PolicyAnswerResolver({ trusthub: new TrustHubBusinessAnswerSource(unconfigured) }).resolve(BASE_REQUEST);
  assert.equal(resolution.sourceAttempts[0].status, "unavailable");
  assert.match(resolution.sourceAttempts[0].note ?? "", /server-side SUPABASE_URL and server-only SUPABASE_SECRET_KEY/);
  assert.notEqual(resolution.sourceAttempts[0].status, "empty");
});

test("resolver consumes the TrustHub adapter evidence and keeps source attribution", async () => {
  const { trustHub } = client([row()]);
  const resolver = new PolicyAnswerResolver({ trusthub: new TrustHubBusinessAnswerSource(trustHub, () => "2026-09-27T00:00:00.000Z") });
  const result = await resolver.resolve(BASE_REQUEST);
  assert.equal(result.status, "community_needed");
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.provenance, ["trusthub"]);
  assert.match(result.evidence[0].claim, /TrustHub lists Moyo Plumbing/);
});

test("reads the existing city-level community schema without inventing area data", async () => {
  const communityRow = { id: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", name: "Harare", city: "Harare", country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: "2025-01-01T00:00:00Z" };
  const { fake, trustHub } = client([], [communityRow]);
  const [community] = await trustHub.listCommunitiesByLocation("Zimbabwe", "Harare");
  assert.equal(community.id, communityRow.id);
  assert.equal(community.city, "Harare");
  assert.equal("area" in community, false);
  assert.equal(fake.requestedTables[0], "communities");
});

test("local runtime integrates turn, coordinator, resolver and TrustHub business/community reads", async () => {
  const communityRow = { id: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", name: "Harare", city: "Harare", country: "Zimbabwe", description: "", latitude: null, longitude: null, created_at: "2025-01-01T00:00:00Z" };
  const { fake, trustHub } = client([row()], [communityRow]);
  const request: NormalizedRequest = { ...BASE_REQUEST, text: "What is Moyo Plumbing's phone number?", questionType: "business_fact", entityName: "Moyo Plumbing", requestedAttribute: "phone" };
  const runtime = createConversationRuntime({ trustHubClient: trustHub, now: () => "2026-09-27T00:00:00.000Z" });
  const result = await runtime.handleTurn({ conversationId: "runtime-integration", text: request.text, request });

  assert.equal(result.resolution?.status, "answered");
  assert.equal(result.state, "answer_found");
  assert.match(result.reply, /\+263 77 000 0000/);
  assert.equal(result.resolution?.evidence[0].sourceRecordId, row().id);
  assert.equal(result.resolution?.evidence[0].recordSourceId, "import-42");
  assert.deepEqual(result.resolution?.communityLookup?.records.map(({ id }) => id), [communityRow.id]);
  assert.deepEqual(fake.requestedTables, ["businesses", "communities"]);
});

test("local runtime reports absent Supabase access as unavailable instead of no match", async () => {
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient() });
  const result = await runtime.handleTurn({ conversationId: "runtime-unconfigured", text: BASE_REQUEST.text, request: BASE_REQUEST });
  assert.equal(result.resolution?.sourceAttempts[0].status, "unavailable");
  assert.match(result.resolution?.sourceAttempts[0].note ?? "", /SUPABASE_SECRET_KEY \(or legacy SUPABASE_SERVICE_ROLE_KEY\) are required/);
  assert.notEqual(result.resolution?.sourceAttempts[0].status, "empty");
});
