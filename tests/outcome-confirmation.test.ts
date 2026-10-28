import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import type { AnswerSourceResult, EvidenceItem, NormalizedRequest } from "../lib/answer-resolution/types.ts";
import { ConversationCoordinator } from "../lib/conversation-coordinator/coordinator.ts";
import type { OutcomeConfirmation } from "../lib/conversation-coordinator/types.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { SupabaseServiceRequestRepository } from "../lib/requests/supabase-repository.ts";
import { recordRequestOutcomeConfirmation } from "../lib/requests/confirm-outcome.ts";
import { SupabaseRuntimeEventRecorder } from "../lib/observability/supabase-recorder.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";
import type { CreateServiceRequest } from "../types/service-request.ts";

const CONVERSATION_ID = "27";
const PROFILE_ID = "42";
const COMMUNITY_ID = "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b";
const REQUEST_ID = "30465036-75a7-497d-99a7-158edb099108";
const CREATED_AT = "2026-09-29T08:00:00.000Z";
const CONFIRMED_AT = "2026-09-29T08:05:00.000Z";

const businessEvidence: EvidenceItem = {
  id: "ev-1", claim: "TrustHub lists Moyo Plumbing in Harare.", source: "trusthub", sourceLabel: "TrustHub business record",
  verificationStatus: "verified", confidence: "high", retrievedAt: CREATED_AT, sourceRecordId: "b2e1a0c4-7a1e-4b7b-8f0f-2f0f1c9d6a55",
};
const discoveryRequest: NormalizedRequest = { text: "Find a plumber in Harare", intent: "find_business", category: "plumber", location: { country: "Zimbabwe", city: "Harare" }, questionType: "business_discovery" };
const factRequest: NormalizedRequest = { ...discoveryRequest, text: "Is Moyo Plumbing open on Saturday?", intent: "ask_question", questionType: "business_fact", entityName: "Moyo Plumbing" };

type Table = "profiles" | "help_requests" | "help_request_outcomes" | "connect_runtime_events";

/**
 * Double of the verified live tables the outcome flow touches: unique
 * `help_requests.idempotency_key`, one outcome row per request
 * (`help_request_outcomes` primary key), the primary-keyed
 * `connect_runtime_events` sink, and the live `connect_help_request_evidence_guard`
 * behavior that rejects any UPDATE which attaches or removes consent evidence.
 */
