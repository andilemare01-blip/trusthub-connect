import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseCommunityHelpRequestRepository } from "../lib/community/supabase-help-request-repository.ts";
import { CommunityHelpRequestValidationError, createCommunityHelpRequest, createOrGetCommunityHelpRequest, type CommunityHelpRequestInput } from "../lib/community/help-requests.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

const HELP_REQUEST_ID = "30465036-75a7-497d-99a7-158edb099108";
const COMMUNITY_ID = "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b";
const OTHER_COMMUNITY_ID = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function helpRow(overrides: SupabaseRow = {}): SupabaseRow {
  return {
    id: HELP_REQUEST_ID, community_id: COMMUNITY_ID, title: "Help", description: "A water tank is leaking",
    status: "open", created_at: "2026-09-29T08:00:00.000Z", requested_category: "plumber", area: "Avondale",
    // The live insert trigger requires consent evidence at creation time, so a
    // canonical row written by Connect always arrives already consented.
    community_consent_at: "2026-09-29T08:00:00.000Z", community_consent_version: "community-help-v1", ...overrides,
  };
}

function input(overrides: Partial<CommunityHelpRequestInput> = {}): CommunityHelpRequestInput {
  return {
    id: HELP_REQUEST_ID, serviceRequestId: HELP_REQUEST_ID, communityId: COMMUNITY_ID, communityKey: "zimbabwe:harare:avondale",
    city: "Harare", area: "Avondale", category: "plumber", question: "A water tank is leaking",
    createdAt: "2026-09-29T08:00:00.000Z", requesterConsentAt: "2026-09-29T08:05:00.000Z", requesterConsent: true, ...overrides,
  };
}

type Table = "help_requests" | "communities";
/**
 * In-memory stand-in for the verified live tables. It mirrors the live
 * `connect_help_request_evidence_guard` trigger, so a test that tries to make
 * the repository attach consent after creation fails exactly like production.
 */
class MemoryDatabase implements SupabaseDataClient {
  readonly rows: Record<Table, SupabaseRow[]> = {
    help_requests: [helpRow()],
    communities: [{ id: COMMUNITY_ID, city: "Harare", country: "Zimbabwe" }, { id: OTHER_COMMUNITY_ID, city: "Bulawayo", country: "Zimbabwe" }],
  };
  /** Every UPDATE the application attempted, so tests can prove none happened. */
  readonly attemptedUpdates: SupabaseRow[] = [];
  from(table: string): SupabaseQuery { return new Query(this, table as Table); }
  execute(table: Table, operation: string, values: SupabaseRow, filters: [string, unknown][]): SupabaseQueryResult {
    const matches = this.rows[table].filter((row) => filters.every(([column, value]) => (
      value === null ? row[column] === null || row[column] === undefined : String(row[column] ?? "") === String(value ?? "")
    )));
    if (operation === "update") {
      this.attemptedUpdates.push(values);
      if (table === "help_requests") {
        for (const row of matches) {
          if (row.community_consent_at === null && values.community_consent_at !== undefined) {
            return { data: null, error: { message: "community consent evidence must be recorded atomically when creating the request", code: "23514" } };
          }
          if (row.community_consent_at !== null && values.community_consent_at === null) {
            return { data: null, error: { message: "community consent evidence cannot be removed from a help request", code: "23514" } };
          }
        }
      }
      for (const row of matches) Object.assign(row, values);
      return { data: matches.length === 1 ? matches[0] : matches.length ? matches : null, error: null };
    }
    if (operation === "select") return { data: matches.length === 1 ? matches[0] : matches, error: null };
    return { data: null, error: null };
  }
}

class Query implements SupabaseQuery {
  private operation = "select";
  private values: SupabaseRow = {};
  private filters: [string, unknown][] = [];
  private readonly db: MemoryDatabase;
  private readonly table: Table;
  constructor(db: MemoryDatabase, table: Table) { this.db = db; this.table = table; }
  select(): SupabaseQuery { return this; }
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { this.operation = "insert"; this.values = Array.isArray(values) ? values[0] : values; return this; }
  update(values: SupabaseRow): SupabaseQuery { this.operation = "update"; this.values = values; return this; }
  upsert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { return this.insert(values); }
  eq(column: string, value: unknown): SupabaseQuery { this.filters.push([column, value]); return this; }
  ilike(column: string, pattern: string): SupabaseQuery { this.filters.push([column, pattern]); return this; }
  is(column: string, value: null | boolean): SupabaseQuery { this.filters.push([column, value]); return this; }
  order(): SupabaseQuery { return this; }
  limit(): SupabaseQuery { return this; }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.run()); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.run()); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
  private run(): SupabaseQueryResult { return this.db.execute(this.table, this.operation, this.values, this.filters); }
}

