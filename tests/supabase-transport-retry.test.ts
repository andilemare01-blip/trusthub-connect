import assert from "node:assert/strict";
import test from "node:test";
import { classifySupabaseFailure, createResilientDataClient, describeSupabaseFailure, runSupabaseOperation } from "../lib/supabase/retry.ts";
import { SupabasePersistenceError } from "../lib/supabase/data-client.ts";
import { SupabaseRuntimeConversationRepository } from "../lib/conversation-coordinator/supabase-repository.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

const TRANSPORT_ERROR = {
  message: "TypeError: fetch failed",
  code: "",
  details: "TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)\nError: read ECONNRESET\n    at GetAddrInfoReqWrap.onlookupall",
  hint: "",
};

const noWait = { sleep: async () => {}, baseDelayMs: 0 };

test("a bare 'fetch failed' message is a transport failure and keeps its operating-system cause", () => {
  const failure = classifySupabaseFailure(TRANSPORT_ERROR);
  assert.equal(failure.kind, "transport");
  assert.equal(failure.cause, "Error: read ECONNRESET (ECONNRESET)");
  assert.match(describeSupabaseFailure("Append conversation message", TRANSPORT_ERROR), /Append conversation message: TypeError: fetch failed \[transport failure: Error: read ECONNRESET \(ECONNRESET\)\]/);
});

