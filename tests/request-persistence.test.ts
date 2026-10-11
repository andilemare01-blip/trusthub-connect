import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SupabaseServiceRequestRepository } from "../lib/requests/supabase-repository.ts";
import { InMemoryRuntimeEventRecorder } from "../lib/observability/events.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";
import type { CreateServiceRequest } from "../types/service-request.ts";

const COMMUNITY_ID = "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b";
const REQUEST_ID = "30465036-75a7-497d-99a7-158edb099108";

function request(overrides: Partial<CreateServiceRequest> = {}): CreateServiceRequest {
  return {
    conversationId: "27", trustHubProfileId: "42", communityKey: "zimbabwe:harare", communityId: COMMUNITY_ID,
    area: "Avondale", sourceChannel: "whatsapp", requestedCategory: "plumber", requestText: "Find a plumber",
    intent: "find_provider", status: "open", resolvedAt: null, timeToUsefulAnswerSeconds: null,
    idempotencyKey: "wamid.source-event-1", communityConsentAt: "2026-09-29T08:00:00.000Z",
    communityConsentVersion: "community-help-v1", ...overrides,
  };
}

type Table = "profiles" | "help_requests" | "help_request_outcomes";
/** The database's `created_at DEFAULT now()` modelled with a fixed clock. */
const CREATED_AT = "2026-09-29T08:00:00.000Z";
class MemoryDatabase implements SupabaseDataClient {
  readonly rows: Record<Table, SupabaseRow[]> = {
    profiles: [{ id: 42, user_id: "auth-user-42" }],
    help_requests: [],
    help_request_outcomes: [],
  };
  private nextId = 1;
  from(table: string): SupabaseQuery { return new Query(this, table as Table); }
  execute(table: Table, operation: string, values: SupabaseRow, filters: [string, unknown][], ignoreDuplicates: boolean): SupabaseQueryResult {
    if (operation === "select") {
      const row = this.rows[table].find((item) => filters.every(([key, value]) => String(item[key] ?? "") === String(value ?? "")));
      return { data: row ?? null, error: null };
    }
    if (operation === "update" && table === "help_requests") {
      const row = this.rows.help_requests.find((item) => filters.every(([key, value]) => String(item[key] ?? "") === String(value ?? "")));
      if (!row) return { data: null, error: null };
      Object.assign(row, values);
      return { data: row, error: null };
    }
    if (operation === "upsert" && table === "help_requests") {
      const existing = this.rows.help_requests.find((item) => item.idempotency_key === values.idempotency_key);
      if (existing) return { data: ignoreDuplicates ? null : existing, error: null };
    }
    if (operation === "upsert" && table === "help_request_outcomes") {
      const existing = this.rows.help_request_outcomes.find((item) => item.help_request_id === values.help_request_id);
      if (existing) { Object.assign(existing, values); return { data: existing, error: null }; }
    }
    if (operation === "insert" || operation === "upsert") {
      const row = { id: table === "help_requests" ? REQUEST_ID : String(this.nextId++), ...(table === "help_requests" ? { created_at: CREATED_AT } : {}), ...values };
      this.rows[table].push(row);
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }
}

class Query implements SupabaseQuery {
  private operation = "select";
  private values: SupabaseRow = {};
  private filters: [string, unknown][] = [];
  private ignoreDuplicates = false;
  private readonly db: MemoryDatabase;
  private readonly table: Table;
  constructor(db: MemoryDatabase, table: Table) { this.db = db; this.table = table; }
  select(): SupabaseQuery { return this; }
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { this.operation = "insert"; this.values = Array.isArray(values) ? values[0] : values; return this; }
  update(values: SupabaseRow): SupabaseQuery { this.operation = "update"; this.values = values; return this; }
  upsert(values: SupabaseRow | SupabaseRow[], options?: { ignoreDuplicates?: boolean }): SupabaseQuery {
    this.operation = "upsert"; this.values = Array.isArray(values) ? values[0] : values; this.ignoreDuplicates = options?.ignoreDuplicates ?? false; return this;
  }
  eq(column: string, value: unknown): SupabaseQuery { this.filters.push([column, value]); return this; }
  ilike(): SupabaseQuery { return this; }
  is(): SupabaseQuery { return this; }
  order(): SupabaseQuery { return this; }
  limit(): SupabaseQuery { return this; }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.run()); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.run()); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
  private run(): SupabaseQueryResult { return this.db.execute(this.table, this.operation, this.values, this.filters, this.ignoreDuplicates); }
}

