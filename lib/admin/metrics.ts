/**
 * Pure dashboard aggregation. Everything here works on plain rows so the numbers are testable without a database.
 * Unique people are WhatsApp identities, never messages or conversations; unattributed conversations are reported separately.
 */
export type RangeKey = "today" | "7d" | "30d";

/** Harare is UTC+2 all year, so "today" and "last N days" are calendar days in that zone. */
const LOCAL_OFFSET_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;
/** WhatsApp only allows free-form messages within 24 hours of the person's last message. */
export const SERVICE_WINDOW_MS = 23 * 3_600_000;

export interface RangeBounds { key: RangeKey; start: Date; end: Date; days: number }

export function localDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + LOCAL_OFFSET_MS) / DAY_MS) * DAY_MS - LOCAL_OFFSET_MS);
}

export function resolveRange(key: RangeKey, now: Date): RangeBounds {
  const days = key === "today" ? 1 : key === "7d" ? 7 : 30;
  const start = new Date(localDayStart(now).getTime() - (days - 1) * DAY_MS);
  return { key, start, end: now, days };
}

export function parseRange(value: string | null | undefined): RangeKey { return value === "7d" || value === "30d" ? value : "today"; }

const ms = (value: unknown): number | null => { if (typeof value !== "string") return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };
const within = (value: unknown, range: { start: Date; end: Date }): boolean => { const time = ms(value); return time !== null && time >= range.start.getTime() && time <= range.end.getTime(); };

export interface ProfileRow { created_at?: string | null; last_active_at?: string | null }
export interface IdentityRow { id: string | number; profile_id?: string | number | null; created_at?: string | null }
export interface ConversationRow { id: string | number; whatsapp_identity_id?: string | number | null; profile_id?: string | number | null; community_id?: string | null; started_at?: string | null; last_message_at?: string | null; status?: string | null }
export interface MessageRow {
  conversation_id: string | number; direction: string; created_at?: string | null; provider_message_id?: string | null;
  state?: string | null; resolution?: string | null; category?: string | null; city?: string | null; delivery?: string | null;
}
export interface HelpRequestRow { status?: string | null; community_consent_at?: string | null; created_at?: string | null; requested_category?: string | null; area?: string | null }
export interface OutcomeRow { useful_answer_confirmed?: boolean | null; match_confirmed?: boolean | null; resolved_at?: string | null; recorded_at?: string | null }
export interface ContributionRow { verification_status?: string | null; created_at?: string | null; category?: string | null }
export interface EventRow { name: string; occurred_at?: string | null; correlation_id?: string | null; attributes?: Record<string, unknown> | null }
export interface InAppNotificationRow { type?: string | null; created_at?: string | null; read_at?: string | null }
export interface CommunityRow { id: string; name?: string | null; city?: string | null }

export interface DashboardInput {
  profiles: ProfileRow[]; identities: IdentityRow[]; conversations: ConversationRow[]; messages: MessageRow[];
  helpRequests: HelpRequestRow[]; outcomes: OutcomeRow[]; contributions: ContributionRow[]; events: EventRow[];
  inAppNotifications: InAppNotificationRow[]; communities: CommunityRow[];
  totals: { businesses: number | null; knowledgeRecords: number | null; businessUpdates: number | null; agentAssignments: number | null; businessesCreatedInRange?: number | null };
  config: { missionsEnabled: boolean; cronSecretConfigured: boolean; cronConfigured: boolean };
  truncated: boolean;
}

const USEFUL = new Set(["answered", "partially_answered"]);
const top = (counts: Map<string, number>, limit = 10) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([label, count]) => ({ label, count }));
const bump = (counts: Map<string, number>, key: string, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);
const norm = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2); };

/** The latest notification preference per identity; correlation ids look like `identity:<id>`. */
export function latestPreferences(events: EventRow[]): Map<string, { level: string; at: number }> {
  const result = new Map<string, { level: string; at: number }>();
  for (const event of events) {
    if (event.attributes?.kind !== "notification_preference" || !event.correlation_id?.startsWith("identity:")) continue;
    const at = ms(event.occurred_at);
    const level = typeof event.attributes.level === "string" ? event.attributes.level : null;
    if (at === null || !level) continue;
    const id = event.correlation_id.slice("identity:".length);
    const current = result.get(id);
    if (!current || at > current.at) result.set(id, { level, at });
  }
  return result;
}

