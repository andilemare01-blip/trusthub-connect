import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseIdentityResolver } from "../lib/identity/supabase-repository.ts";
import { SupabaseRuntimeConversationRepository } from "../lib/conversation-coordinator/supabase-repository.ts";
import { ConversationCoordinator } from "../lib/conversation-coordinator/coordinator.ts";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import { WisdomLibrary } from "../lib/conversation-coordinator/wisdom-library.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import type { AnswerSource, EvidenceItem } from "../lib/answer-resolution/types.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

/** Small multi-table fake with the unique phone constraint the real whatsapp_identities table has. */
class Database implements SupabaseDataClient {
  readonly tables: Record<string, SupabaseRow[]> = { whatsapp_identities: [], profiles: [{ id: 42, user_id: "u", name: "Real Person" }], conversations: [], conversation_messages: [] };
  private nextId = 1;
  from(name: string): SupabaseQuery {
    const rows = this.tables[name];
    let operation: "select" | "insert" | "update" = "select";
    let values: SupabaseRow = {};
    const filters: [string, unknown][] = [];
    let max = Infinity;
    const run = (single: boolean): SupabaseQueryResult => {
      if (operation === "insert") {
        if (name === "whatsapp_identities" && rows.some((row) => row.phone_number === values.phone_number)) return { data: null, error: { message: 'duplicate key value violates unique constraint "whatsapp_identities_phone_number_key"', code: "23505" } };
        const row = { id: this.nextId++, created_at: "2026-01-01T00:00:00Z", status: "open", profile_id: null, linked_at: null, community_id: null, last_message_at: "2026-01-01T00:00:00Z", ...values };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const matching = rows.filter((row) => filters.every(([key, value]) => (row[key] ?? null) === value || String(row[key]) === String(value)));
      if (operation === "update") { for (const row of matching) Object.assign(row, values); return { data: single ? matching[0] ?? null : matching, error: null }; }
      const limited = matching.slice(0, max);
      return { data: single ? limited[0] ?? null : limited, error: null };
    };
    const query: SupabaseQuery = {
      select: () => query,
      insert: (v) => { operation = "insert"; values = v as SupabaseRow; return query; },
      update: (v) => { operation = "update"; values = v; return query; },
      upsert: () => query, ilike: () => query, order: () => query,
      eq: (column, value) => { filters.push([column, value]); return query; },
      is: (column, value) => { filters.push([column, value]); return query; },
      limit: (count) => { max = count; return query; },
      single: () => Promise.resolve(run(true)), maybeSingle: () => Promise.resolve(run(true)),
      then: (ok, bad) => Promise.resolve(run(false)).then(ok, bad),
    };
    return query;
  }
}

const evidence = { id: "e1", claim: "TrustHub lists Safe Roads Driving School in Harare.", source: "trusthub", sourceLabel: "TrustHub business record", verificationStatus: "observed", confidence: "medium", retrievedAt: "2026-01-01T00:00:00.000Z", sourceRecordId: "b1" } as EvidenceItem;

test("an unknown sender gets a phone-only identity: no profile is invented and nothing is verified", async () => {
  const db = new Database();
  const resolver = new SupabaseIdentityResolver(db);
  assert.equal((await resolver.resolveByPhoneNumber("+263771000001")).whatsAppIdentity, null);
  const created = await resolver.ensureWhatsAppIdentity("+263 77 100 0001");
  assert.equal(created.trustHubProfileId, null);
  assert.equal(created.linkedAt, null);
  assert.equal((await resolver.ensureWhatsAppIdentity("+263771000001")).id, created.id);
  assert.equal(db.tables.whatsapp_identities.length, 1);
  const again = await resolver.resolveByPhoneNumber("+263771000001");
  assert.equal(again.status, "unresolved");
  assert.equal(again.profile, null);
  assert.equal(db.tables.profiles.length, 1);
});

test("a later profile link completes the same identity row instead of failing or duplicating it", async () => {
  const db = new Database();
  const resolver = new SupabaseIdentityResolver(db);
  const guest = await resolver.ensureWhatsAppIdentity("+263771000002");
  const linked = await resolver.linkPhoneToExistingProfile("+263771000002", "42");
  assert.equal(linked.id, guest.id);
  assert.equal(linked.trustHubProfileId, "42");
  assert.equal(db.tables.whatsapp_identities.length, 1);
  await assert.rejects(resolver.linkPhoneToExistingProfile("+263771000002", "43"), /already linked to a different/);
});

test("2. a returning sender continues the same conversation, and different senders stay separate", async () => {
  const db = new Database();
  const resolver = new SupabaseIdentityResolver(db);
  const repository = new SupabaseRuntimeConversationRepository(db);
  const a = await resolver.ensureWhatsAppIdentity("+263771000003");
  const b = await resolver.ensureWhatsAppIdentity("+263771000004");
  const context = (id: string) => ({ channel: "whatsapp" as const, whatsappIdentityId: id, profileId: null, communityId: null, area: null, reuseLatestOpenConversation: true });
  const first = await repository.findOrStartConversation(context(a.id));
  assert.equal(await new SupabaseRuntimeConversationRepository(db).findOrStartConversation(context(a.id)), first);
  assert.notEqual(await repository.findOrStartConversation(context(b.id)), first);
  assert.equal(db.tables.conversations.length, 2);
});

test("2b. the failure being fixed: without an identity row every message started a new conversation", async () => {
  const db = new Database();
  const repository = new SupabaseRuntimeConversationRepository(db);
  const noIdentity = { channel: "whatsapp" as const, whatsappIdentityId: null, profileId: null, communityId: null, area: null, reuseLatestOpenConversation: true };
  assert.notEqual(await repository.findOrStartConversation(noIdentity), await repository.findOrStartConversation(noIdentity));
});

test("end to end over persistence: Harare, then a driving school, continues across reloads with the name and task intact", async () => {
  const db = new Database();
  const resolver = new SupabaseIdentityResolver(db);
  const identity = await resolver.ensureWhatsAppIdentity("+263771000005");
  const trusthub: AnswerSource = { async search() { return { matchStatus: "matched", evidence: [evidence] }; } };
  const library = WisdomLibrary.load();
  const turn = async (text: string, n: number) => {
    const repository = new SupabaseRuntimeConversationRepository(db);
    const id = await repository.findOrStartConversation({ channel: "whatsapp", whatsappIdentityId: identity.id, profileId: null, communityId: null, area: null, reuseLatestOpenConversation: true });
    const coordinator = new ConversationCoordinator(repository, new PolicyAnswerResolver({ trusthub }), () => "2026-01-01T00:00:00.000Z", undefined, library, async (city) => city.toLowerCase() === "harare");
    const understanding = await new DeterministicUnderstandingProvider().understand(text);
    return coordinator.handleTurn({ conversationId: id, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `wamid.e2e-${n}` });
  };
  const hi = await turn("Hi", 0);
  assert.match(hi.reply, /TRUSTHUB CONNECT/);
  const place = await turn("Harare", 1);
  assert.equal(place.state, "clarification_needed");
  const category = await turn("a driving school", 2);
  assert.equal(category.state, "answer_found");
  assert.equal(category.conversation.lastRequest?.location?.city, "Harare");
  assert.equal(category.conversation.assistantName, hi.conversation.assistantName);
  assert.equal(category.completedTask?.taskId, `${category.conversationId}:1`);
  assert.equal(db.tables.conversations.length, 1);
  const replay = await turn("a driving school", 2);
  assert.equal(replay.completedTask, undefined);
  assert.equal(db.tables.conversation_messages.filter((row) => row.provider_message_id === "wamid.e2e-2").length, 1);
});