test("community help persistence requires explicit versioned consent", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseServiceRequestRepository(database);
  await assert.rejects(repository.create(request({ communityConsentAt: "", communityConsentVersion: "" })), /consent/);
  assert.equal(database.rows.help_requests.length, 0);
});

test("request consent timestamp and language version are persisted", async () => {
  const database = new MemoryDatabase();
  await new SupabaseServiceRequestRepository(database).create(request());
  assert.equal(database.rows.help_requests[0].community_consent_at, "2026-09-29T08:00:00.000Z");
  assert.equal(database.rows.help_requests[0].community_consent_version, "community-help-v1");
});

test("duplicate idempotency keys return the existing help request", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseServiceRequestRepository(database);
  const first = await repository.create(request());
  const retry = await repository.create(request());
  assert.equal(retry.id, first.id);
  assert.equal(database.rows.help_requests.length, 1);
});

test("concurrent retries use the unique-key upsert and cannot create two requests", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseServiceRequestRepository(database);
  const results = await Promise.all([repository.create(request()), repository.create(request())]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(database.rows.help_requests.length, 1);
});

test("a persisted resolution timestamp yields the time-to-useful-answer metric", async () => {
  const database = new MemoryDatabase();
  const resolved = database.rows.help_requests;
  resolved.push({
    id: REQUEST_ID, idempotency_key: "whatsapp:resolved", requester_id: "auth-user-42", community_id: COMMUNITY_ID,
    conversation_id: "27", description: "Find a plumber", requested_category: "plumber", intent: "find_provider",
    source_channel: "whatsapp", community_consent_at: "2026-09-29T08:00:00.000Z", community_consent_version: "community-help-v1",
    status: "answered", area: "Avondale", created_at: "2026-09-29T08:00:00.000Z", resolved_at: "2026-09-29T08:10:00.000Z",
  });
  resolved.push({
    id: REQUEST_ID, idempotency_key: "whatsapp:open", requester_id: "auth-user-42", community_id: COMMUNITY_ID,
    conversation_id: "27", description: "Find a plumber", requested_category: "plumber", intent: "find_provider",
    source_channel: "whatsapp", community_consent_at: "2026-09-29T08:00:00.000Z", community_consent_version: "community-help-v1",
    status: "open", area: "Avondale", created_at: "2026-09-29T08:00:00.000Z", resolved_at: null,
  });
  resolved.push({
    id: REQUEST_ID, idempotency_key: "whatsapp:malformed", requester_id: "auth-user-42", community_id: COMMUNITY_ID,
    conversation_id: "27", description: "Find a plumber", requested_category: "plumber", intent: "find_provider",
    source_channel: "whatsapp", community_consent_at: "2026-09-29T08:00:00.000Z", community_consent_version: "community-help-v1",
    status: "answered", area: "Avondale", created_at: "2026-09-29T08:10:00.000Z", resolved_at: "2026-09-29T08:00:00.000Z",
  });
  const repository = new SupabaseServiceRequestRepository(database);
  assert.equal((await repository.create(request({ idempotencyKey: "whatsapp:resolved" }))).timeToUsefulAnswerSeconds, 600);
  assert.equal((await repository.create(request({ idempotencyKey: "whatsapp:open" }))).timeToUsefulAnswerSeconds, null);
  assert.equal((await repository.create(request({ idempotencyKey: "whatsapp:malformed" }))).timeToUsefulAnswerSeconds, null);
  assert.equal(database.rows.help_requests.length, 3);
});

test("an idempotency key reused for a request in a different area is rejected as a conflict", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseServiceRequestRepository(database);
  await repository.create(request());
  await assert.rejects(repository.create(request({ area: "Borrowdale" })), /different logical request/);
  assert.equal(database.rows.help_requests.length, 1);
});