class MemoryDatabase implements SupabaseDataClient {
  readonly rows: Record<Table, SupabaseRow[]> = { profiles: [{ id: 42, user_id: "auth-user-42" }], help_requests: [], help_request_outcomes: [], connect_runtime_events: [] };
  /** Every UPDATE the application attempts, so tests can prove exactly what was written. */
  readonly updates: { table: Table; values: SupabaseRow }[] = [];
  from(table: string): SupabaseQuery { return new Query(this, table as Table); }
  execute(table: Table, operation: string, values: SupabaseRow, filters: [string, unknown][], ignoreDuplicates: boolean): SupabaseQueryResult {
    if (operation === "select") {
      const row = this.rows[table].find((item) => filters.every(([key, value]) => String(item[key] ?? "") === String(value ?? "")));
      return { data: row ?? null, error: null };
    }
    if (operation === "update" && table === "help_requests") {
      this.updates.push({ table, values });
      const row = this.rows.help_requests.find((item) => filters.every(([key, value]) => String(item[key] ?? "") === String(value ?? "")));
      if (!row) return { data: null, error: null };
      const removesConsent = row.community_consent_at != null && (values.community_consent_at === null || values.community_consent_version === null);
      const attachesConsent = row.community_consent_at == null && values.community_consent_at != null;
      if (removesConsent || attachesConsent) return { data: null, error: { code: "23514", message: "community consent evidence must be recorded atomically when creating the request" } };
      Object.assign(row, values);
      return { data: row, error: null };
    }
    if (operation === "upsert" && table === "help_requests" && this.rows.help_requests.some((item) => item.idempotency_key === values.idempotency_key)) {
      const existing = this.rows.help_requests.find((item) => item.idempotency_key === values.idempotency_key)!;
      return { data: ignoreDuplicates ? null : existing, error: null };
    }
    if (operation === "upsert" && table === "help_request_outcomes") {
      const existing = this.rows.help_request_outcomes.find((item) => item.help_request_id === values.help_request_id);
      if (existing) { Object.assign(existing, values); return { data: existing, error: null }; }
    }
    if (operation === "upsert" && table === "connect_runtime_events" && this.rows.connect_runtime_events.some((item) => item.id === values.id)) {
      return { data: ignoreDuplicates ? null : this.rows.connect_runtime_events.find((item) => item.id === values.id)!, error: null };
    }
    if (operation === "insert" || operation === "upsert") {
      const row: SupabaseRow = { id: table === "help_requests" ? REQUEST_ID : String(this.rows[table].length + 1), ...values };
      if (table === "help_requests") row.created_at = CREATED_AT;
      if (table === "help_request_outcomes") row.recorded_at = CREATED_AT;
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

function persistedRequest(overrides: Partial<CreateServiceRequest> = {}): CreateServiceRequest {
  return {
    conversationId: CONVERSATION_ID, trustHubProfileId: PROFILE_ID, communityKey: "zimbabwe:harare", communityId: COMMUNITY_ID,
    area: "Avondale", sourceChannel: "whatsapp", requestedCategory: "plumber", requestText: discoveryRequest.text,
    intent: "find_business", status: "open", resolvedAt: null, timeToUsefulAnswerSeconds: null,
    idempotencyKey: "whatsapp:wamid.request", communityConsentAt: CREATED_AT, communityConsentVersion: "community-help-v1", ...overrides,
  };
}

/** The real coordinator, resolver and production event recorder over the table double. */
function flow() {
  const database = new MemoryDatabase();
  const repository = new SupabaseServiceRequestRepository(database, new SupabaseRuntimeEventRecorder(database));
  const conversations = new InMemoryRuntimeConversationRepository();
  const resolver = new PolicyAnswerResolver({ trusthub: { async search(): Promise<AnswerSourceResult> { return { matchStatus: "matched", evidence: [businessEvidence] }; } } });
  const coordinator = new ConversationCoordinator(conversations, resolver, () => CONFIRMED_AT);
  return { database, repository, conversations, coordinator };
}


test("every delivered answer ends with the explicit outcome-confirmation question", async () => {
  const { coordinator } = flow();
  const answer = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: discoveryRequest.text, request: discoveryRequest, providerMessageId: "wamid.request" });
  assert.equal(answer.state, "answer_found");
  assert.equal(answer.outcomeConfirmation, null, "the answer itself must never record an outcome");
  assert.match(answer.reply, /Did one of these work out\?/);
});

test("a helpful confirmation records one outcome and closes the matched request", async () => {
  const { database, repository, coordinator } = flow();
  const created = await repository.create(persistedRequest());
  await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: discoveryRequest.text, request: discoveryRequest, providerMessageId: "wamid.request" });
  const confirmed = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: "Yes", providerMessageId: "wamid.confirm" });

  assert.equal(confirmed.state, "resolved");
  assert.deepEqual(confirmed.outcomeConfirmation, { helpful: true, confirmedAt: CONFIRMED_AT, matchConfirmed: true });
  assert.equal(await recordRequestOutcomeConfirmation(repository, { conversationId: CONVERSATION_ID, confirmation: confirmed.outcomeConfirmation! }), "recorded");

  assert.equal(database.rows.help_request_outcomes.length, 1);
  assert.equal(database.rows.help_request_outcomes[0].help_request_id, created.id);
  assert.equal(database.rows.help_request_outcomes[0].useful_answer_confirmed, true);
  assert.equal(database.rows.help_request_outcomes[0].match_confirmed, true);
  assert.equal(database.rows.help_request_outcomes[0].resolved_at, CONFIRMED_AT);
  assert.equal(database.rows.help_requests[0].status, "resolved");
  assert.equal(database.rows.help_requests[0].resolved_at, CONFIRMED_AT);
  assert.deepEqual(database.rows.connect_runtime_events.map((event) => event.name), ["request_outcome_recorded"]);
});

test("a confirmed factual answer records a useful answer without claiming a match", async () => {
  const { database, repository, coordinator } = flow();
  await repository.create(persistedRequest({ requestText: factRequest.text, intent: "ask_question" }));
  await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: factRequest.text, request: factRequest, providerMessageId: "wamid.request" });
  const confirmed = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: "Yes", providerMessageId: "wamid.confirm" });

  assert.equal(confirmed.outcomeConfirmation?.matchConfirmed, false, "a confirmed fact answer is never a business match");
  await recordRequestOutcomeConfirmation(repository, { conversationId: CONVERSATION_ID, confirmation: confirmed.outcomeConfirmation! });
  assert.equal(database.rows.help_requests[0].status, "resolved");
  assert.equal(database.rows.help_request_outcomes[0].useful_answer_confirmed, true);
  assert.equal(database.rows.help_request_outcomes[0].match_confirmed, false);
});


