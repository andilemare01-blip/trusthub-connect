/**
 * WhatsApp conversation/message types for TrustHub Connect.
 *
 * NOT a confirmed database schema — none of this exists yet anywhere
 * (TRUSTHUB_CONNECT_RECON.md section I). These types exist only so the
 * WhatsApp/AI interfaces have a concrete shape to reference.
 */

/**
 * Generalized channel a message travelled over. WhatsApp is only the first
 * channel — the core Conversation/ConversationMessage model must not be
 * WhatsApp-specific.
 */
export type MessageChannel = "whatsapp" | "web" | "admin" | "system";

/** Channel values match Migration 001's conversations.channel constraint. */
export type ConversationChannel = MessageChannel;

export type ConversationStatus =
  | "open"
  | "awaiting_agent"
  | "resolved"
  | "abandoned";

export interface Conversation {
  id: string;
  channel: ConversationChannel;
  /** SQL permits NULL for non-WhatsApp conversations and provisional sessions. */
  whatsAppIdentityId: string | null;
  trustHubProfileId: string | null;
  status: ConversationStatus;
  communityKey: string | null;
  /** UUID reference in persistence; communityKey remains a request/location key. */
  communityId?: string | null;
  area?: string | null;
  startedAt: string;
  lastMessageAt: string;
}

export type MessageDirection = "inbound" | "outbound";

export type MessageSender = "user" | "ai_agent" | "trust_agent" | "system";

export interface ConversationMessage {
  id: string;
  conversationId: string;
  channel: MessageChannel;
  direction: MessageDirection;
  sender: MessageSender;
  text: string;
  createdAt: string;
  providerMessageId?: string;
  metadata?: Record<string, unknown>;
}