export function buildDashboard(input: DashboardInput, key: RangeKey, now: Date) {
  const range = resolveRange(key, now);
  const today = resolveRange("today", now);
  const week = resolveRange("7d", now);
  const month = resolveRange("30d", now);

  const conversationIdentity = new Map<string, string | null>();
  for (const conversation of input.conversations) conversationIdentity.set(String(conversation.id), conversation.whatsapp_identity_id == null ? null : String(conversation.whatsapp_identity_id));
  const conversationCommunity = new Map<string, string | null>();
  for (const conversation of input.conversations) conversationCommunity.set(String(conversation.id), conversation.community_id ?? null);
  const communityName = new Map(input.communities.map((community) => [community.id, community.city || community.name || "Unnamed community"]));

  // Duplicate webhook deliveries share a provider id, so they can never be counted as two messages.
  const seen = new Set<string>();
  const messages = input.messages.filter((message) => {
    const id = message.provider_message_id;
    if (!id) return true;
    const dedupeKey = `${message.direction}:${id}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
  const inbound = messages.filter((message) => message.direction === "inbound");
  const outbound = messages.filter((message) => message.direction === "outbound");

  const activeIdentities = (window: { start: Date; end: Date }) => {
    const people = new Set<string>();
    let unattributed = 0;
    for (const message of inbound) {
      if (!within(message.created_at, window)) continue;
      const identity = conversationIdentity.get(String(message.conversation_id));
      if (identity) people.add(identity); else unattributed += 1;
    }
    return { people, unattributed };
  };
  const dau = activeIdentities(today);
  const wau = activeIdentities(week);
  const mau = activeIdentities(month);
  const rangeActive = activeIdentities(range);

  const identityCreated = new Map(input.identities.map((identity) => [String(identity.id), ms(identity.created_at)]));
  const newPeople = [...rangeActive.people].filter((id) => { const created = identityCreated.get(id); return created !== null && created !== undefined && created >= range.start.getTime(); });

  // Per conversation: first inbound, first useful answer, final state.
  const perConversation = new Map<string, { firstInbound: number | null; firstUseful: number | null; lastOutboundResolution: string | null; lastOutboundAt: number; category: string | null; city: string | null; usefulInRange: boolean; touchedInRange: boolean }>();
  for (const message of [...messages].sort((a, b) => (ms(a.created_at) ?? 0) - (ms(b.created_at) ?? 0))) {
    const id = String(message.conversation_id);
    const entry = perConversation.get(id) ?? { firstInbound: null, firstUseful: null, lastOutboundResolution: null, lastOutboundAt: 0, category: null, city: null, usefulInRange: false, touchedInRange: false };
    const at = ms(message.created_at);
    if (at !== null) {
      if (message.direction === "inbound" && entry.firstInbound === null) entry.firstInbound = at;
      if (within(message.created_at, range)) entry.touchedInRange = true;
      if (message.direction === "outbound") {
        const useful = !!message.resolution && USEFUL.has(message.resolution);
        if (useful && entry.firstUseful === null) entry.firstUseful = at;
        if (useful && within(message.created_at, range)) entry.usefulInRange = true;
        if (at >= entry.lastOutboundAt) { entry.lastOutboundAt = at; entry.lastOutboundResolution = message.resolution ?? null; }
        if (message.category) { entry.category = message.category; entry.city = message.city ?? entry.city; }
      }
    }
    perConversation.set(id, entry);
  }

  const inRangeConversations = [...perConversation].filter(([, entry]) => entry.touchedInRange);
  const requestedCategories = new Map<string, number>();
  const demandByCommunity = new Map<string, Map<string, number>>();
  const gaps = new Map<string, number>();
  let unanswered = 0;
  const timesToUseful: number[] = [];
  for (const [id, entry] of inRangeConversations) {
    if (entry.category) {
      bump(requestedCategories, norm(entry.category));
      const community = (conversationCommunity.get(id) ? communityName.get(conversationCommunity.get(id)!) : null) ?? entry.city ?? "Not stated";
      const bucket = demandByCommunity.get(community) ?? new Map<string, number>();
      bump(bucket, norm(entry.category));
      demandByCommunity.set(community, bucket);
      if (entry.lastOutboundResolution === "unresolved") { unanswered += 1; bump(gaps, `${norm(entry.category)}|${entry.city ?? "city not stated"}`); }
    }
    if (entry.firstInbound !== null && entry.firstUseful !== null && entry.firstUseful >= entry.firstInbound) timesToUseful.push(Math.round((entry.firstUseful - entry.firstInbound) / 1000));
  }

  const conversationsStarted = input.conversations.filter((conversation) => within(conversation.started_at, range)).length;
  const conversationsActive = input.conversations.filter((conversation) => within(conversation.last_message_at, range)).length;
  const identityConversationCounts = new Map<string, number>();
  for (const conversation of input.conversations) if (conversation.whatsapp_identity_id != null) bump(identityConversationCounts, String(conversation.whatsapp_identity_id));

  const eventsInRange = input.events.filter((event) => within(event.occurred_at, range));
  const kindCount = (kind: string, source = eventsInRange) => source.filter((event) => event.attributes?.kind === kind).length;
  const preferences = latestPreferences(input.events);
  const optedOut = [...preferences.values()].filter((value) => value.level === "off").length;
  const optedIn = [...preferences].filter(([, value]) => value.level === "on" || value.level === "reduced");
  const lastInboundByIdentity = new Map<string, number>();
  for (const message of inbound) {
    const identity = conversationIdentity.get(String(message.conversation_id));
    const at = ms(message.created_at);
    if (identity && at !== null) lastInboundByIdentity.set(identity, Math.max(lastInboundByIdentity.get(identity) ?? 0, at));
  }
  const eligibleNow = optedIn.filter(([id]) => now.getTime() - (lastInboundByIdentity.get(id) ?? 0) <= SERVICE_WINDOW_MS).length;
  const missionEvents = eventsInRange.filter((event) => event.attributes?.kind === "community_mission");
  const missionStatus = (status: string) => missionEvents.filter((event) => event.attributes?.status === status).length;

  const deliveredStatus = (message: MessageRow) => message.delivery === "accepted" || message.delivery === "delivered";
  const outboundInRange = outbound.filter((message) => within(message.created_at, range));
  const lastDelivered = outbound.filter(deliveredStatus).map((message) => ms(message.created_at) ?? 0).sort((a, b) => b - a)[0] ?? null;

  const profileWindow = (window: { start: Date; end: Date }) => input.profiles.filter((profile) => within(profile.created_at, window)).length;
  const earliestMessage = messages.map((message) => ms(message.created_at)).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null;

  const inAppByType = new Map<string, number>();
  const inAppInRange = input.inAppNotifications.filter((notification) => within(notification.created_at, range));
  for (const notification of inAppInRange) bump(inAppByType, notification.type ?? "unknown");

  const countBy = (rows: { value?: string | null }[]) => { const map = new Map<string, number>(); for (const row of rows) bump(map, row.value ?? "unknown"); return Object.fromEntries(map); };
  const helpInRange = input.helpRequests.filter((request) => within(request.created_at, range));
  const contributionsInRange = input.contributions.filter((contribution) => within(contribution.created_at, range));
  const outcomesInRange = input.outcomes.filter((outcome) => within(outcome.recorded_at, range));

  const recentEvents = [...input.events].sort((a, b) => (ms(b.occurred_at) ?? 0) - (ms(a.occurred_at) ?? 0)).slice(0, 15)
    .map((event) => ({ name: event.name, kind: typeof event.attributes?.kind === "string" ? event.attributes.kind : null, at: event.occurred_at ?? null, stage: typeof event.attributes?.stage === "string" ? event.attributes.stage : typeof event.attributes?.reason === "string" ? event.attributes.reason : null }));

  return {
    generatedAt: now.toISOString(),
    range: { key, start: range.start.toISOString(), end: range.end.toISOString(), timezone: "Africa/Harare (UTC+2)", days: range.days },
    users: {
      profiles: { total: input.profiles.length, newToday: profileWindow(today), new7d: profileWindow(week), new30d: profileWindow(month), newInRange: profileWindow(range), activeByProfileLastActive: input.profiles.filter((profile) => within(profile.last_active_at, range)).length },
      identities: { total: input.identities.length, linked: input.identities.filter((identity) => identity.profile_id != null).length, unlinked: input.identities.filter((identity) => identity.profile_id == null).length },
      activeWhatsAppUsers: { daily: dau.people.size, weekly: wau.people.size, monthly: mau.people.size, inRange: rangeActive.people.size },
      newVsReturning: { new: newPeople.length, returning: rangeActive.people.size - newPeople.length },
      unattributedInboundMessages: rangeActive.unattributed,
      conversationsWithoutIdentity: input.conversations.filter((conversation) => conversation.whatsapp_identity_id == null).length,
      repeatUsers: [...identityConversationCounts.values()].filter((count) => count >= 2).length,
      byCommunity: top(new Map([...demandByCommunity].map(([community, counts]) => [community, [...counts.values()].reduce((a, b) => a + b, 0)])), 10),
    },
    usage: {
      messages: { inbound: inbound.filter((message) => within(message.created_at, range)).length, outbound: outboundInRange.length },
      conversations: { started: conversationsStarted, active: conversationsActive, withUsefulAnswer: inRangeConversations.filter(([, entry]) => entry.usefulInRange).length },
      searchRequests: inRangeConversations.filter(([, entry]) => entry.category).length,
      topCategories: top(requestedCategories, 10),
      unansweredRequests: unanswered,
      timeToFirstUsefulAnswerSeconds: { median: median(timesToUseful), samples: timesToUseful.length },
    },
    community: {
      helpRequests: { opened: helpInRange.length, consented: helpInRange.filter((request) => request.community_consent_at).length, byStatus: countBy(helpInRange.map((request) => ({ value: request.status }))), pendingNow: input.helpRequests.filter((request) => request.status === "open").length, assigned: input.totals.agentAssignments },
      outcomes: { recorded: outcomesInRange.length, usefulAnswerConfirmed: outcomesInRange.filter((outcome) => outcome.useful_answer_confirmed).length, matchConfirmed: outcomesInRange.filter((outcome) => outcome.match_confirmed).length, resolved: outcomesInRange.filter((outcome) => outcome.resolved_at).length },
      contributions: { received: contributionsInRange.length, byVerification: countBy(contributionsInRange.map((contribution) => ({ value: contribution.verification_status }))), topCategories: top(contributionsInRange.reduce((map, contribution) => { bump(map, norm(contribution.category) || "uncategorised"); return map; }, new Map<string, number>()), 5) },
      knowledge: { businesses: input.totals.businesses, knowledgeRecords: input.totals.knowledgeRecords, businessRecordsCreatedInRange: input.totals.businessesCreatedInRange ?? null, informationUpdatesAwaitingReview: input.totals.businessUpdates },
      demandByCommunity: [...demandByCommunity].map(([community, counts]) => ({ community, categories: top(counts, 5) })),
      dataGaps: top(gaps, 10).map((gap) => { const [category, city] = gap.label.split("|"); return { category, city, requests: gap.count }; }),
    },
    notifications: {
      whatsappMissions: { enabled: input.config.missionsEnabled, eligibleNow, queued: missionStatus("queued"), sent: missionStatus("accepted") + missionStatus("delivered"), failed: missionStatus("failed"), skippedDuplicates: eventsInRange.filter((event) => event.attributes?.kind === "community_mission_run").reduce((sum, event) => sum + (typeof event.attributes?.duplicates === "number" ? event.attributes.duplicates : 0), 0), optedOut, optedInOrReduced: optedIn.length, recentTypes: top(missionEvents.reduce((map, event) => { bump(map, typeof event.attributes?.mission === "string" ? event.attributes.mission : "unspecified"); return map; }, new Map<string, number>()), 5) },
      deliveryReceipts: "Not available: WhatsApp delivery receipts are not stored, so delivered and read counts are not reported.",
      inApp: { note: "TrustHub web-app notifications (separate from WhatsApp).", total: inAppInRange.length, read: inAppInRange.filter((notification) => notification.read_at).length, byType: top(inAppByType, 8) },
    },
    health: {
      webhook: { processingFailed: kindCount("processing_failed"), skippedUnreadableMessages: kindCount("skipped_message"), duplicateDeliveriesIgnored: kindCount("duplicate_webhook") },
      outbound: { failuresRecorded: kindCount("outbound_failed"), repliesWithoutProviderAcceptance: outboundInRange.filter((message) => !deliveredStatus(message)).length, repliesSent: outboundInRange.length },
      identity: { unlinkedIdentities: input.identities.filter((identity) => identity.profile_id == null).length, conversationsWithoutIdentity: input.conversations.filter((conversation) => conversation.whatsapp_identity_id == null).length },
      lastSuccessfulReplyAt: lastDelivered ? new Date(lastDelivered).toISOString() : null,
      recentEvents: recentEvents,
      scheduler: { cronConfigured: input.config.cronConfigured, cronSecretConfigured: input.config.cronSecretConfigured, lastRunVerified: input.events.filter((event) => event.attributes?.kind === "community_mission_run").map((event) => event.occurred_at).sort().at(-1) ?? null },
    },
    meta: { earliestReliableMessage: earliestMessage ? new Date(earliestMessage).toISOString() : null, truncated: input.truncated },
  };
}

export type DashboardMetrics = ReturnType<typeof buildDashboard>;

export const METRIC_DEFINITIONS: Record<string, string> = {
  profiles: "TrustHub profiles (registered accounts). Not the same as WhatsApp identities or conversations.",
  identities: "One row per WhatsApp number. Linked means it is attached to a TrustHub profile; unlinked is a guest or not yet connected.",
  activeWhatsAppUsers: "Unique WhatsApp identities with at least one inbound message in the window. Messages and conversations are never counted as people.",
  newVsReturning: "New: the identity was first created inside the selected range. Returning: active in the range but created earlier.",
  conversationsWithUsefulAnswer: "Conversations where Wisdom sent results from TrustHub's data. A useful answer is not a confirmed solved problem.",
  problemsSolved: "Only outcomes the person confirmed (help_request_outcomes). Listing a business is not counted as solved.",
  timeToFirstUsefulAnswer: "Median seconds from a conversation's first inbound message to its first reply that contained results.",
  unanswered: "Conversations with a service request whose latest reply was 'could not find reliable information'.",
  dataGaps: "Requested services with no result, grouped by service and city. This is inferred demand, not proof that no such business exists.",
  repliesWithoutProviderAcceptance: "Replies stored without a recorded WhatsApp acceptance. Includes failures and replies from before acceptance was recorded.",
};
