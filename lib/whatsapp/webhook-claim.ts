import { createRuntimeEventId } from "../observability/events.ts";

/** Longer than a slow AI answer takes, so a retry never overlaps the first attempt. */
export const CLAIM_WINDOW_MS = 90_000;

interface ClaimResult { data: unknown; error: { code?: string } | null }
interface ClaimClient {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<ClaimResult>;
    select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<ClaimResult> } };
  };
}

/**
 * Meta resends a message when our reply takes too long, and a slow AI answer can outlast its wait. The first attempt
 * claims the message, so a resend that arrives while it is still working stops here and the person gets one reply.
 * The id is unique, so two attempts can't both win. After the window a retry goes through, so a failed attempt can
 * still be recovered. Returns true when another attempt is already working. A failed claim never blocks a reply.
 */
export async function alreadyBeingAnswered(client: ClaimClient, providerMessageId: string, now = Date.now()): Promise<boolean> {
  try {
    const id = createRuntimeEventId("webhook_authenticated", `claim:${providerMessageId}`);
    const claimed = await client.from("connect_runtime_events").insert({
      id, name: "webhook_authenticated", occurred_at: new Date(now).toISOString(), correlation_id: "webhook-claim", actor: "provider",
      entity_type: "conversation", entity_id: id, attributes: { kind: "webhook_claim" },
    });
    if (claimed.error?.code !== "23505") return false;
    const found = await client.from("connect_runtime_events").select("occurred_at").eq("id", id).maybeSingle();
    const claimedAt = Date.parse(String((found.data as { occurred_at?: unknown } | null)?.occurred_at ?? ""));
    return Number.isFinite(claimedAt) && now - claimedAt < CLAIM_WINDOW_MS;
  } catch {
    return false;
  }
}
