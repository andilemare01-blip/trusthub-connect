import type { MessageChannel } from "../../types/conversation";
import type { TurnResult } from "./types";

export type PersistedConversationStatus = "open" | "awaiting_agent" | "resolved" | "abandoned";

/** Migration 001 uses a bigint identity. Keep it a decimal string in TypeScript/JSON to avoid JS precision loss. */
export function requireDatabaseBigintId(value: string, field: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${field} must be a positive bigint ID serialized as a decimal string.`);
  return value;
}

/** communities.id and businesses.id are UUIDs, unlike profile/conversation IDs. */
export function requireDatabaseUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
  return value;
}

/** Engine state remains richer than the SQL status column; unresolved is an open request, not a solved conversation. */
export function toPersistedConversationStatus(state: TurnResult["state"]): PersistedConversationStatus {
  if (state === "waiting_for_agent") return "awaiting_agent";
  if (state === "resolved") return "resolved";
  if (state === "abandoned") return "abandoned";
  return "open";
}

/** Explicit mapping to Migration 001's snake_case columns; no communityKey-to-UUID guessing is allowed. */
export interface ConversationPersistenceReferences {
  channel: MessageChannel;
  whatsappIdentityId: string | null;
  profileId: string | null;
  communityId: string | null;
  area: string | null;
}

export function mapTurnToConversationRow(turn: TurnResult, references: ConversationPersistenceReferences) {
  return {
    id: requireDatabaseBigintId(turn.conversationId, "conversations.id"),
    channel: references.channel,
    whatsapp_identity_id: references.whatsappIdentityId ? requireDatabaseBigintId(references.whatsappIdentityId, "whatsapp_identities.id") : null,
    profile_id: references.profileId ? requireDatabaseBigintId(references.profileId, "profiles.id") : null,
    community_id: references.communityId ? requireDatabaseUuid(references.communityId, "communities.id") : null,
    area: references.area,
    status: toPersistedConversationStatus(turn.state),
    last_message_at: turn.conversation.updatedAt,
  };
}

export function mapTurnToMessageMetadata(turn: TurnResult) {
  return {
    coordinator_state: turn.state,
    coordinator_action: turn.action,
    resolution: turn.resolution,
    transitions: turn.conversation.transitions,
  };
}

export function mapTurnToConversationMessageRow(turn: TurnResult, index: number) {
  const message = turn.conversation.messages[index];
  if (!message) throw new Error(`conversation message index ${index} does not exist.`);
  return {
    conversation_id: requireDatabaseBigintId(turn.conversationId, "conversation_messages.conversation_id"),
    channel: message.channel,
    direction: message.direction,
    sender: message.sender,
    content: message.text,
    // The runtime-local ID is the append-deduplication key and the provider ID
    // backs webhook-retry idempotency; both must be present for the same
    // row shape the persistence repository writes.
    metadata: { ...mapTurnToMessageMetadata(turn), runtime_local_id: message.id },
    provider_message_id: message.providerMessageId ?? null,
    created_at: message.createdAt,
  };
}
