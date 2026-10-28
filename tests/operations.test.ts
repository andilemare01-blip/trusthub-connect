import assert from "node:assert/strict";
import test from "node:test";
import { classifyUnusableMetaEvent, parseMetaWhatsAppWebhook } from "../lib/whatsapp/meta-webhook.ts";
import { describeVerification, formatListing, formatListings } from "../lib/answer-resolution/whatsapp-format.ts";
import { dedupeListings } from "../lib/answer-resolution/knowledge-source.ts";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import { TrustHubBusinessAnswerSource } from "../lib/answer-resolution/trusthub-source.ts";
import { createAnswerGenerator } from "../lib/answer-resolution/response-generator.ts";
import { SupabaseTrustHubClient } from "../lib/trusthub/supabase-read-adapter.ts";
import { createConversationRuntime } from "../lib/conversation-coordinator/runtime.ts";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import { authorizeAdminRequest, type AdminAuthClient } from "../lib/admin/authorization.ts";
import { buildDashboard, localDayStart, parseRange, resolveRange, latestPreferences, type DashboardInput } from "../lib/admin/metrics.ts";
import { HARD_MAX_PER_DAY, checkEligibility, chooseMission, missionDedupeKey, missionPolicy, parseNotificationPreference, policyFromEnvironment, preferenceReply } from "../lib/notifications/community-missions.ts";
import { runCommunityMissions, type MissionCandidate, type MissionDeps } from "../lib/notifications/mission-runner.ts";
import { recordOperationalEvent } from "../lib/observability/operational-events.ts";
import type { EvidenceItem, ResolutionResult } from "../lib/answer-resolution/types.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";
import type { SupabaseReadClient, SupabaseReadQuery, SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

// ---- Webhook: why events are skipped --------------------------------------------------------------------------
const wrap = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value }] }] });

test("a delivery receipt is classified as a status update, not a lost message", async () => {
  const payload = wrap({ statuses: [{ id: "wamid.1", status: "delivered", recipient_id: "263771234567" }, { id: "wamid.1", status: "read" }] });
  assert.equal(await parseMetaWhatsAppWebhook(payload), null);
  assert.deepEqual(classifyUnusableMetaEvent(payload), { kind: "status_update", statuses: 2, messages: 0 });
});

test("a message that arrived but cannot be read is classified with a reason code and no content", () => {
  assert.deepEqual(classifyUnusableMetaEvent(wrap({ messages: [{ id: "wamid.2", from: "263771234567", type: "text", text: { body: "secret words" } }] })), { kind: "unusable_message", statuses: 0, messages: 1, reason: "missing_contacts" });
  const badSender = classifyUnusableMetaEvent(wrap({ contacts: [{}], messages: [{ id: "wamid.3", from: "12", type: "text" }] }));
  assert.equal(badSender.kind, "unusable_message");
  assert.equal(badSender.reason, "invalid_sender");
  assert.equal(classifyUnusableMetaEvent(wrap({ contacts: [{}], messages: [{ from: "263771234567" }] })).reason, "missing_id");
  assert.doesNotMatch(JSON.stringify(badSender), /secret|263/);
  assert.equal(classifyUnusableMetaEvent({ nothing: true }).kind, "malformed");
  assert.equal(classifyUnusableMetaEvent(null).kind, "malformed");
  assert.equal(classifyUnusableMetaEvent(wrap({})).kind, "no_content");
});

// ---- Structured, honest results ------------------------------------------------------------------------------------
const listing = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "trusthub-business:1", claim: "TrustHub lists Safe Roads Driving School.", source: "trusthub", sourceLabel: "TrustHub businesses record", verificationStatus: "observed", confidence: "high",
  retrievedAt: "2026-01-01T00:00:00.000Z", sourceRecordId: "1", kind: "listing", name: "Safe Roads Driving School", category: "Driving school",
  businessDetails: { phone: "+263 77 123 4567", address: "12 Samora Machel Ave", city: "Harare", area: "Avondale", website: "https://saferoads.example", openingHours: { monday: "08:00-17:00", tuesday: "08:00-17:00" } }, ...overrides,
});

test("a listing card shows only the fields that exist, with honest source and status wording", () => {
  const full = formatListing(listing(), 1);
  assert.match(full, /^1\. \*Safe Roads Driving School\*/);
  assert.match(full, /Driving school · Avondale, Harare/);
  assert.match(full, /Phone: \+263 77 123 4567/);
  assert.match(full, /Address: 12 Samora Machel Ave/);
  assert.match(full, /Website: https:\/\/saferoads\.example/);
  assert.match(full, /Hours: Mon 08:00-17:00, Tue 08:00-17:00/);
  assert.match(full, /Source: TrustHub businesses record; listed in TrustHub records, not independently verified/);
  const sparse = formatListing(listing({ businessDetails: { city: "Harare" }, category: null }));
  assert.doesNotMatch(sparse, /Phone|Address|Website|Hours/);
  assert.doesNotMatch(sparse, /undefined|null/);
});