test("a not-helpful confirmation records the fact and leaves the request open", async () => {
  const { database, repository, coordinator } = flow();
  await repository.create(persistedRequest());
  await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: discoveryRequest.text, request: discoveryRequest, providerMessageId: "wamid.request" });
  const declined = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: "No", providerMessageId: "wamid.decline" });

  assert.equal(declined.state, "unresolved");
  assert.equal(declined.action, "final_unresolved");
  assert.deepEqual(declined.outcomeConfirmation, { helpful: false, confirmedAt: CONFIRMED_AT, matchConfirmed: false });
  assert.equal(await recordRequestOutcomeConfirmation(repository, { conversationId: CONVERSATION_ID, confirmation: declined.outcomeConfirmation! }), "recorded");

  assert.equal(database.rows.help_request_outcomes.length, 1);
  assert.equal(database.rows.help_request_outcomes[0].useful_answer_confirmed, false);
  assert.equal(database.rows.help_request_outcomes[0].resolved_at, null);
  assert.equal(database.rows.help_requests[0].status, "open", "an unhelpful answer must never close the request");
  assert.equal(database.rows.help_requests[0].resolved_at, null);
  assert.deepEqual(database.rows.connect_runtime_events.map((event) => event.name), ["request_outcome_recorded"]);
});

test("a replayed confirmation turn reuses the stored confirmation and writes nothing twice", async () => {
  const { database, repository, conversations, coordinator } = flow();
  await repository.create(persistedRequest());
  await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: discoveryRequest.text, request: discoveryRequest, providerMessageId: "wamid.request" });
  const first = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: "Yes", providerMessageId: "wamid.confirm" });
  const replay = await coordinator.handleTurn({ conversationId: CONVERSATION_ID, channel: "whatsapp", text: "Yes again", providerMessageId: "wamid.confirm" });

  assert.deepEqual(replay.outcomeConfirmation, first.outcomeConfirmation, "a webhook retry must recover the same confirmation");
  const stored = await conversations.get(CONVERSATION_ID);
  assert.equal(stored?.messages.length, 4, "a duplicate provider message must not append another turn");

  assert.equal(await recordRequestOutcomeConfirmation(repository, { conversationId: CONVERSATION_ID, confirmation: first.outcomeConfirmation! }), "recorded");
  assert.equal(await recordRequestOutcomeConfirmation(repository, { conversationId: CONVERSATION_ID, confirmation: first.outcomeConfirmation! }), "not_pending");
  assert.equal(database.rows.help_request_outcomes.length, 1, "one current outcome per help request");
  assert.equal(database.rows.connect_runtime_events.length, 1, "a retry must not add a second runtime event");
  assert.equal(database.rows.help_requests.length, 1);
});

test("an already resolved or absent request is never re-confirmed and writes nothing", async () => {
  const confirmation: OutcomeConfirmation = { helpful: true, confirmedAt: CONFIRMED_AT, matchConfirmed: true };
  const closed = new MemoryDatabase();
  closed.rows.help_requests.push({
    id: REQUEST_ID, conversation_id: CONVERSATION_ID, requester_id: "auth-user-42", community_id: COMMUNITY_ID,
    description: discoveryRequest.text, intent: "find_business", source_channel: "whatsapp", status: "answered",
    community_consent_at: CREATED_AT, community_consent_version: "community-help-v1", idempotency_key: "whatsapp:wamid.request",
    created_at: CREATED_AT, resolved_at: "2026-09-29T08:04:00.000Z",
  });
  assert.equal(await recordRequestOutcomeConfirmation(new SupabaseServiceRequestRepository(closed), { conversationId: CONVERSATION_ID, confirmation }), "not_pending");
  assert.equal(closed.rows.help_request_outcomes.length, 0);
  assert.equal(closed.rows.connect_runtime_events.length, 0);
  assert.equal(closed.updates.length, 0, "a closed request must not be written again");

  const missing = new MemoryDatabase();
  assert.equal(await recordRequestOutcomeConfirmation(new SupabaseServiceRequestRepository(missing), { conversationId: CONVERSATION_ID, confirmation }), "no_request");
  assert.equal(missing.rows.help_request_outcomes.length, 0);
  assert.equal(missing.rows.connect_runtime_events.length, 0);
});
