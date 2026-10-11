import type { SupabaseDataClient } from "../supabase/data-client.ts";
import type { TrustHubClient } from "../trusthub/client";
import { readAll, loadDashboardInput, type AdminDataClient } from "../admin/dashboard-data.ts";
import { buildDashboard, latestPreferences, type EventRow } from "../admin/metrics.ts";
import { createRuntimeEventId } from "../observability/events.ts";
import { recordOperationalEvent } from "../observability/operational-events.ts";
import { tryNormalizePhoneNumber } from "../identity/phone-number.ts";
import type { MissionCandidate, MissionDeps } from "./mission-runner.ts";
import type { MissionPolicy } from "./community-missions.ts";

const MAX_CANDIDATES = 200;
const THIRTY_DAYS = 30 * 86_400_000;

export interface MissionDataSources {
  reader: AdminDataClient;
  writer: SupabaseDataClient;
  trust: Pick<TrustHubClient, "searchBusinesses">;
  send(phone: string, text: string, correlationId: string): Promise<void>;
  policy: MissionPolicy;
  enabled: boolean;
  now?: () => number;
}

/** Builds the real dependencies for the mission runner from Supabase and the WhatsApp provider. */
export function createMissionDeps(sources: MissionDataSources): MissionDeps {
  const now = sources.now ?? Date.now;
  return {
    now, policy: sources.policy, enabled: sources.enabled,
    async candidates() {
      const eventRows = (await readAll(sources.reader, "connect_runtime_events", "id,name,occurred_at,correlation_id,attributes", (query) => query.eq("name", "notification_dispatched"), "occurred_at")).rows as unknown as EventRow[];
      const optedIn = [...latestPreferences(eventRows)].filter(([, value]) => value.level === "on" || value.level === "reduced").slice(0, MAX_CANDIDATES);
      if (!optedIn.length) return [];
      const ids = optedIn.map(([id]) => id);
      const [{ data: identities }, { data: conversations }] = await Promise.all([
        sources.reader.from("whatsapp_identities").select("id,phone_number").in("id", ids),
        sources.reader.from("conversations").select("id,whatsapp_identity_id").in("whatsapp_identity_id", ids),
      ]);
      const owner = new Map((conversations ?? []).map((row) => [String(row.id), String(row.whatsapp_identity_id)]));
      const { data: inbound } = owner.size
        ? await sources.reader.from("conversation_messages").select("conversation_id,created_at").in("conversation_id", [...owner.keys()]).eq("direction", "inbound").order("created_at", { ascending: false }).range(0, 999)
        : { data: [] as Record<string, unknown>[] };
      const lastInbound = new Map<string, number>();
      for (const row of inbound ?? []) {
        const identity = owner.get(String(row.conversation_id));
        const at = Date.parse(String(row.created_at));
        if (identity && Number.isFinite(at)) lastInbound.set(identity, Math.max(lastInbound.get(identity) ?? 0, at));
      }
      const phones = new Map((identities ?? []).map((row) => [String(row.id), tryNormalizePhoneNumber(String(row.phone_number ?? ""))]));
      const result: MissionCandidate[] = [];
      for (const [id, preference] of optedIn) {
        const phone = phones.get(id);
        if (!phone) continue;
        const queued = eventRows.filter((event) => event.correlation_id === `identity:${id}` && event.attributes?.kind === "community_mission" && event.attributes?.status === "queued" && now() - Date.parse(String(event.occurred_at)) <= THIRTY_DAYS);
        result.push({
          identityId: id, phone, preference: preference.level as MissionCandidate["preference"],
          sentAt: queued.map((event) => Date.parse(String(event.occurred_at))).filter(Number.isFinite),
          askedKeys: queued.map((event) => String(event.attributes?.mission ?? "")).filter(Boolean),
          lastInboundAt: lastInbound.get(id) ?? null,
        });
      }
      return result;
    },
    async gaps() {
      const at = new Date(now());
      const dashboard = buildDashboard(await loadDashboardInput(sources.reader, at, new Date(at.getTime() - THIRTY_DAYS).toISOString(), { missionsEnabled: sources.enabled, cronSecretConfigured: true, cronConfigured: true }), "30d", at);
      return Promise.all(dashboard.community.dataGaps.slice(0, 8).map(async (gap) => {
        let listed: number | null = null;
        try { listed = (await sources.trust.searchBusinesses({ text: gap.category, intent: null, category: gap.category, location: { country: "Zimbabwe", city: gap.city }, questionType: "business_discovery" })).length; } catch { listed = null; }
        return { category: gap.category, city: gap.city, requests: gap.requests, listed };
      }));
    },
    async alreadyRecorded(dedupeKey) {
      const { data } = await sources.reader.from("connect_runtime_events").select("id").eq("id", createRuntimeEventId("notification_dispatched", `community_mission:${dedupeKey}`)).range(0, 0);
      return (data ?? []).length > 0;
    },
    send: sources.send,
    async record(event) {
      await recordOperationalEvent(sources.writer, {
        kind: "community_mission", sourceId: event.status === "queued" ? event.dedupeKey : event.resultKey, correlationId: `identity:${event.identityId}`,
        at: new Date(event.at).toISOString(), actor: "system", attributes: { status: event.status, mission: event.mission.slice(0, 120) },
      });
    },
    async recordRun(summary) {
      await recordOperationalEvent(sources.writer, {
        kind: "community_mission_run", sourceId: `run:${new Date(now()).toISOString().slice(0, 16)}`, correlationId: "community-missions", at: new Date(now()).toISOString(), actor: "system",
        attributes: { dryRun: summary.dryRun, considered: summary.considered, eligible: summary.eligible, sent: summary.sent, failed: summary.failed, duplicates: summary.duplicatesPrevented },
      });
    },
  };
}