test("every recorded status has its own wording and none upgrades itself to verified", () => {
  const wording = (["observed", "declared", "inferred", "potential", "unknown"] as const).map((status) => describeVerification({ verificationStatus: status }));
  assert.equal(new Set(wording).size, 5);
  for (const text of wording) assert.doesNotMatch(text, /^verified/);
  assert.equal(describeVerification({ verificationStatus: "verified" }), "verified by TrustHub");
  assert.doesNotMatch(formatListing(listing({ confidence: "high", confidenceValue: 0.99 })), /verified by TrustHub/);
});

test("many results are numbered and capped with an invitation to narrow", () => {
  const items = Array.from({ length: 11 }, (_, index) => listing({ id: `b${index}`, name: `Driving School ${index}` }));
  const text = formatListings(items);
  assert.match(text, /^1\. \*Driving School 0\*/);
  assert.match(text, /8\. \*Driving School 7\*/);
  assert.doesNotMatch(text, /9\. \*/);
  assert.match(text, /3 more; tell me an area/);
});

test("a business present in both businesses and knowledge records is shown once, keeping its own status and gaining missing contact details", () => {
  const business = listing({ businessDetails: { city: "Harare", phone: null } as never });
  const knowledge = listing({ id: "knowledge:9", sourceLabel: "TrustHub knowledge record", verificationStatus: "potential", sourceRecordId: "9", name: "SAFE ROADS driving school", businessDetails: { city: "Harare", phone: "+263771000000", whatsapp: "+263771000001" } });
  const merged = dedupeListings([business, knowledge, listing({ id: "x", name: "Another School", sourceRecordId: "x" })]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].sourceLabel, "TrustHub businesses record");
  assert.equal(merged[0].verificationStatus, "observed");
  assert.equal(merged[0].businessDetails?.phone, "+263771000000");
  assert.ok(merged[0].provenanceDetails?.some((entry) => entry.startsWith("also_listed_in:TrustHub knowledge record:9")));
  assert.equal(dedupeListings([listing(), listing({ businessDetails: { city: "Bulawayo" } })]).length, 2);
});

