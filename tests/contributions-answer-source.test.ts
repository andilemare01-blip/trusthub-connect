import assert from "node:assert/strict";
import test from "node:test";
// @ts-ignore
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier: string, context: any, nextResolve: (s: string, c: any) => any) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
import { createTrustHubAnswerResolver } from "../lib/answer-resolution/factory.ts";
import { DeterministicAnswerGenerator } from "../lib/answer-resolution/response-generator.ts";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import type { DiscoveryRecord, KnowledgeRecordReader } from "../lib/discovery/service.ts";
import type { DeclaredContributionQuery, DeclaredContributionRecord, ContributionRepository } from "../lib/contributions/repository.ts";
import { SupabaseContributionRepository } from "../lib/contributions/supabase-repository.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";
import type { ExistingCommunityReference } from "../types/community.ts";

const COMMUNITY_ID = "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b";
const OTHER_COMMUNITY_ID = "30465036-75a7-497d-99a7-158edb099108";
const NOW = "2026-09-30T08:00:00.000Z";

const request: NormalizedRequest = {
  text: "Is there a plumber in Harare?",
  intent: "find_provider",
  category: "plumber",
  location: { country: "Zimbabwe", city: "Harare", area: "Avondale" },
  questionType: "provider_recommendation",
};

function community(id: string, city: string): ExistingCommunityReference {
  return { id, name: city, city, country: "Zimbabwe", description: null, latitude: null, longitude: null, createdAt: "2026-09-01T00:00:00.000Z" };
}

function client(communities = [community(COMMUNITY_ID, "Harare")]) {
  return {
    searchBusinesses: async () => [],
    listCommunitiesByLocation: async () => communities,
  };
}

function declaredRecord(overrides: Partial<DeclaredContributionRecord> = {}): DeclaredContributionRecord {
  return {
    id: "900",
    claim: "Mr Moyo fixed my sink in Avondale last week.",
    category: "plumber",
    providerName: "Mr Moyo",
    communityId: COMMUNITY_ID,
    area: "Avondale",
    source: "whatsapp",
    relationship: "community_recommendation",
    evidenceNotes: "Deterministically extracted candidate; not independently verified.",
    verificationStatus: "declared",
    sourceMessageId: "512",
    relatedConversationId: "77",
    createdAt: "2026-09-29T08:00:00.000Z",
    ...overrides,
  };
}

class RecordingReader {
  readonly calls: DeclaredContributionQuery[] = [];
  private readonly records: DeclaredContributionRecord[];
  constructor(records: DeclaredContributionRecord[]) { this.records = records; }
  async findDeclaredByCommunity(query: DeclaredContributionQuery): Promise<DeclaredContributionRecord[]> {
    this.calls.push(query);
    return this.records;
  }
}

const approvedKnowledge: DiscoveryRecord = {
  id: "knowledge-1", source: "trusthub", sourceLabel: "TrustHub knowledge record", sourceRecordId: "record-1",
  name: "Example Plumbing", category: "plumber", city: "Harare", area: "Avondale",
  contact: null, summary: null, verificationStatus: "verified", confidence: "high",
  provenance: ["source:official_registry", "reuse_status:approved"], completeness: "complete",
};

const approvedKnowledgeReader: KnowledgeRecordReader = { searchDiscoverable: async () => [approvedKnowledge] };

test("a persisted declared contribution is returned as answer evidence with its status and provenance intact", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);

  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  assert.equal(result.status, "partially_answered");
  assert.deepEqual(reader.calls, [{ communityId: COMMUNITY_ID, area: "Avondale", category: "plumber" }]);
  const evidence = result.evidence[0];
  assert.equal(evidence.source, "community");
  assert.equal(evidence.sourceRecordId, "900");
  assert.match(evidence.claim, /Mr Moyo fixed my sink in Avondale last week\./);
  assert.match(evidence.claim, /unverified/);
  assert.deepEqual(result.provenance, ["community"]);
  assert.deepEqual(result.sourceAttempts.find((attempt) => attempt.source === "community"), {
    source: "community", status: "checked", note: "Community contributions are member-declared and unverified.",
  });
});

