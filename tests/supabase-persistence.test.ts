import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRuntimeConversationRepository } from "../lib/conversation-coordinator/supabase-repository.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

type TableName = "conversations" | "conversation_messages";

class MemoryDatabase implements SupabaseDataClient {
  readonly tables: Record<TableName, SupabaseRow[]> = { conversations: [], conversation_messages: [] };
  private nextId = 1;
  from(table: string): SupabaseQuery { return new MemoryQuery(this, table as TableName); }
  insert(table: TableName, values: SupabaseRow | SupabaseRow[]): SupabaseRow[] {
    const inserted = (Array.isArray(values) ? values : [values]).map((value) => ({ id: String(this.nextId++), ...value }));
    this.tables[table].push(...inserted);
    return inserted;
  }
}

class MemoryQuery implements SupabaseQuery {
  private readonly db: MemoryDatabase;
  private readonly table: TableName;
  private operation: "select" | "insert" | "update" = "select";
  private values: SupabaseRow | SupabaseRow[] = {};
  private filters: [string, unknown][] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private count: number | null = null;
  constructor(db: MemoryDatabase, table: TableName) { this.db = db; this.table = table; }
  select(): SupabaseQuery { return this; }
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { this.operation = "insert"; this.values = values; return this; }
  update(values: SupabaseRow): SupabaseQuery { this.operation = "update"; this.values = values; return this; }
  upsert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { return this.insert(values); }
  eq(column: string, value: unknown): SupabaseQuery { this.filters.push([column, value]); return this; }
  ilike(): SupabaseQuery { return this; }
  is(column: string, value: null | boolean): SupabaseQuery { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery { this.sort = { column, ascending: options?.ascending ?? true }; return this; }
  limit(count: number): SupabaseQuery { this.count = count; return this; }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.execute(true)); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve(this.execute(true)); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected); }
  private execute(single: boolean): SupabaseQueryResult {
    if (this.operation === "insert") {
      const data = this.db.insert(this.table, this.values);
      return { data: single ? data[0] ?? null : data, error: null };
    }
    let rows = this.db.tables[this.table].filter((row) => this.filters.every(([key, value]) => String(row[key] ?? "") === String(value ?? "")));
    if (this.operation === "update") {
      for (const row of rows) Object.assign(row, this.values as SupabaseRow);
      return { data: rows, error: null };
    }
    if (this.sort) rows = [...rows].sort((a, b) => String(a[this.sort!.column] ?? "").localeCompare(String(b[this.sort!.column] ?? "")) * (this.sort!.ascending ? 1 : -1));
    if (this.count !== null) rows = rows.slice(0, this.count);
    return { data: single ? rows[0] ?? null : rows, error: null };
  }
}

test("persistent conversation repository restores messages, request state, provenance and location after restart", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseRuntimeConversationRepository(database);
  const id = await repository.createConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", area: "Avondale" });
  await repository.save({
    id, state: "answer_uncertain", pendingPermission: "community", lastAction: "ask_community_permission", updatedAt: "2026-09-29T08:00:00.000Z",
    lastRequest: { text: "Find a plumber in Harare", intent: "find_provider", category: "plumber", location: { country: "Zimbabwe", city: "Harare", area: "Avondale" }, questionType: "provider_recommendation" },
    lastResolution: { status: "partially_answered", confidence: "medium", evidence: [{ sourceRecordId: "business-17", verificationStatus: "observed", confidence: "medium" }] } as never,
    transitions: [{ from: "ready_for_request", to: "answer_uncertain", at: "2026-09-29T08:00:00.000Z", reason: "ask_community_permission" }],
    messages: [
      { id: "in-1", conversationId: id, channel: "whatsapp", direction: "inbound", sender: "user", text: "Find a plumber in Harare", createdAt: "2026-09-29T08:00:00.000Z", providerMessageId: "wamid.1", metadata: { whatsappMedia: [{ providerMediaId: "media-1", kind: "voice", mimeType: "audio/ogg" }] } },
      { id: "out-1", conversationId: id, channel: "whatsapp", direction: "outbound", sender: "system", text: "Would you like me to ask your community?", createdAt: "2026-09-29T08:00:01.000Z" },
    ],
  });

  const restored = await new SupabaseRuntimeConversationRepository(database).get(id);
  assert.equal(restored?.state, "answer_uncertain");
  assert.equal(restored?.pendingPermission, "community");
  assert.equal(restored?.lastRequest?.location?.city, "Harare");
  assert.equal(restored?.lastResolution?.evidence[0].sourceRecordId, "business-17");
  assert.equal(restored?.messages[0].providerMessageId, "wamid.1");
  assert.deepEqual(restored?.messages[0].metadata?.whatsappMedia, [{ providerMediaId: "media-1", kind: "voice", mimeType: "audio/ogg" }]);
  assert.equal(restored?.persistence?.communityId, "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b");
  assert.equal(restored?.persistence?.area, "Avondale");
  assert.deepEqual(restored?.transitions[0], { from: "ready_for_request", to: "answer_uncertain", at: "2026-09-29T08:00:00.000Z", reason: "ask_community_permission" });
});

test("open WhatsApp sessions are scoped to the resolved community", async () => {
  const database = new MemoryDatabase();
  const repository = new SupabaseRuntimeConversationRepository(database);
  const first = await repository.createConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", area: null });
  const second = await repository.createConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: "30465036-75a7-497d-99a7-158edb099108", area: null });
  database.tables.conversations[0].last_message_at = "2026-09-29T08:00:00.000Z";
  database.tables.conversations[1].last_message_at = "2026-09-29T08:01:00.000Z";
  assert.equal(await repository.findOrStartConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: "30465036-75a7-497d-99a7-158edb099108", area: null }), second);
  assert.equal(await repository.findOrStartConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", area: null }), first);
  assert.equal(await repository.findOrStartConversation({ channel: "whatsapp", whatsappIdentityId: "22", profileId: "34", communityId: null, area: null, reuseLatestOpenConversation: true }), second);
});

test("the assigned assistant name survives a database reload and is reused on every later turn", async () => {
  const { ConversationCoordinator } = await import("../lib/conversation-coordinator/coordinator.ts");
  const { PolicyAnswerResolver } = await import("../lib/answer-resolution/resolver.ts");
  const { WisdomLibrary } = await import("../lib/conversation-coordinator/wisdom-library.ts");
  const database = new MemoryDatabase();
  const id = await new SupabaseRuntimeConversationRepository(database).createConversation({ channel: "whatsapp", whatsappIdentityId: "7", profileId: null, communityId: null, area: null });
  const names: (string | undefined)[] = [];
  for (const [index, text] of ["Hi", "Hello", "Hey there"].entries()) {
    const coordinator = new ConversationCoordinator(new SupabaseRuntimeConversationRepository(database), new PolicyAnswerResolver({}), () => "2026-01-01T00:00:00.000Z", undefined, WisdomLibrary.load());
    names.push((await coordinator.handleTurn({ conversationId: id, channel: "whatsapp", text, providerMessageId: `wamid.name-${index}` })).conversation.assistantName);
  }
  assert.ok(names[0]);
  assert.deepEqual(names, [names[0], names[0], names[0]]);
  assert.equal((await new SupabaseRuntimeConversationRepository(database).get(id))?.assistantName, names[0]);
});