type Row = Record<string, unknown>;
const row = (id: string, name: string, extra: Row = {}): Row => ({ id, name, category: null, subcategory: null, province: null, country: "Zimbabwe", city: "Harare", area: "Avondale", address: "12 Samora Machel Ave", phone: "+263 77 123 4567", website: null, latitude: null, longitude: null, source: "import", source_id: id, trust_score: 5, reviews_count: 9, opening_hours: null, description: null, created_at: "2026-01-01T00:00:00Z", ...extra });
class ReadQuery implements SupabaseReadQuery {
  private readonly rows: Row[]; private readonly filters: ((r: Row) => boolean)[] = [];
  constructor(rows: Row[]) { this.rows = rows; }
  select() { return this; } limit() { return this; }
  eq(column: string, value: string) { this.filters.push((r) => String(r[column] ?? "") === value); return this; }
  ilike(column: string, value: string) { const wanted = value.replace(/\\([\\%_])/g, "$1").toLocaleLowerCase(); this.filters.push((r) => String(r[column] ?? "").toLocaleLowerCase() === wanted); return this; }
  or(filters: string) { const clauses = filters.split(",").map((c) => { const [, column, pattern] = /^(\w+)\.ilike\.(.*)$/.exec(c)!; return { column, regex: new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i") }; }); this.filters.push((r) => clauses.some(({ column, regex }) => regex.test(String(r[column] ?? "")))); return this; }
  then<T1 = SupabaseReadResponse, T2 = never>(ok?: ((v: SupabaseReadResponse) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> { return Promise.resolve({ data: this.rows.filter((r) => this.filters.every((f) => f(r))), error: null }).then(ok, bad); }
}
class ReadClient implements SupabaseReadClient {
  private readonly businesses: Row[];
  constructor(businesses: Row[]) { this.businesses = businesses; }
  from(table: "businesses" | "communities") { return new ReadQuery(table === "businesses" ? this.businesses : [{ id: "c1", name: "Harare", city: "Harare", country: "Zimbabwe", description: null, latitude: null, longitude: null, created_at: "2026-01-01T00:00:00Z" }]); }
}
const chat = (rows: Row[], profileLinked?: boolean) => {
  const runtime = createConversationRuntime({ trustHubClient: new SupabaseTrustHubClient(new ReadClient(rows)), now: () => "2026-01-01T00:00:00.000Z" });
  let n = 0;
  return async (text: string) => { const understanding = await new DeterministicUnderstandingProvider().understand(text); return runtime.handleTurn({ conversationId: "ops", channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `w.${n++}`, ...(profileLinked === undefined ? {} : { profileLinked }) }); };
};

test("a person without a TrustHub profile is never offered a community request they could not complete", async () => {
  const guest = await chat([], false)("I'm looking for a bakery in Harare");
  assert.equal(guest.action, "final_unresolved");
  assert.equal(guest.conversation.pendingPermission, null);
  assert.doesNotMatch(guest.reply, /Reply yes to go ahead/);
  assert.match(guest.reply, /couldn't find any bakery listed in Harare/);
  const linked = await chat([], true)("I'm looking for a bakery in Harare");
  assert.equal(linked.action, "ask_community_permission");
  assert.equal(linked.conversation.pendingPermission, "community");
  assert.match(linked.reply, /Reply yes to go ahead, or no and I'll leave it there/);
  const guestWithListings = await chat([row("p1", "Kudzai Plumbing")], false)("Can you recommend a good plumber in Harare?");
  assert.notEqual(guestWithListings.action, "ask_community_permission");
  assert.match(guestWithListings.reply, /Kudzai Plumbing/);
  assert.equal(guestWithListings.conversation.pendingPermission, null);
});

test("the real conversation: Hi, a driving school, Harare returns structured results from the database", async () => {
  const say = chat([row("d1", "Safe Roads Driving School"), row("d2", "Eastlea Driving School", { phone: null, address: null, area: null }), row("p1", "Kudzai Plumbing")]);
  const hello = await say("Hi");
  assert.match(hello.reply, /What would you like to do\?/);
  const asked = await say("I'm looking for a driving school");
  assert.match(asked.reply, /Which city/);
  const found = await say("Harare");
  assert.equal(found.state, "answer_found");
  assert.match(found.reply, /^Got it: driving school in Harare\. I found 2 on TrustHub:/);
  assert.match(found.reply, /\*Safe Roads Driving School\*/);
  assert.match(found.reply, /Phone: \+263 77 123 4567/);
  assert.match(found.reply, /Address: 12 Samora Machel Ave/);
  assert.match(found.reply, /\*Eastlea Driving School\*/);
  assert.doesNotMatch(found.reply, /Kudzai|Reply Yes or No|verified by TrustHub/);
  const eastlea = found.reply.split("\n\n").find((part) => part.includes("Eastlea"))!;
  assert.doesNotMatch(eastlea, /Phone|Address/);
  assert.match(found.reply, /Did one of these work out\?/);
});

test("ordinary language is understood, and a no-luck reply records an honest outcome without a yes/no quiz", async () => {
  const say = chat([row("p1", "Kudzai Plumbing & Drainage")]);
  const asked = await say("my kitchen tap is leaking");
  assert.match(asked.reply, /Which city/);
  const found = await say("Harare");
  assert.match(found.reply, /Kudzai Plumbing/);
  const noLuck = await say("no luck");
  assert.equal(noLuck.outcomeConfirmation?.helpful, false);
  assert.equal(noLuck.outcomeConfirmation?.matchConfirmed, false);
});

// ---- Admin access control ----------------------------------------------------------------------------------------------
function authClient(options: { user?: string | null; admins?: string[]; authThrows?: boolean; tableError?: boolean }): AdminAuthClient {
  return {
    auth: { async getUser() { if (options.authThrows) throw new Error("network"); return options.user ? { data: { user: { id: options.user } }, error: null } : { data: { user: null }, error: { message: "invalid" } }; } },
    from() { return { select() { return { eq(_column: string, value: string) { return { async limit() { return options.tableError ? { data: null, error: { message: "boom" } } : { data: (options.admins ?? []).includes(value) ? [{ user_id: value }] : [], error: null }; } }; } }; } }; },
  };
}
const token = `Bearer ${"a".repeat(40)}`;

test("admin API authorisation is enforced server side: no token, bad token, non-admin, outage and success", async () => {
  assert.deepEqual(await authorizeAdminRequest(null, authClient({})), { ok: false, status: 401, reason: "missing_token" });
  assert.deepEqual(await authorizeAdminRequest("Basic abc", authClient({})), { ok: false, status: 401, reason: "missing_token" });
  assert.deepEqual(await authorizeAdminRequest("Bearer short", authClient({ user: "u1", admins: ["u1"] })), { ok: false, status: 401, reason: "missing_token" });
  assert.deepEqual(await authorizeAdminRequest(token, authClient({ user: null })), { ok: false, status: 401, reason: "invalid_token" });
  assert.deepEqual(await authorizeAdminRequest(token, authClient({ user: "u2", admins: ["u1"] })), { ok: false, status: 403, reason: "not_admin" });
  assert.deepEqual(await authorizeAdminRequest(token, authClient({ authThrows: true })), { ok: false, status: 503, reason: "unavailable" });
  assert.deepEqual(await authorizeAdminRequest(token, authClient({ user: "u1", tableError: true })), { ok: false, status: 503, reason: "unavailable" });
  assert.deepEqual(await authorizeAdminRequest(token, authClient({ user: "u1", admins: ["u1"] })), { ok: true, userId: "u1" });
});

// ---- Dashboard aggregation -----------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-10T10:00:00Z");
const empty = (): DashboardInput => ({ profiles: [], identities: [], conversations: [], messages: [], helpRequests: [], outcomes: [], contributions: [], events: [], inAppNotifications: [], communities: [], totals: { businesses: null, knowledgeRecords: null, businessUpdates: null, agentAssignments: null }, config: { missionsEnabled: false, cronSecretConfigured: false, cronConfigured: true }, truncated: false });

test("date ranges are calendar days in Harare time and the boundaries are exact", () => {
  const late = new Date("2026-10-10T00:30:00Z");
  assert.equal(localDayStart(late).toISOString(), "2026-10-09T22:00:00.000Z");
  assert.equal(localDayStart(new Date("2026-10-09T21:59:59Z")).toISOString(), "2026-10-08T22:00:00.000Z");
  assert.equal(resolveRange("7d", late).start.toISOString(), "2026-10-03T22:00:00.000Z");
  assert.equal(resolveRange("30d", late).start.toISOString(), "2026-09-10T22:00:00.000Z");
  assert.equal(parseRange("bogus"), "today");
  assert.equal(parseRange("30d"), "30d");
  const input = { ...empty(), identities: [{ id: 1 }], conversations: [{ id: 1, whatsapp_identity_id: 1, started_at: "2026-10-09T21:59:59Z", last_message_at: "2026-10-09T21:59:59Z" }], messages: [
    { conversation_id: 1, direction: "inbound", created_at: "2026-10-09T21:59:59Z", provider_message_id: "a" },
    { conversation_id: 1, direction: "inbound", created_at: "2026-10-09T22:00:00Z", provider_message_id: "b" },
  ] };
  const today = buildDashboard(input, "today", late);
  assert.equal(today.usage.messages.inbound, 1);
  assert.equal(today.usage.conversations.started, 0);
  assert.equal(buildDashboard(input, "7d", late).usage.messages.inbound, 2);
});

test("empty data and missing timestamps produce zeros and nulls rather than errors or invented numbers", () => {
  const dash = buildDashboard(empty(), "30d", NOW);
  assert.equal(dash.users.profiles.total, 0);
  assert.equal(dash.users.activeWhatsAppUsers.monthly, 0);
  assert.equal(dash.usage.timeToFirstUsefulAnswerSeconds.median, null);
  assert.equal(dash.health.lastSuccessfulReplyAt, null);
  assert.equal(dash.meta.earliestReliableMessage, null);
  assert.deepEqual(dash.community.dataGaps, []);
  const messy = buildDashboard({ ...empty(), profiles: [{ created_at: null }, { created_at: "garbage" }, {}], messages: [{ conversation_id: 1, direction: "inbound", created_at: null }, { conversation_id: 1, direction: "outbound", created_at: "not a date" }], conversations: [{ id: 1, whatsapp_identity_id: 1, started_at: null }] }, "7d", NOW);
  assert.equal(messy.users.profiles.newInRange, 0);
  assert.equal(messy.usage.messages.inbound, 0);
  assert.equal(messy.usage.conversations.started, 0);
});

const base = (): DashboardInput => ({
  ...empty(),
  profiles: [{ created_at: "2026-10-10T08:00:00Z", last_active_at: "2026-10-10T08:30:00Z" }, { created_at: "2026-10-05T08:00:00Z" }, { created_at: "2026-09-20T08:00:00Z" }],
  identities: [{ id: 1, profile_id: 10, created_at: "2026-09-30T08:00:00Z" }, { id: 2, profile_id: null, created_at: "2026-10-10T07:00:00Z" }, { id: 3, profile_id: null, created_at: "2026-10-01T07:00:00Z" }],
  communities: [{ id: "c-h", city: "Harare" }],
  conversations: [
    { id: 1, whatsapp_identity_id: 1, started_at: "2026-10-09T08:00:00Z", last_message_at: "2026-10-10T08:00:00Z", community_id: "c-h" },
    { id: 2, whatsapp_identity_id: 1, started_at: "2026-10-10T08:00:00Z", last_message_at: "2026-10-10T08:05:00Z" },
    { id: 3, whatsapp_identity_id: 2, started_at: "2026-10-10T07:00:00Z", last_message_at: "2026-10-10T07:02:00Z" },
    { id: 4, whatsapp_identity_id: null, started_at: "2026-10-10T06:00:00Z", last_message_at: "2026-10-10T06:00:30Z" },
  ],
  messages: [
    { conversation_id: 1, direction: "inbound", created_at: "2026-10-10T08:00:00Z", provider_message_id: "m1" },
    { conversation_id: 1, direction: "inbound", created_at: "2026-10-10T08:00:00Z", provider_message_id: "m1" },
    { conversation_id: 1, direction: "inbound", created_at: "2026-10-10T08:01:00Z", provider_message_id: "m2" },
    { conversation_id: 1, direction: "outbound", created_at: "2026-10-10T08:00:20Z", provider_message_id: "o1", resolution: "answered", category: "driving school", city: "Harare", delivery: "accepted" },
    { conversation_id: 2, direction: "inbound", created_at: "2026-10-10T08:00:00Z", provider_message_id: "m3" },
    { conversation_id: 2, direction: "outbound", created_at: "2026-10-10T08:05:00Z", resolution: "unresolved", category: "dentist", city: "Harare", delivery: null },
    { conversation_id: 3, direction: "inbound", created_at: "2026-10-10T07:00:00Z", provider_message_id: "m4" },
    { conversation_id: 3, direction: "outbound", created_at: "2026-10-10T07:01:00Z", resolution: "clarification_needed", category: "plumber", delivery: "accepted" },
    { conversation_id: 4, direction: "inbound", created_at: "2026-10-10T06:00:00Z", provider_message_id: "m5" },
  ],
  helpRequests: [{ status: "open", community_consent_at: "2026-10-10T08:00:00Z", created_at: "2026-10-10T08:00:00Z" }, { status: "resolved", created_at: "2026-10-01T08:00:00Z" }],
  outcomes: [{ useful_answer_confirmed: true, match_confirmed: false, recorded_at: "2026-10-10T09:00:00Z", resolved_at: "2026-10-10T09:00:00Z" }, { useful_answer_confirmed: false, recorded_at: "2026-10-10T09:10:00Z" }],
  contributions: [{ verification_status: "declared", created_at: "2026-10-10T09:00:00Z", category: "Plumber" }, { verification_status: "declared", created_at: "2026-10-10T09:05:00Z", category: "plumber" }],
});

test("people are unique WhatsApp identities: repeated messages, extra conversations and duplicate deliveries never inflate the count", () => {
  const dash = buildDashboard(base(), "today", NOW);
  assert.equal(dash.usage.messages.inbound, 5);
  assert.equal(dash.users.activeWhatsAppUsers.daily, 2);
  assert.equal(dash.users.unattributedInboundMessages, 1);
  assert.equal(dash.users.repeatUsers, 1);
  assert.equal(dash.users.identities.total, 3);
  assert.equal(dash.users.identities.linked, 1);
  assert.equal(dash.users.identities.unlinked, 2);
  assert.equal(dash.users.profiles.total, 3);
  assert.deepEqual([dash.users.profiles.newToday, dash.users.profiles.new7d, dash.users.profiles.new30d], [1, 2, 3]);
  assert.deepEqual(dash.users.newVsReturning, { new: 1, returning: 1 });
  assert.equal(dash.users.conversationsWithoutIdentity, 1);
});

test("usefulness, unanswered demand and time to first useful answer come from recorded replies", () => {
  const dash = buildDashboard(base(), "today", NOW);
  assert.equal(dash.usage.conversations.withUsefulAnswer, 1);
  assert.equal(dash.usage.timeToFirstUsefulAnswerSeconds.median, 20);
  assert.equal(dash.usage.unansweredRequests, 1);
  assert.deepEqual(dash.community.dataGaps, [{ category: "dentist", city: "Harare", requests: 1 }]);
  assert.deepEqual(dash.usage.topCategories.map((item) => item.label).sort(), ["dentist", "driving school", "plumber"]);
  assert.ok(dash.community.demandByCommunity.find((item) => item.community === "Harare")?.categories.some((item) => item.label === "driving school"));
});

test("problems solved count only confirmed outcomes, and contributions keep their unverified status", () => {
  const dash = buildDashboard(base(), "today", NOW);
  assert.equal(dash.community.outcomes.usefulAnswerConfirmed, 1);
  assert.equal(dash.community.outcomes.matchConfirmed, 0);
  assert.deepEqual(dash.community.contributions.byVerification, { declared: 2 });
  assert.equal(dash.community.contributions.topCategories[0].count, 2);
  assert.equal(dash.community.helpRequests.opened, 1);
  assert.equal(dash.community.helpRequests.consented, 1);
  assert.equal(dash.community.helpRequests.pendingNow, 1);
});

test("delivery health separates replies with and without a recorded provider acceptance", () => {
  const dash = buildDashboard(base(), "today", NOW);
  assert.equal(dash.health.outbound.repliesSent, 3);
  assert.equal(dash.health.outbound.repliesWithoutProviderAcceptance, 1);
  assert.equal(dash.health.lastSuccessfulReplyAt, "2026-10-10T08:00:20.000Z");
  assert.match(dash.notifications.deliveryReceipts, /not stored/);
});

test("operational events feed webhook health, notification counts and scheduler status", () => {
  const events = [
    { name: "inbound_normalized", occurred_at: "2026-10-10T08:00:00Z", attributes: { kind: "processing_failed", stage: "Error" } },
    { name: "inbound_normalized", occurred_at: "2026-10-10T08:01:00Z", attributes: { kind: "skipped_message", reason: "invalid_sender" } },
    { name: "inbound_normalized", occurred_at: "2026-10-10T08:02:00Z", attributes: { kind: "duplicate_webhook" } },
    { name: "inbound_normalized", occurred_at: "2026-10-10T08:03:00Z", attributes: { kind: "outbound_failed" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T07:00:00Z", correlation_id: "identity:1", attributes: { kind: "notification_preference", level: "on" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T07:30:00Z", correlation_id: "identity:3", attributes: { kind: "notification_preference", level: "on" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T07:40:00Z", correlation_id: "identity:3", attributes: { kind: "notification_preference", level: "off" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T09:00:00Z", correlation_id: "identity:1", attributes: { kind: "community_mission", status: "queued", mission: "dentist|harare" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T09:00:05Z", correlation_id: "identity:1", attributes: { kind: "community_mission", status: "accepted", mission: "dentist|harare" } },
    { name: "notification_dispatched", occurred_at: "2026-10-10T09:10:00Z", correlation_id: "community-missions", attributes: { kind: "community_mission_run", duplicates: 2 } },
  ];
  const dash = buildDashboard({ ...base(), events }, "today", NOW);
  assert.deepEqual(dash.health.webhook, { processingFailed: 1, skippedUnreadableMessages: 1, duplicateDeliveriesIgnored: 1 });
  assert.equal(dash.health.outbound.failuresRecorded, 1);
  assert.equal(dash.notifications.whatsappMissions.optedOut, 1);
  assert.equal(dash.notifications.whatsappMissions.optedInOrReduced, 1);
  assert.equal(dash.notifications.whatsappMissions.sent, 1);
  assert.equal(dash.notifications.whatsappMissions.queued, 1);
  assert.equal(dash.notifications.whatsappMissions.skippedDuplicates, 2);
  assert.equal(dash.notifications.whatsappMissions.eligibleNow, 1);
  assert.equal(dash.health.scheduler.lastRunVerified, "2026-10-10T09:10:00Z");
  assert.equal(latestPreferences(events).get("3")?.level, "off");
  const payload = JSON.stringify(dash);
  assert.doesNotMatch(payload, /\+\d{6,}|eyJ|access_token|phone_number/i);
});

// ---- Missions, frequency, consent and opt-out -----------------------------------------------------------------------
const at = (iso: string) => Date.parse(iso);
const policy = missionPolicy();
const noon = at("2026-10-10T10:00:00Z");

test("preferences change only on explicit wording", () => {
  for (const text of ["STOP", "stop messages", "Please stop the notifications", "unsubscribe", "no more messages", "don't message me"]) assert.equal(parseNotificationPreference(text), "off", text);
  for (const text of ["fewer messages", "message me less", "reduce notifications"]) assert.equal(parseNotificationPreference(text), "reduced", text);
  for (const text of ["send me community questions", "start community messages", "opt in", "resume notifications"]) assert.equal(parseNotificationPreference(text), "on", text);
  for (const text of ["I need a plumber", "Harare", "yes", "no", "stop at the bank on the way", "thanks", ""]) assert.equal(parseNotificationPreference(text), null, text);
  assert.match(preferenceReply("off"), /won't send you community questions any more/);
  assert.match(preferenceReply("on"), /never more than a few a day/);
});

test("nobody is messaged without opting in, opting out is respected, and the 24-hour window and quiet hours apply", () => {
  const recent = noon - 3_600_000;
  assert.deepEqual(checkEligibility({ preference: null, sentAt: [], lastInboundAt: recent, now: noon, policy }), { ok: false, reason: "not_opted_in" });
  assert.deepEqual(checkEligibility({ preference: "off", sentAt: [], lastInboundAt: recent, now: noon, policy }), { ok: false, reason: "opted_out" });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [], lastInboundAt: null, now: noon, policy }), { ok: false, reason: "outside_service_window" });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [], lastInboundAt: noon - 25 * 3_600_000, now: noon, policy }), { ok: false, reason: "outside_service_window" });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [], lastInboundAt: recent, now: noon, policy }), { ok: true });
  const night = at("2026-10-10T19:30:00Z");
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [], lastInboundAt: night - 3_600_000, now: night, policy }), { ok: false, reason: "quiet_hours" });
  const early = at("2026-10-10T05:30:00Z");
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [], lastInboundAt: early - 3_600_000, now: early, policy }), { ok: false, reason: "quiet_hours" });
});

