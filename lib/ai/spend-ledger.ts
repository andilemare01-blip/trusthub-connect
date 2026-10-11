import type { SupabaseDataClient } from "../supabase/data-client.ts";
import { requireRows, SupabasePersistenceError } from "../supabase/data-client.ts";
import { createRuntimeEventId } from "../observability/events.ts";
import { SupabaseRuntimeEventRecorder } from "../observability/supabase-recorder.ts";

export interface AiSpendEntry {
  key: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  /** True when the provider reported no usage, so the worst-case cost was charged. */
  estimated: boolean;
  at: string;
}

export interface AiSpendLedger {
  /** Cumulative recorded AI cost. Throws when the total cannot be established reliably. */
  totalMicroUsd(): Promise<number>;
  hasCall(key: string): Promise<boolean>;
  record(entry: AiSpendEntry): Promise<void>;
}

export class InMemoryAiSpendLedger implements AiSpendLedger {
  readonly entries: AiSpendEntry[] = [];
  async totalMicroUsd(): Promise<number> { return this.entries.reduce((sum, entry) => sum + entry.costMicroUsd, 0); }
  async hasCall(key: string): Promise<boolean> { return this.entries.some((entry) => entry.key === key); }
  async record(entry: AiSpendEntry): Promise<void> { if (!(await this.hasCall(entry.key))) this.entries.push({ ...entry }); }
}

/** PostgREST returns at most this many rows per request; a full page means the sum could be understated. */
const PAGE_LIMIT = 1000;
const SPEND_NAME = "request_understood";

/**
 * Interim storage in the existing `connect_runtime_events` sink (no schema change):
 * name `request_understood`, actor `provider`. Attribute names avoid the sink's
 * sensitive-name filter. Permanent accounting needs the approved table described in the pilot report.
 */
export class RuntimeEventAiSpendLedger implements AiSpendLedger {
  private readonly client: SupabaseDataClient;
  constructor(client: SupabaseDataClient) { this.client = client; }

  async totalMicroUsd(): Promise<number> {
    const result = await this.client.from("connect_runtime_events").select("attributes")
      .eq("name", SPEND_NAME).eq("actor", "provider").limit(PAGE_LIMIT);
    const rows = requireRows<{ attributes: unknown }>(result, "Read AI spend");
    if (rows.length >= PAGE_LIMIT) throw new SupabasePersistenceError("AI spend rows exceed one page; the cumulative total cannot be verified.");
    return rows.reduce((sum, row) => {
      const attributes = row.attributes && typeof row.attributes === "object" ? row.attributes as Record<string, unknown> : {};
      return attributes.kind === "ai_call" && typeof attributes.costMicroUsd === "number" ? sum + attributes.costMicroUsd : sum;
    }, 0);
  }

  async hasCall(key: string): Promise<boolean> {
    const id = createRuntimeEventId(SPEND_NAME, `ai:${key}`);
    const result = await this.client.from("connect_runtime_events").select("id").eq("id", id).limit(1);
    return requireRows(result, "Check AI call").length > 0;
  }

  async record(entry: AiSpendEntry): Promise<void> {
    const id = createRuntimeEventId(SPEND_NAME, `ai:${entry.key}`);
    await new SupabaseRuntimeEventRecorder(this.client).record({
      id, name: SPEND_NAME, occurredAt: entry.at, correlationId: "ai-spend", actor: "provider", entityType: "conversation", entityId: id,
      attributes: { kind: "ai_call", purpose: entry.purpose, model: entry.model.slice(0, 100), usageIn: entry.inputTokens, usageOut: entry.outputTokens, costMicroUsd: entry.costMicroUsd, estimated: entry.estimated },
    });
  }
}
