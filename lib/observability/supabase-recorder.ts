import type { TrustHubRuntimeEvent } from "@/types/runtime-event";
import { validateRuntimeEvent, type RuntimeEventRecorder } from "./events.ts";
import { SupabasePersistenceError, type SupabaseDataClient } from "../supabase/data-client.ts";

/** Persists only events that pass the existing privacy and shape validator. */
export class SupabaseRuntimeEventRecorder implements RuntimeEventRecorder {
  private readonly client: SupabaseDataClient;
  constructor(client: SupabaseDataClient) { this.client = client; }

  async record(event: TrustHubRuntimeEvent): Promise<void> {
    const valid = validateRuntimeEvent(event);
    const result = await this.client.from("connect_runtime_events").upsert({
      id: valid.id,
      name: valid.name,
      occurred_at: valid.occurredAt,
      correlation_id: valid.correlationId,
      actor: valid.actor,
      entity_type: valid.entityType,
      entity_id: valid.entityId,
      attributes: valid.attributes,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (result.error) throw new SupabasePersistenceError("Persist Connect runtime event: " + result.error.message, result.error.code);
  }
}