test("a consented community-help request reuses the canonical help request without duplicating it", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  const first = await createOrGetCommunityHelpRequest(repository, input());
  assert.equal(first.created, false, "consent already exists on the canonical row, so nothing new is created");
  assert.equal(first.request.communityKey, "zimbabwe:harare:avondale");
  assert.equal(first.request.status, "open");
  assert.equal(first.request.requesterConsentAt, "2026-09-29T08:00:00.000Z", "the consent recorded at creation is the durable evidence");
  assert.equal(database.rows.help_requests.length, 1, "community help must never insert a second help or community record");
  assert.deepEqual(database.attemptedUpdates, [], "a community share must never write to the canonical help request");

  const again = await createOrGetCommunityHelpRequest(repository, input({ requesterConsentAt: "2026-09-29T09:30:00.000Z" }));
  assert.equal(again.created, false);
  assert.equal(again.request.requesterConsentAt, "2026-09-29T08:00:00.000Z", "the first consent evidence stays immutable");
  assert.equal(database.rows.help_requests[0].community_consent_version, "community-help-v1");
  assert.equal(database.rows.help_requests.length, 1);
});

test("consent is never rewritten by a competing writer and cross-community replay is rejected", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  database.rows.help_requests[0] = helpRow({ community_consent_at: "2026-09-29T08:01:00.000Z", community_consent_version: "community-help-v1" });
  const raced = await repository.create(createCommunityHelpRequest(input()));
  assert.equal(raced.created, false);
  assert.equal(raced.request.requesterConsentAt, "2026-09-29T08:01:00.000Z");

  await assert.rejects(
    repository.create(createCommunityHelpRequest(input({ communityId: OTHER_COMMUNITY_ID, communityKey: "zimbabwe:bulawayo" }))),
    /different community/,
  );
  assert.equal(database.rows.help_requests[0].community_id, COMMUNITY_ID);
  assert.equal(database.rows.help_requests[0].community_consent_at, "2026-09-29T08:01:00.000Z");
  assert.deepEqual(database.attemptedUpdates, [], "reuse-only reads must not issue any UPDATE");
});

test("consent cannot be attached to a request created without it, and the rejected write is never attempted", async () => {
  const database = new MemoryDatabase();
  database.rows.help_requests[0] = helpRow({ community_consent_at: null, community_consent_version: null });
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  assert.equal(await repository.findByServiceRequestId(HELP_REQUEST_ID), null, "an unconsented request stays private");
  await assert.rejects(
    repository.create(createCommunityHelpRequest(input())),
    (error: unknown) => error instanceof CommunityHelpRequestValidationError && /cannot be attached afterwards/.test((error as Error).message),
  );
  assert.deepEqual(database.attemptedUpdates, [], "the live trigger rejects this UPDATE, so the application must not send it");
  assert.equal(database.rows.help_requests[0].community_consent_at, null);
});

test("a community share is refused when no canonical help request exists", async () => {
  const database = new MemoryDatabase();
  database.rows.help_requests.length = 0;
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  await assert.rejects(repository.create(createCommunityHelpRequest(input())), /existing canonical help_requests row/);
  assert.equal(database.rows.help_requests.length, 0, "community help never creates its own help request row");
});

test("a community share with an unsupported consent version is refused before any database access", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  const candidate = createCommunityHelpRequest(input());
  await assert.rejects(
    repository.create({ ...candidate, requesterConsentVersion: "community-help-v2" }),
    /Unsupported community-help consent version/,
  );
  assert.deepEqual(database.attemptedUpdates, []);
});

test("a help request without consent evidence is never exposed as a community help request", async () => {
  const database = new MemoryDatabase();
  database.rows.help_requests[0] = helpRow({ community_consent_at: null, community_consent_version: null });
  const repository = new SupabaseCommunityHelpRequestRepository(database);
  assert.equal(await repository.findByServiceRequestId(HELP_REQUEST_ID), null);
  await assert.rejects(createOrGetCommunityHelpRequest(repository, input({ requesterConsent: false })), CommunityHelpRequestValidationError);
  await assert.rejects(createOrGetCommunityHelpRequest(repository, input({ requesterConsentAt: "not-a-date" })), /timestamps/);
  assert.equal(database.rows.help_requests[0].community_consent_at, null, "rejected consent attempts must not touch the canonical row");
});