test("frequency is conservative by default, configurable up to three per day, spaced, and reduced users hear rarely", () => {
  assert.equal(policy.maxPerDay, 1);
  assert.equal(missionPolicy({ maxPerDay: 10 }).maxPerDay, HARD_MAX_PER_DAY);
  assert.equal(policyFromEnvironment({ COMMUNITY_MISSIONS_MAX_PER_DAY: "7" }).maxPerDay, 3);
  assert.equal(policyFromEnvironment({}).maxPerDay, 1);
  const recent = noon - 3_600_000;
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [noon - 5 * 3_600_000], lastInboundAt: recent, now: noon, policy }), { ok: false, reason: "daily_limit" });
  const three = missionPolicy({ maxPerDay: 3 });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [noon - 5 * 3_600_000], lastInboundAt: recent, now: noon, policy: three }), { ok: true });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [noon - 2 * 3_600_000], lastInboundAt: recent, now: noon, policy: three }), { ok: false, reason: "spacing" });
  assert.deepEqual(checkEligibility({ preference: "on", sentAt: [noon - 6 * 3_600_000, noon - 5 * 3_600_000, noon - 4.5 * 3_600_000], lastInboundAt: recent, now: noon, policy: three }), { ok: false, reason: "daily_limit" });
  assert.deepEqual(checkEligibility({ preference: "reduced", sentAt: [noon - 2 * 86_400_000], lastInboundAt: recent, now: noon, policy }), { ok: false, reason: "reduced_interval" });
  assert.deepEqual(checkEligibility({ preference: "reduced", sentAt: [noon - 4 * 86_400_000], lastInboundAt: recent, now: noon, policy }), { ok: true });
});

