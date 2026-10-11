import type { SupabaseDataClient } from "../supabase/data-client.ts";
import { requireRows } from "../supabase/data-client.ts";
import { createRuntimeEventId } from "../observability/events.ts";
import { SupabaseRuntimeEventRecorder } from "../observability/supabase-recorder.ts";

/** Agreed commercial rule: three free completed search tasks per persistent identity. */
export const FREE_SEARCH_TASKS = 3;

export interface SearchTaskLedger {
  /** Idempotent per (identity, task): recording the same task twice never counts it twice. */
  recordCompleted(entry: { identityId: string; taskId: string; at: string }): Promise<void>;
  completedCount(identityId: string): Promise<number>;
}

export interface UsageStatus {
  completedTasks: number;
  freeTasksAllowed: number;
  freeTasksUsed: number;
  freeTasksRemaining: number;
  /** Completed tasks beyond the free allowance; no purchase flow exists yet, so these are not charged or blocked. */
  tasksBeyondFreeAllowance: number;
  /** Always 0 until a verified payment source exists; credits are never granted from an unverified claim. */
  purchasedCreditsRemaining: 0;
}

export function usageStatusFrom(completedTasks: number): UsageStatus {
  const used = Math.min(completedTasks, FREE_SEARCH_TASKS);
  return {
    completedTasks, freeTasksAllowed: FREE_SEARCH_TASKS, freeTasksUsed: used, freeTasksRemaining: FREE_SEARCH_TASKS - used,
    tasksBeyondFreeAllowance: Math.max(0, completedTasks - FREE_SEARCH_TASKS), purchasedCreditsRemaining: 0,
  };
}

export class InMemorySearchTaskLedger implements SearchTaskLedger {
  private readonly tasks = new Set<string>();
  async recordCompleted(entry: { identityId: string; taskId: string }): Promise<void> { this.tasks.add(`${entry.identityId}\0${entry.taskId}`); }
  async completedCount(identityId: string): Promise<number> { return [...this.tasks].filter((key) => key.startsWith(`${identityId}\0`)).length; }
}

const TASK_EVENT = "answer_resolved";
const PAGE_LIMIT = 1000;

/**
 * Interim storage in the existing `connect_runtime_events` sink (no schema change): one row per
 * completed task, keyed by a stable event id, grouped by `identity:<whatsapp_identities.id>`.
 * Usage is bound to the persistent identity, never to the assistant name.
 */
export class RuntimeEventSearchTaskLedger implements SearchTaskLedger {
  private readonly client: SupabaseDataClient;
  constructor(client: SupabaseDataClient) { this.client = client; }

  async recordCompleted(entry: { identityId: string; taskId: string; at: string }): Promise<void> {
    await new SupabaseRuntimeEventRecorder(this.client).record({
      id: createRuntimeEventId(TASK_EVENT, `task:${entry.identityId}:${entry.taskId}`),
      name: TASK_EVENT, occurredAt: entry.at, correlationId: `identity:${entry.identityId}`, actor: "system",
      entityType: "conversation", entityId: entry.taskId.slice(0, 160),
      attributes: { kind: "search_task_completed" },
    });
  }

  async completedCount(identityId: string): Promise<number> {
    const result = await this.client.from("connect_runtime_events").select("attributes")
      .eq("name", TASK_EVENT).eq("correlation_id", `identity:${identityId}`).limit(PAGE_LIMIT);
    return requireRows<{ attributes: unknown }>(result, "Count completed search tasks")
      .filter((row) => row.attributes && typeof row.attributes === "object" && (row.attributes as Record<string, unknown>).kind === "search_task_completed").length;
  }
}