test("a live timestamptz echo of the consent instant is not a different logical request", async () => {
  const database = new MemoryDatabase();
  // The database echoes the stored timestamptz with a UTC offset, not the
  // caller's `Date#toISOString()` text, so one instant returns as a different
  // string. Comparing the text makes every first insert look like a conflict.
  database.rows.help_requests.push({
    id: REQUEST_ID, created_at: CREATED_AT, requester_id: "auth-user-42",
    community_id: COMMUNITY_ID, conversation_id: "27", title: "plumber",
    description: "Find a plumber", status: "open", resolved_at: null,
    area: "Avondale", requested_category: "plumber", intent: "find_provider",
    source_channel: "whatsapp", idempotency_key: "wamid.source-event-1",
    community_consent_at: "2026-09-29T08:00:00+00:00",
    community_consent_version: "community-help-v1",
  });

  const existing = await new SupabaseServiceRequestRepository(database).create(request());
  assert.equal(existing.id, REQUEST_ID);
  assert.equal(database.rows.help_requests.length, 1, "the retry must reuse the stored live row");
  assert.equal(existing.timeToUsefulAnswerSeconds, null);
});

test("an explicit outcome is stored once and only a confirmed resolution advances the request", async () => {
  const database = new MemoryDatabase();
  const events = new InMemoryRuntimeEventRecorder();
  const repository = new SupabaseServiceRequestRepository(database, events);
  const created = await repository.create(request());
  assert.equal(created.timeToUsefulAnswerSeconds, null);

  await repository.recordOutcome({ serviceRequestId: created.id, usefulAnswerConfirmed: true, matchConfirmed: true, resolvedAt: null });
  assert.equal(database.rows.help_request_outcomes.length, 1);
  assert.equal(database.rows.help_requests[0].resolved_at, null, "an answer/match fact alone must not close the request");
  assert.equal(database.rows.help_requests[0].status, "open");

  await repository.recordOutcome({ serviceRequestId: created.id, usefulAnswerConfirmed: true, matchConfirmed: true, resolvedAt: "2026-09-29T08:10:00.000Z" });
  assert.equal(database.rows.help_request_outcomes.length, 1, "one current outcome per help request");
  assert.equal(database.rows.help_requests[0].status, "resolved");
  assert.equal(database.rows.help_requests[0].resolved_at, "2026-09-29T08:10:00.000Z");

  const reread = await repository.create(request());
  assert.equal(reread.id, created.id, "the retry must not create a second persistent request");
  assert.equal(reread.status, "resolved");
  assert.equal(reread.timeToUsefulAnswerSeconds, 600);
  assert.deepEqual(events.events.map((event) => event.name), ["request_outcome_recorded", "request_outcome_recorded"]);
});

test("help request RLS allows own requests and consented requests in the user's communities", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_consent_outcomes_security.sql", import.meta.url), "utf8");
  assert.match(migration, /requester_id\s*=\s*\(SELECT auth\.uid\(\)\)/i);
  assert.match(migration, /community_consent_at IS NOT NULL[\s\S]*?community_consent_version IS NOT NULL[\s\S]*?FROM public\.community_members/i);
  assert.match(migration, /pg_policies[\s\S]*?cmd IN \('SELECT', 'ALL'\)/i);
});

test("community membership insert policy blocks self-assigned privileged roles", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_consent_outcomes_security.sql", import.meta.url), "utf8");
  assert.match(migration, /pg_policies[\s\S]*?cmd IN \('INSERT', 'ALL'\)/i);
  assert.match(migration, /WITH CHECK \(user_id = \(SELECT auth\.uid\(\)\) AND role = 'member'\)/i);
});

test("the restricted community membership policy still permits ordinary member creation", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_security.sql", import.meta.url), "utf8").catch(async () =>
    readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_outcomes_security.sql", import.meta.url), "utf8").catch(async () =>
      readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_consent_outcomes_security.sql", import.meta.url), "utf8")));
  assert.match(migration, /role = 'member'/i);
});

test("new persistent requests cannot omit consent evidence or a retry key at the database boundary", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_consent_outcomes_security.sql", import.meta.url), "utf8");
  assert.match(migration, /TG_OP = 'INSERT'[\s\S]*?NEW\.idempotency_key IS NULL[\s\S]*?NEW\.community_consent_at IS NULL[\s\S]*?NEW\.community_consent_version IS NULL/i);
});