test("missions describe gaps only as far as the records support, avoid repeats and never include private data", () => {
  const gaps = [{ category: "dentist", city: "Harare", requests: 5, listed: 0 }, { category: "plumber", city: "Harare", requests: 2, listed: 6 }, { category: "tutor", city: "Chinhoyi", requests: 1, listed: null }];
  const first = chooseMission(gaps, new Set())!;
  assert.equal(first.key, "dentist|harare");
  assert.match(first.message, /Quick question for the Harare community/);
  assert.match(first.message, /doesn't have any listed for Harare yet, and people have been asking/);
  assert.match(first.message, /labelled as community-shared until it can be checked/);
  assert.match(first.message, /Reply STOP/);
  const second = chooseMission(gaps, new Set(["dentist|harare"]))!;
  assert.equal(second.key, "tutor|chinhoyi");
  assert.doesNotMatch(second.message, /listed|only has|doesn't have any/);
  assert.match(second.message, /People in Chinhoyi have been asking/);
  assert.ok(![first.key, second.key].includes("plumber|harare"));
  const unknownSupply = chooseMission([gaps[2]], new Set())!;
  assert.doesNotMatch(unknownSupply.message, /listed/);
  const generic = chooseMission([], new Set())!;
  assert.equal(generic.key, "general|any");
  assert.match(generic.message, /plumber, electrician or other service recently that you'd recommend/);
  assert.equal(chooseMission([], new Set(["general|any"])), null);
  assert.doesNotMatch(first.message, /\+?\d{7,}/);
  assert.equal(chooseMission([{ category: "x'; DROP", city: "Harare)", requests: 1, listed: null }], new Set())!.city, "Harare");
});

function runnerDeps(overrides: Omit<Partial<MissionDeps>, "candidates"> & { candidates: MissionCandidate[] }) {
  const log = { sent: [] as { phone: string; text: string }[], recorded: [] as { status: string; resultKey: string; dedupeKey: string }[], runs: [] as unknown[] };
  const known = new Set<string>();
  const { candidates, ...rest } = overrides;
  const deps: MissionDeps = {
    now: () => noon, policy, enabled: true,
    candidates: async () => candidates,
    gaps: async () => [{ category: "dentist", city: "Harare", requests: 3, listed: 1 }],
    alreadyRecorded: async (key) => known.has(key),
    send: async (phone, text) => { log.sent.push({ phone, text }); },
    record: async (event) => { log.recorded.push({ status: event.status, resultKey: event.resultKey, dedupeKey: event.dedupeKey }); known.add(event.status === "queued" ? event.dedupeKey : event.resultKey); },
    recordRun: async (summary) => { log.runs.push(summary); },
    ...rest,
  };
  return { deps, log };
}
const candidate = (id: string, overrides: Partial<MissionCandidate> = {}): MissionCandidate => ({ identityId: id, phone: `+2637710000${id.padStart(2, "0")}`, preference: "on", sentAt: [], askedKeys: [], lastInboundAt: noon - 3_600_000, ...overrides });

test("a dry run evaluates eligibility but sends and records nothing for any person", async () => {
  const { deps, log } = runnerDeps({ enabled: false, candidates: [candidate("1"), candidate("2", { preference: "off" }), candidate("3", { preference: null })] });
  const summary = await runCommunityMissions(deps);
  assert.deepEqual({ dryRun: summary.dryRun, considered: summary.considered, eligible: summary.eligible, sent: summary.sent }, { dryRun: true, considered: 3, eligible: 1, sent: 1 });
  assert.deepEqual(summary.skipped, { opted_out: 1, not_opted_in: 1 });
  assert.equal(log.sent.length, 0);
  assert.equal(log.recorded.length, 0);
  assert.equal(log.runs.length, 1);
});

test("a live run records a queued marker before sending, then the provider result, and a retry cannot send twice", async () => {
  const order: string[] = [];
  const { deps, log } = runnerDeps({
    candidates: [candidate("1")],
    send: async () => { order.push("send"); },
    record: async (event) => { order.push(event.status); },
  });
  const summary = await runCommunityMissions(deps);
  assert.deepEqual(order, ["queued", "send", "accepted"]);
  assert.equal(summary.sent, 1);
  void log;
  const shared = runnerDeps({ candidates: [candidate("1")] });
  await runCommunityMissions(shared.deps);
  const retry = await runCommunityMissions(shared.deps);
  assert.equal(shared.log.sent.length, 1);
  assert.equal(retry.duplicatesPrevented, 1);
  assert.equal(retry.sent, 0);
  assert.equal(missionDedupeKey("1", noon, policy, "dentist|harare"), "mission:1:2026-10-10:dentist|harare");
});

test("a failed send is recorded as failed, counted, and not retried the same day", async () => {
  const shared = runnerDeps({ candidates: [candidate("1")], send: async () => { throw new Error("Meta rejected"); } });
  const first = await runCommunityMissions(shared.deps);
  assert.equal(first.failed, 1);
  assert.equal(first.sent, 0);
  assert.deepEqual(shared.log.recorded.map((event) => event.status), ["queued", "failed"]);
  const again = await runCommunityMissions(shared.deps);
  assert.equal(again.duplicatesPrevented, 1);
  assert.equal(again.failed, 0);
});

test("people who recently wrote, were asked already or are over their limit are skipped, and a run is capped", async () => {
  const { deps, log } = runnerDeps({ maxPerRun: 2, candidates: [candidate("1"), candidate("2", { sentAt: [noon - 5 * 3_600_000] }), candidate("3", { lastInboundAt: noon - 30 * 3_600_000 }), candidate("4"), candidate("5"), candidate("6", { askedKeys: ["dentist|harare", "general|any"] })] });
  const summary = await runCommunityMissions(deps);
  assert.equal(summary.sent, 2);
  assert.equal(log.sent.length, 2);
  assert.equal(summary.skipped.daily_limit, 2);
  assert.equal(summary.skipped.outside_service_window, 1);
  assert.equal(summary.skipped.no_mission, 1);
  assert.ok(log.sent.every((message) => /Reply STOP/.test(message.text)));
});

// ---- Preference interaction through the conversation and the event store -------------------------------------------------
class EventStore implements SupabaseDataClient {
  readonly rows: SupabaseRow[] = [];
  from(): SupabaseQuery {
    const rows = this.rows; let payload: SupabaseRow = {};
    const query: SupabaseQuery = {
      select: () => query, insert: () => query, update: () => query, ilike: () => query, is: () => query, order: () => query, limit: () => query, eq: () => query,
      upsert: (values) => { payload = values as SupabaseRow; return query; },
      single: () => Promise.resolve({ data: null, error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok, bad) => { if (!rows.some((existing) => existing.id === payload.id)) rows.push({ ...payload }); return Promise.resolve<SupabaseQueryResult>({ data: null, error: null }).then(ok, bad); },
    };
    return query;
  }
}

test("saying stop acknowledges, keeps the pending search, and is recorded once per message even if the webhook is retried", async () => {
  const say = chat([row("d1", "Safe Roads Driving School")]);
  await say("I'm looking for a driving school");
  const stop = await say("stop messages");
  assert.equal(stop.notificationPreference, "off");
  assert.match(stop.reply, /won't send you community questions any more/);
  assert.equal(stop.state, "clarification_needed");
  const resumed = await say("Harare");
  assert.match(resumed.reply, /Safe Roads Driving School/);
  const store = new EventStore();
  for (let attempt = 0; attempt < 3; attempt += 1) await recordOperationalEvent(store, { kind: "notification_preference", sourceId: "wamid.stop-1", correlationId: "identity:7", actor: "user", attributes: { level: "off" } });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].name, "notification_dispatched");
  assert.deepEqual(store.rows[0].attributes, { kind: "notification_preference", level: "off" });
  assert.equal(latestPreferences(store.rows.map((event) => ({ name: String(event.name), occurred_at: String(event.occurred_at), correlation_id: String(event.correlation_id), attributes: event.attributes as Record<string, unknown> }))).get("7")?.level, "off");
});

test("operational events refuse sensitive attributes instead of storing them", async () => {
  const store = new EventStore();
  const stored = await recordOperationalEvent(store, { kind: "processing_failed", sourceId: "r1", correlationId: "r1", attributes: { phone: "+263771234567" } });
  assert.equal(stored, false);
  assert.equal(store.rows.length, 0);
});

test("results from the answer generator never contain the removed yes/no quiz and keep unresolved wording honest", async () => {
  const resolution = { status: "unresolved", evidence: [], provenance: [], confidence: "unknown", uncertainty: null, sourceAttempts: [], nextAction: "final" } as unknown as ResolutionResult;
  const text = (await createAnswerGenerator().generate(resolution)).text;
  assert.match(text, /haven't found enough reliable information/);
  assert.match(text, /ask people in your community/);
  const resolver = new PolicyAnswerResolver({ trusthub: new TrustHubBusinessAnswerSource(new SupabaseTrustHubClient(new ReadClient([row("d1", "Safe Roads Driving School")])), () => "2026-01-01T00:00:00.000Z") });
  const resolved = await resolver.resolve({ text: "x", intent: "find_business", category: "driving school", location: { country: "Zimbabwe", city: "Harare" }, questionType: "business_discovery" });
  assert.ok(resolved.evidence.every((item) => item.kind === "listing" && item.name && item.verificationStatus !== "verified"));
});

