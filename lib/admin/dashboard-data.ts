import type { CommunityRow, DashboardInput, EventRow, MessageRow } from "./metrics.ts";
import { localDayStart } from "./metrics.ts";

export interface AdminQuery extends PromiseLike<{ data: Record<string, unknown>[] | null; count?: number | null; error: { message: string } | null }> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): AdminQuery;
  gte(column: string, value: string): AdminQuery;
  eq(column: string, value: string): AdminQuery;
  in(column: string, values: string[]): AdminQuery;
  order(column: string, options?: { ascending?: boolean }): AdminQuery;
  range(from: number, to: number): AdminQuery;
}
export interface AdminDataClient { from(table: string): AdminQuery }

const PAGE = 1000;
const MAX_ROWS = 20_000;
/** Messages are read through JSON paths so the dashboard never downloads message text or stored snapshots. */
const MESSAGE_COLUMNS = "conversation_id,direction,created_at,provider_message_id,state:metadata->coordinator_snapshot->>state,resolution:metadata->coordinator_snapshot->lastResolution->>status,category:metadata->coordinator_snapshot->lastRequest->>category,city:metadata->coordinator_snapshot->lastRequest->location->>city,delivery:metadata->delivery->>status";

export async function readAll(client: AdminDataClient, table: string, columns: string, narrow: (query: AdminQuery) => AdminQuery = (query) => query, orderBy = "created_at"): Promise<{ rows: Record<string, unknown>[]; truncated: boolean; failed: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await narrow(client.from(table).select(columns)).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { rows, truncated: false, failed: true };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, truncated: false, failed: false };
  }
  return { rows, truncated: true, failed: false };
}

async function countRows(client: AdminDataClient, table: string, narrow: (query: AdminQuery) => AdminQuery = (query) => query): Promise<number | null> {
  const { count, error } = await narrow(client.from(table).select("*", { count: "exact", head: true }));
  return error ? null : count ?? null;
}

/** Reads only what the dashboard aggregates. Nothing selected here carries message content or a phone number. */
export async function loadDashboardInput(client: AdminDataClient, now: Date, rangeStartIso: string, config: DashboardInput["config"]): Promise<DashboardInput> {
  const windowStart = new Date(localDayStart(now).getTime() - 29 * 86_400_000).toISOString();
  const [profiles, identities, conversations, messages, helpRequests, outcomes, contributions, recentEvents, preferenceEvents, inApp, communities] = await Promise.all([
    readAll(client, "profiles", "created_at,last_active_at"),
    readAll(client, "whatsapp_identities", "id,profile_id,created_at"),
    readAll(client, "conversations", "id,whatsapp_identity_id,profile_id,community_id,started_at,last_message_at,status", (query) => query, "started_at"),
    readAll(client, "conversation_messages", MESSAGE_COLUMNS, (query) => query.gte("created_at", windowStart)),
    readAll(client, "help_requests", "status,community_consent_at,created_at,requested_category,area"),
    readAll(client, "help_request_outcomes", "useful_answer_confirmed,match_confirmed,resolved_at,recorded_at", (query) => query, "recorded_at"),
    readAll(client, "contributions", "verification_status,created_at,category"),
    readAll(client, "connect_runtime_events", "id,name,occurred_at,correlation_id,attributes", (query) => query.gte("occurred_at", windowStart), "occurred_at"),
    readAll(client, "connect_runtime_events", "id,name,occurred_at,correlation_id,attributes", (query) => query.eq("name", "notification_dispatched"), "occurred_at"),
    readAll(client, "notifications", "type,created_at,read_at", (query) => query.gte("created_at", windowStart)),
    readAll(client, "communities", "id,name,city", (query) => query, "created_at"),
  ]);
  const [businesses, knowledgeRecords, businessUpdates, agentAssignments, businessesInRange] = await Promise.all([
    countRows(client, "businesses"), countRows(client, "knowledge_records"), countRows(client, "business_information_updates"), countRows(client, "trust_agent_assignments"),
    countRows(client, "businesses", (query) => query.gte("created_at", rangeStartIso)),
  ]);

  const eventsById = new Map<string, EventRow>();
  for (const row of [...recentEvents.rows, ...preferenceEvents.rows]) eventsById.set(String(row.id), row as unknown as EventRow);
  return {
    profiles: profiles.rows, identities: identities.rows as never, conversations: conversations.rows as never, messages: messages.rows as unknown as MessageRow[],
    helpRequests: helpRequests.rows, outcomes: outcomes.rows, contributions: contributions.rows, events: [...eventsById.values()],
    inAppNotifications: inApp.rows, communities: communities.rows as unknown as CommunityRow[],
    totals: { businesses, knowledgeRecords, businessUpdates, agentAssignments, businessesCreatedInRange: businessesInRange },
    config,
    truncated: [profiles, identities, conversations, messages, helpRequests, contributions, recentEvents].some((result) => result.truncated),
  };
}
