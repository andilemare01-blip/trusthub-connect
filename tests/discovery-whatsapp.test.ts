import assert from "node:assert/strict";
import test from "node:test";
import { TrustHubDiscoveryService, TrustHubBusinessDiscoverySource, KnowledgeRecordDiscoverySource, type DiscoveryRecord } from "../lib/discovery/service.ts";
import { createFakeWhatsAppProvider } from "../lib/whatsapp/fake-provider.ts";
import { runLocalWhatsAppTurn } from "../lib/whatsapp/local-harness.ts";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

const request: NormalizedRequest = { text: "Find a plumber in Bulawayo", intent: "find_provider", category: "plumber", location: { country: "Zimbabwe", city: "Bulawayo" }, questionType: "provider_recommendation" };
const rec = (id: string, city: string, sourceRecordId = id): DiscoveryRecord => ({ id, source: "trusthub", sourceLabel: "Knowledge record", sourceRecordId, name: id, category: "plumber", city, area: null, contact: null, summary: null, verificationStatus: "declared", confidence: "low", provenance: ["knowledge_records", "community"], completeness: "partial" });

class Q implements SupabaseReadQuery {
  filters: [string, string][] = [];
  private rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[]) { this.rows = rows; }
  select() { return this; } ilike(c: string, v: string) { this.filters.push([c, v.replace(/%/g, "").toLocaleLowerCase()]); return this; }
  eq() { return this; } limit() { return this; } or() { return this; }
  then<TResult1 = SupabaseReadResponse, TResult2 = never>(ok?: ((v: SupabaseReadResponse) => TResult1 | PromiseLike<TResult1>) | null, bad?: ((e: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows.filter((row) => this.filters.every(([col, val]) => String(row[col] ?? "").toLocaleLowerCase() === val)), error: null }).then(ok, bad);
  }
}
class Client implements SupabaseReadClient {
  private rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[]) { this.rows = rows; }
  from() { return new Q(this.rows); }
}
const business = { id: "biz-byo", name: "Bulawayo Plumbers", category: "plumber", subcategory: null, province: null, country: "Zimbabwe", city: "Bulawayo", area: "CBD", address: null, phone: "+263770000001", website: null, latitude: null, longitude: null, source: "manual", sourceId: "upstream-7", trustScore: null, reviewsCount: null, businessVerified: true, ownerClaimed: null, createdAt: null };

test("discovery keeps businesses and knowledge records independent with exact-city filtering and provenance", async () => {
  const trust = new SupabaseTrustHubClient(new Client([{ ...business, source_id: "upstream-7" }]));
  const knowledge = new KnowledgeRecordDiscoverySource({ async searchDiscoverable() { return [rec("knowledge-1", "Bulawayo"), rec("wrong-city", "Harare")]; } });
  const result = await new TrustHubDiscoveryService([new TrustHubBusinessDiscoverySource(trust), knowledge]).search(request);
  assert.deepEqual(result.records.map((item) => item.id), ["business:biz-byo", "knowledge-1"]);
  assert.equal(result.records[0].sourceRecordId, "biz-byo");
  assert.ok(result.records[0].provenance.includes("upstream_id:upstream-7"));
  assert.equal(result.records[1].verificationStatus, "declared");
  assert.equal(result.records[1].completeness, "partial");
});

test("fake WhatsApp transport runs a turn through coordinator, resolver and TrustHub source then returns delivery metadata", async () => {
  const fake = createFakeWhatsAppProvider(() => "2026-09-28T00:00:00.000Z");
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient(new Client([{ ...business, source_id: "upstream-7" }])), now: () => "2026-09-28T00:00:00.000Z" });
  const flow = await runLocalWhatsAppTurn(fake, { providerMessageId: "local-inbound-1", senderPhoneNumber: "+263771234567", text: request.text, timestamp: "2026-09-28T00:00:00.000Z" }, async (incoming) => {
    const result = await runtime.handleTurn({ conversationId: "local-wa-conversation", channel: "whatsapp", providerMessageId: incoming.providerMessageId, text: incoming.text, request });
    return { reply: result.reply, result };
  });
  assert.equal(flow?.result.resolution?.evidence[0].sourceRecordId, "biz-byo");
  assert.equal(flow?.incoming.senderPhoneNumber, "+263771234567");
  assert.equal(flow?.delivery?.status, "accepted");
  assert.equal(fake.delivered.length, 1);
});

test("WhatsApp runtime can surface an approved knowledge-record result with record provenance", async () => {
  const knowledgeRecord = { ...rec("knowledge-byo-plumber", "Bulawayo"), recordType: "business", phone: "+263771112222", whatsapp: null, website: null, address: "CBD", serviceTags: ["plumbing"], openingHours: null, sourceMetadata: { name: "TrustHub", reuse_status: "approved" }, confidenceValue: 0.62 };
  const runtime = createConversationRuntime({
    trustHubClient: new SupabaseTrustHubClient(new Client([])),
    knowledgeRecordReader: { async searchDiscoverable() { return [knowledgeRecord]; } },
  });
  const result = await runtime.handleTurn({ conversationId: "knowledge-wa", channel: "whatsapp", text: request.text, request });
  assert.ok(result.resolution?.evidence.some((item) => item.sourceRecordId === "knowledge-byo-plumber"));
  assert.match(result.reply, /Phone: \+263771112222/);
  assert.match(result.reply, /shared by the community, not verified yet/);
});

test("fake WhatsApp provider models parse and delivery failures without claiming acceptance", async () => {
  const parseFailure = createFakeWhatsAppProvider(undefined, { parseError: new Error("malformed payload") });
  await assert.rejects(parseFailure.parseIncomingWebhook({}), /malformed payload/);

  const sendFailure = createFakeWhatsAppProvider(undefined, { sendError: new Error("provider unavailable") });
  await assert.rejects(sendFailure.sendMessage({ toPhoneNumber: "+263771234567", text: "reply" }), /provider unavailable/);
  assert.equal(sendFailure.delivered.length, 0);
});
