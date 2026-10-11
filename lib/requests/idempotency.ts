import { createHash } from "node:crypto";
import type { MessageChannel } from "@/types/conversation";

/** Stable, non-reversible key for one source event; safe to persist without retaining the provider ID. */
export function createRequestIdempotencyKey(channel: MessageChannel, sourceEventId: string): string {
  const eventId = sourceEventId.trim();
  if (!eventId || eventId.length > 2048) throw new Error("A stable source event ID is required for request idempotency.");
  const digest = createHash("sha256").update(`${channel}\0${eventId}`, "utf8").digest("hex");
  return `${channel}:${digest}`;
}