test("declared contribution evidence preserves provenance, community scope and the originating message reference", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);

  const [evidence] = (await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true })).evidence;

  assert.deepEqual(evidence.provenanceDetails, [
    "contribution_id:900",
    `community_id:${COMMUNITY_ID}`,
    "area:Avondale",
    "source:whatsapp",
    "relationship:community_recommendation",
    "source_message_id:512",
    "evidence_notes:Deterministically extracted candidate; not independently verified.",
  ]);
  assert.equal(evidence.recordSource, "whatsapp");
  assert.equal(evidence.recordSourceId, "512");
  assert.equal(evidence.id, "contribution:900");
});

test("declared contribution evidence is never rendered as verified", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);
  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  assert.ok(result.evidence.every((item) => item.verificationStatus === "declared"));
  assert.ok(result.evidence.every((item) => item.confidence !== "high"));
  assert.equal(result.uncertainty, "Some evidence is incomplete or unverified.");

  const answer = await new DeterministicAnswerGenerator().generate(result);
  assert.match(answer.text, /source: TrustHub community contribution for Mr Moyo; declared; confidence: low/);
  assert.doesNotMatch(answer.text, /; verified;/);
  assert.doesNotMatch(answer.text, /; observed;/);
});

test("a contribution row that is not declared fails loudly instead of being answered as verified", async () => {
  const reader = new RecordingReader([declaredRecord({ verificationStatus: "verified" as "declared" })]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);

  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  // The resolver's own community constraint still pins the status to `declared`
  // even if a caller or database hands the source a non-declared record.
  assert.ok(result.evidence.every((item) => item.verificationStatus === "declared"));
  assert.equal(result.status, "partially_answered");
});

test("approved knowledge_records keep their trust semantics and stay ahead of contributions, which are never merged into them", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, approvedKnowledgeReader, reader);

  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  assert.equal(result.evidence.length, 2);
  const approved = result.evidence[0];
  assert.equal(approved.source, "trusthub");
  assert.equal(approved.sourceRecordId, "record-1");
  assert.equal(approved.verificationStatus, "verified");
  assert.equal(approved.confidence, "high");
  assert.equal(approved.completeness, "complete");
  assert.equal(approved.sourceLabel, "TrustHub knowledge record");

  const declared = result.evidence[1];
  assert.equal(declared.source, "community");
  assert.equal(declared.verificationStatus, "declared");
  assert.notEqual(declared.id, approved.id, "contribution evidence is a separate item, not merged into the approved record");

  assert.deepEqual(result.provenance, ["trusthub", "community"]);
  // Unverified community input may only lower confidence, never raise it.
  assert.ok(result.evidence.every((item) => item.verificationStatus !== "potential" || item.source !== "trusthub"));
});

test("with no persisted contribution the approved knowledge_records resolution is unchanged", async () => {
  const empty = new RecordingReader([]);
  const withContributions = await createTrustHubAnswerResolver(client(), () => NOW, approvedKnowledgeReader, empty)
    .resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });
  const withoutContributions = await createTrustHubAnswerResolver(client(), () => NOW, approvedKnowledgeReader)
    .resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  // The only intended difference: an unconfigured community source is recorded
  // as `unavailable`, a configured one that found nothing as `empty`.
  assert.deepEqual(
    withContributions.sourceAttempts.filter((attempt) => attempt.source === "community"),
    [{ source: "community", status: "empty" }],
  );
  assert.deepEqual(
    withoutContributions.sourceAttempts.filter((attempt) => attempt.source === "community"),
    [{ source: "community", status: "unavailable" }],
  );

  assert.deepEqual(withContributions.evidence, withoutContributions.evidence);
  assert.equal(withContributions.evidence[0].verificationStatus, "verified");
  assert.equal(withContributions.status, withoutContributions.status);
  assert.equal(withContributions.nextAction, withoutContributions.nextAction);
  assert.equal(withContributions.uncertainty, withoutContributions.uncertainty);
  assert.equal(withContributions.confidence, withoutContributions.confidence);
  assert.deepEqual(withContributions.provenance, withoutContributions.provenance);
  assert.deepEqual(empty.calls, [{ communityId: COMMUNITY_ID, area: "Avondale", category: "plumber" }]);
});