test("a database rejection is never classified as a transport failure", () => {
  for (const error of [
    { message: 'duplicate key value violates unique constraint "conversation_messages_provider_message_id_key"', code: "23505" },
    { message: 'column businesses.business_verified does not exist', code: "42703" },
    { message: "Could not find the table 'public.service_requests'", code: "PGRST205" },
  ]) {
    const failure = classifySupabaseFailure(error);
    assert.equal(failure.kind, "database", JSON.stringify(error));
    assert.equal(failure.code, error.code);
    assert.match(describeSupabaseFailure("Load", error), /\[database code /);
  }
});

test("only transport failures are retried and a transport failure eventually succeeds", async () => {
  let calls = 0;
  const result = await runSupabaseOperation(() => {
    calls += 1;
    return Promise.resolve<SupabaseQueryResult>(calls < 3 ? { data: null, error: TRANSPORT_ERROR } : { data: { id: "1" }, error: null });
  }, { operation: "Load", ...noWait });
  assert.equal(calls, 3);
  assert.deepEqual(result.data, { id: "1" });

  let databaseCalls = 0;
  const rejected = await runSupabaseOperation(() => {
    databaseCalls += 1;
    return Promise.resolve<SupabaseQueryResult>({ data: null, error: { message: "duplicate key", code: "23505" } });
  }, { operation: "Load", ...noWait });
  assert.equal(databaseCalls, 1, "a database rejection must never be repeated");
  assert.equal(rejected.error?.code, "23505");
});

test("a non-idempotent write stops retrying once the write is confirmed stored", async () => {
  let calls = 0;
  let stored = false;
  const result = await runSupabaseOperation(() => {
    calls += 1;
    if (calls === 1) stored = true;
    return Promise.resolve<SupabaseQueryResult>({ data: null, error: TRANSPORT_ERROR });
  }, { operation: "Append", idempotent: false, retrySafe: async () => stored, ...noWait });
  assert.equal(calls, 1, "a write that committed with a lost response must not be sent again");
  assert.equal(result.error?.message, "TypeError: fetch failed");
});

type TableName = "conversations" | "conversation_messages";

class FlakyDatabase implements SupabaseDataClient {
  readonly tables: Record<TableName, SupabaseRow[]> = { conversations: [], conversation_messages: [] };
  /** Transport failures injected before the next insert on that table succeeds. */
  failuresBeforeSuccess = new Map<string, number>();
  /** A database rejection returned by every insert on that table. */
  insertErrors = new Map<string, SupabaseQueryResult["error"]>();
  /** Transport failures injected before the next read on that table succeeds. */
  readFailures = new Map<string, number>();
  private nextId = 1;
  from(table: string): SupabaseQuery { return new FlakyQuery(this, table as TableName); }

  takeInsertFailure(table: string): SupabaseQueryResult | null {
    const remaining = this.failuresBeforeSuccess.get(table) ?? 0;
    if (remaining <= 0) return null;
    this.failuresBeforeSuccess.set(table, remaining - 1);
    return { data: null, error: TRANSPORT_ERROR };
  }

  takeReadFailure(table: string): SupabaseQueryResult | null {
    const remaining = this.readFailures.get(table) ?? 0;
    if (remaining <= 0) return null;
    this.readFailures.set(table, remaining - 1);
    return { data: null, error: TRANSPORT_ERROR };
  }

  insert(table: TableName, values: SupabaseRow | SupabaseRow[]): SupabaseRow[] {
    const inserted = (Array.isArray(values) ? values : [values]).map((value) => ({ id: String(this.nextId++), ...value }));
    this.tables[table].push(...inserted);
    return inserted;
  }
}

class FlakyQuery implements SupabaseQuery {
  private readonly db: FlakyDatabase;
  private readonly table: TableName;
  private operation: "select" | "insert" | "update" = "select";
  private values: SupabaseRow | SupabaseRow[] = {};
  private filters: [string, unknown][] = [];
  private count: number | null = null;
  private singleRow = false;
  constructor(db: FlakyDatabase, table: TableName) { this.db = db; this.table = table; }
  select(): SupabaseQuery { this.operation = this.operation === "select" ? "select" : this.operation; return this; }
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { this.operation = "insert"; this.values = values; return this; }
  update(values: SupabaseRow): SupabaseQuery { this.operation = "update"; this.values = values; return this; }
  upsert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { this.insert(values); return this; }
  eq(column: string, value: unknown): SupabaseQuery { this.filters.push([column, value]); return this; }
  ilike(): SupabaseQuery { return this; }
  is(column: string, value: null | boolean): SupabaseQuery { this.filters.push([column, value ?? null]); return this; }
  order(): SupabaseQuery { return this; }
  limit(count: number): SupabaseQuery { this.count = count; return this; }
  single(): PromiseLike<SupabaseQueryResult> { this.singleRow = true; return Promise.resolve(this.execute()); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { this.singleRow = true; return Promise.resolve(this.execute()); }
  then<T1 = SupabaseQueryResult, T2 = never>(onfulfilled?: ((value: SupabaseQueryResult) => T1 | PromiseLike<T1>) | null, onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
  private execute(): SupabaseQueryResult {
    if (this.operation === "insert") {
      const failed = this.db.takeInsertFailure(this.table);
      if (failed) return failed;
      const rejected = this.db.insertErrors.get(this.table);
      if (rejected) return { data: null, error: rejected };
      const inserted = this.db.insert(this.table, this.values);
      return { data: this.singleRow ? inserted[0] ?? null : inserted, error: null };
    }
    let rows = this.db.tables[this.table].filter((row) => this.filters.every(([key, value]) => String(row[key] ?? "") === String(value ?? "")));
    if (this.operation === "select") {
      const failed = this.db.takeReadFailure(this.table);
      if (failed) return failed;
    }
    if (this.operation === "update") {
      for (const row of rows) Object.assign(row, this.values as SupabaseRow);
      return { data: this.singleRow ? rows[0] ?? null : rows, error: null };
    }
    if (this.count !== null) rows = rows.slice(0, this.count);
    return { data: this.singleRow ? rows[0] ?? null : rows, error: null };
  }
}

function turn(conversationId: string) {
  return {
    id: conversationId, state: "answer_found" as const, pendingPermission: null, lastAction: "answer" as const,
    lastRequest: null, lastResolution: null, transitions: [], updatedAt: "2026-10-01T00:00:00.000Z",
    messages: [
      { id: "in-1", conversationId, channel: "whatsapp" as const, direction: "inbound" as const, sender: "user" as const, text: "Find me a restaurant in Chiredzi", createdAt: "2026-10-01T00:00:00.000Z", providerMessageId: "wamid.1" },
      { id: "out-1", conversationId, channel: "whatsapp" as const, direction: "outbound" as const, sender: "system" as const, text: "TrustHub lists Creamy Inn Zimbabwe.", createdAt: "2026-10-01T00:00:00.000Z" },
    ],
  };
}

test("a transport failure on the first message append is retried instead of failing the turn", async () => {
  const database = new FlakyDatabase();
  database.failuresBeforeSuccess.set("conversation_messages", 1);
  const repository = new SupabaseRuntimeConversationRepository(createResilientDataClient(database));
  await repository.save(turn("7"));
  const rows = database.tables.conversation_messages;
  assert.equal(rows.length, 2, "both messages are appended once each");
  assert.deepEqual(rows.map((row) => row.content), ["Find me a restaurant in Chiredzi", "TrustHub lists Creamy Inn Zimbabwe."]);
  assert.equal(database.tables.conversations.length, 0);
});

test("an outbound message whose response was lost is not appended twice", async () => {
  const database = new FlakyDatabase();
  const repository = new SupabaseRuntimeConversationRepository(createResilientDataClient(database));
  // The first attempt commits in the database but its response is lost: the
  // repository must read the stored rows back instead of inserting again.
  const originalInsert = database.insert.bind(database);
  let lostResponses = 1;
  database.insert = (table, values) => {
    const rows = originalInsert(table, values);
    if (table === "conversation_messages" && lostResponses > 0) {
      lostResponses -= 1;
      database.failuresBeforeSuccess.set("conversation_messages", 1);
    }
    return rows;
  };
  await repository.save(turn("8"));
  assert.equal(database.tables.conversation_messages.filter((row) => String((row.metadata as SupabaseRow | undefined)?.runtime_local_id ?? "") === "out-1").length, 1);
  assert.equal(database.tables.conversation_messages.filter((row) => String((row.metadata as SupabaseRow | undefined)?.runtime_local_id ?? "") === "in-1").length, 1);
});

test("a database rejection during an append still fails loudly with its cause", async () => {
  const database = new FlakyDatabase();
  database.insertErrors.set("conversation_messages", { message: "new row for relation \"conversation_messages\" violates check constraint", code: "23514" });
  await assert.rejects(
    () => new SupabaseRuntimeConversationRepository(createResilientDataClient(database)).save(turn("9")),
    (error: unknown) => error instanceof SupabasePersistenceError
      && /Append conversation message: .*\[database code 23514\]/.test((error as Error).message),
  );
  assert.equal(database.tables.conversation_messages.length, 0);
});

/**
 * Mirrors how @supabase/postgrest-js behaves: `single()`/`maybeSingle()` mark
 * the builder and only the marker turns a row list into a single row.
 */
class MarkerQuery implements SupabaseQuery {
  private readonly rows: SupabaseRow[];
  private maybeSingleRow = false;
  private singleRow = false;
  constructor(rows: SupabaseRow[]) { this.rows = rows; }
  select(): SupabaseQuery { return this; }
  insert(): SupabaseQuery { return this; }
  update(): SupabaseQuery { return this; }
  upsert(): SupabaseQuery { return this; }
  eq(): SupabaseQuery { return this; }
  ilike(): SupabaseQuery { return this; }
  is(): SupabaseQuery { return this; }
  order(): SupabaseQuery { return this; }
  limit(): SupabaseQuery { return this; }
  single(): SupabaseQuery { this.singleRow = true; return this; }
  maybeSingle(): SupabaseQuery { this.maybeSingleRow = true; return this; }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    const data = this.singleRow || this.maybeSingleRow ? (this.rows[0] ?? null) : this.rows;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

test("single and maybeSingle row shapes survive the resilient wrapper", async () => {
  const rows: SupabaseRow[] = [{ id: 14, phone_number: "+263771000101", profile_id: 106 }];
  const client = createResilientDataClient({ from: () => new MarkerQuery(rows) });
  const one = await client.from("whatsapp_identities").select("id").eq("phone_number", "+263771000101").maybeSingle();
  assert.deepEqual(one.data, rows[0], "maybeSingle must return one row, not a list");
  const single = await client.from("whatsapp_identities").select("id").eq("phone_number", "+263771000101").single();
  assert.deepEqual(single.data, rows[0]);
  const empty = createResilientDataClient({ from: () => new MarkerQuery([]) });
  assert.equal((await empty.from("whatsapp_identities").select("id").eq("id", "1").maybeSingle()).data, null);
  const list = await client.from("whatsapp_identities").select("id").eq("phone_number", "+263771000101");
  assert.deepEqual(list.data, rows, "a plain read still returns every row");
});

test("the resilient client repeats guarded writes but never an unguarded one", async () => {
  const database = new FlakyDatabase();
  const client = createResilientDataClient(database);
  database.failuresBeforeSuccess.set("conversation_messages", 1);
  await client.from("conversation_messages").insert({ conversation_id: "1", provider_message_id: "wamid.guard" });
  assert.equal(database.tables.conversation_messages.length, 1, "a provider-guarded insert survives a transport failure");

  const unguarded = new FlakyDatabase();
  unguarded.failuresBeforeSuccess.set("conversation_messages", 1);
  const result = await createResilientDataClient(unguarded).from("conversation_messages").insert({ conversation_id: "1", content: "no unique guard" });
  assert.equal(result.error?.message, "TypeError: fetch failed");
  assert.equal(unguarded.tables.conversation_messages.length, 0, "an unguarded insert is never sent twice");
});

test("a resilient select survives a transport failure and reports a database error unchanged", async () => {
  const database = new FlakyDatabase();
  const client = createResilientDataClient(database);
  database.tables.conversations.push({ id: "5", status: "open" });
  database.readFailures.set("conversations", 2);
  const rows = await client.from("conversations").select("id").eq("status", "open");
  assert.deepEqual(rows.data, [{ id: "5", status: "open" }]);

  database.readFailures.set("conversations", 5);
  const exhausted = await client.from("conversations").select("id").eq("status", "open");
  assert.equal(exhausted.error?.message, "TypeError: fetch failed", "an exhausted select still reports the transport failure");
});
