import type { SupabaseDataClient } from "../supabase/data-client.ts";
import { createRuntimeEventId } from "./events.ts";
import { SupabaseRuntimeEventRecorder } from "./supabase-recorder.ts";

export type OperationalKind = "duplicate_webhook" | "skipped_message" | "processing_failed" | "notification_preference" | "community_mission" | "community_mission_run" | "outbound_failed";
const NOTIFICATION_KINDS = new Set<OperationalKind>(["notification_preference", "community_mission", "community_mission_run"]);

/**
 * Operational facts the dashboard needs but no table stores. They reuse the existing runtime-event sink
 * (`inbound_normalized` for webhook facts, `notification_dispatched` for notification facts), so no schema change is needed.
 * Attributes carry only counts, stages and reason codes, never content, numbers or secrets.
 */
export async function recordOperationalEvent(client: SupabaseDataClient, input: {
  kind: OperationalKind;
  /** Stable per occurrence so a retry never records it twice. */
  sourceId: string;
  correlationId: string;
  at?: string;
  actor?: "system" | "user" | "provider";
  attributes?: Record<string, string | number | boolean | null>;
}): Promise<boolean> {
  const notification = NOTIFICATION_KINDS.has(input.kind);
  const name = notification ? "notification_dispatched" : "inbound_normalized";
  try {
    const id = createRuntimeEventId(name, `${input.kind}:${input.sourceId}`);
    await new SupabaseRuntimeEventRecorder(client).record({
      id, name, occurredAt: input.at ?? new Date().toISOString(), correlationId: input.correlationId.slice(0, 160), actor: input.actor ?? "system",
      entityType: notification ? "notification" : "conversation", entityId: id,
      attributes: { kind: input.kind, ...(input.attributes ?? {}) },
    });
    return true;
  } catch {
    // Observability must never break the user's reply.
    return false;
  }
}