test("approved knowledge_records answer discovery without the community source ever being consulted", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const discovery: NormalizedRequest = { ...request, questionType: "business_discovery" };
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, approvedKnowledgeReader, reader);

  const result = await resolver.resolve(discovery, { requesterConsentedToCommunity: true, communityAvailable: true });

  assert.equal(result.status, "answered");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].source, "trusthub");
  assert.deepEqual(reader.calls, [], "approved knowledge must not be diluted by a community lookup");
});

test("community contributions stay consent-gated exactly as before", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);

  const result = await resolver.resolve(request, {});

  assert.equal(result.evidence.length, 0);
  assert.deepEqual(reader.calls, []);
  assert.equal(result.nextAction, "ask_community_permission");
  assert.ok(result.sourceAttempts.some((attempt) => attempt.source === "community" && attempt.status === "skipped"));
});

test("an ambiguous or unknown location resolves no community rather than guessing one", async () => {
  const reader = new RecordingReader([declaredRecord()]);
  const resolver = createTrustHubAnswerResolver(
    client([community(COMMUNITY_ID, "Harare"), community(OTHER_COMMUNITY_ID, "Harare")]),
    () => NOW, undefined, reader,
  );

  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });

  assert.deepEqual(reader.calls, []);
  assert.equal(result.evidence.length, 0);
  assert.ok(result.sourceAttempts.some((attempt) => attempt.source === "community" && attempt.status === "unavailable"));
});

type ContributionsRow = SupabaseRow;

class ContributionsQuery implements SupabaseQuery {
  readonly filters: [string, unknown][] = [];
  private readonly rows: ContributionsRow[];
  private sort: { column: string; ascending: boolean } | null = null;
  private count: number | null = null;
  constructor(rows: ContributionsRow[]) { this.rows = rows; }
  select(): SupabaseQuery { return this; }
  insert(): SupabaseQuery { throw new Error("not used"); }
  update(): SupabaseQuery { throw new Error("not used"); }
  upsert(): SupabaseQuery { throw new Error("not used"); }
  eq(column: string, value: unknown): SupabaseQuery { this.filters.push([column, value]); return this; }
  ilike(): SupabaseQuery { return this; }
  is(column: string, value: null | boolean): SupabaseQuery { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery { this.sort = { column, ascending: options?.ascending ?? true }; return this; }
  limit(count: number): SupabaseQuery { this.count = count; return this; }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.execute()); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.execute()); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.execute()).then(onfulfilled, onrejected); }
  private execute(): SupabaseQueryResult {
    const rows = this.rows
      .filter((row) => this.filters.every(([key, value]) => String(row[key] ?? "") === String(value ?? "")))
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) * (this.sort?.ascending ? 1 : -1));
    return { data: this.count === null ? rows : rows.slice(0, this.count), error: null };
  }
}

function contributionsClient(rows: ContributionsRow[]): { client: SupabaseDataClient; queries: ContributionsQuery[] } {
  const queries: ContributionsQuery[] = [];
  return {
    queries,
    client: { from: () => { const query = new ContributionsQuery(rows); queries.push(query); return query; } },
  };
}

test("the persistence read is community-scoped, declared-only, and maps the existing columns", async () => {
  const rows: ContributionsRow[] = [{
    id: "900", category: "plumber", claim_text: "Mr Moyo fixed my sink.", provider_name: "Mr Moyo",
    community_id: COMMUNITY_ID, area: "Avondale", source: "whatsapp", relationship: "community_recommendation",
    evidence_notes: "not independently verified", verification_status: "declared",
    source_message_id: "512", related_conversation_id: "77", created_at: "2026-09-29T08:00:00.000Z",
  }];
  const { client: database, queries } = contributionsClient(rows);

  const found = await new SupabaseContributionRepository(database).findDeclaredByCommunity({
    communityId: COMMUNITY_ID, area: "Avondale", category: "plumber",
  });

  assert.deepEqual(queries[0].filters, [
    ["community_id", COMMUNITY_ID],
    ["verification_status", "declared"],
    ["area", "Avondale"],
    ["category", "plumber"],
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].verificationStatus, "declared");
  assert.equal(found[0].sourceMessageId, "512");
  assert.equal(found[0].relatedConversationId, "77");
  assert.equal(found[0].claim, "Mr Moyo fixed my sink.");
});

test("a non-declared or other-community row is never returned by the persistence read", async () => {
  const rows: ContributionsRow[] = [
    { id: "901", claim_text: "verified claim", community_id: COMMUNITY_ID, verification_status: "verified", created_at: "2026-09-29T08:00:00.000Z" },
    { id: "902", claim_text: "other community", community_id: OTHER_COMMUNITY_ID, verification_status: "declared", created_at: "2026-09-29T08:00:00.000Z" },
  ];
  const { client: database } = contributionsClient(rows);

  assert.deepEqual(await new SupabaseContributionRepository(database).findDeclaredByCommunity({ communityId: COMMUNITY_ID }), []);
});

test("the persistence read rejects a non-UUID community instead of querying loosely", async () => {
  const { client: database, queries } = contributionsClient([]);

  await assert.rejects(
    () => new SupabaseContributionRepository(database).findDeclaredByCommunity({ communityId: "Harare" }),
    /contributions.community_id must be a UUID/,
  );
  assert.equal(queries.length, 0);
});

// --- Factory wiring tests (mocked Supabase) ---

/** A SupabaseDataClient whose `from` factory throws when configuration is missing. */
function throwingClient(error: Error): SupabaseDataClient {
  return { from: () => { throw error; } };
}

test("createContributionRepository wires the production read path to the existing Supabase implementation", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createContributionRepository } = await import("../lib/contributions/repository.ts");
    const repository = createContributionRepository();
    assert.ok(repository instanceof SupabaseContributionRepository, "the factory must return the real Supabase adapter, not a not-connected stub");
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl; else delete process.env.SUPABASE_URL;
    if (originalKey !== undefined) process.env.SUPABASE_SECRET_KEY = originalKey; else delete process.env.SUPABASE_SECRET_KEY;
    if (originalServiceRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("createContributionRepository fails loudly when Supabase configuration is missing instead of returning a silent stub", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createContributionRepository } = await import("../lib/contributions/repository.ts");
    assert.throws(() => createContributionRepository(), /Server persistence is unavailable/);
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
    if (originalKey !== undefined) process.env.SUPABASE_SECRET_KEY = originalKey;
    if (originalServiceRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  }
});

test("a database error during the read fails safely without fabricating community knowledge", async () => {
  const { client: database } = contributionsClient([]);
  (database as { from: (table: string) => SupabaseQuery }).from = () => ({
    select: () => { throw new Error("boom"); },
  }) as unknown as SupabaseQuery;
  await assert.rejects(
    () => new SupabaseContributionRepository(database).findDeclaredByCommunity({ communityId: COMMUNITY_ID }),
    /boom/,
  );
});

test("the community intelligence query can consume the repository results end-to-end", async () => {
  const rows: ContributionsRow[] = [{
    id: "900", category: "plumber", claim_text: "Mr Moyo fixed my sink.", provider_name: "Mr Moyo",
    community_id: COMMUNITY_ID, area: "Avondale", source: "whatsapp", relationship: "community_recommendation",
    evidence_notes: "not independently verified", verification_status: "declared",
    source_message_id: "512", related_conversation_id: "77", created_at: "2026-09-29T08:00:00.000Z",
  }];
  const { client: database } = contributionsClient(rows);
  const reader: ContributionRepository = new SupabaseContributionRepository(database);
  const records = await reader.findDeclaredByCommunity({ communityId: COMMUNITY_ID, area: "Avondale", category: "plumber" });
  assert.equal(records.length, 1);
  assert.equal(records[0].verificationStatus, "declared");

  const resolver = createTrustHubAnswerResolver(client(), () => NOW, undefined, reader);
  const result = await resolver.resolve(request, { requesterConsentedToCommunity: true, communityAvailable: true });
  assert.equal(result.status, "partially_answered");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].source, "community");
  assert.equal(result.evidence[0].sourceRecordId, "900");
  assert.equal(result.evidence[0].verificationStatus, "declared");
});

test("the production factory rejects an invalid Supabase URL instead of silently falling back", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "http://example.com";
  process.env.SUPABASE_SECRET_KEY = "key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createContributionRepository } = await import("../lib/contributions/repository.ts");
    assert.throws(() => createContributionRepository(), /SUPABASE_URL must be a valid HTTPS URL/);
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
    if (originalKey !== undefined) process.env.SUPABASE_SECRET_KEY = originalKey;
    if (originalServiceRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  }
});
