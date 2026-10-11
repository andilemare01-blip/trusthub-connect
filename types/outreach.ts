/**
 * Community outreach types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Represents the "targeted community
 * outreach" step of the knowledge-gap loop (see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 26). Delivery is intended
 * to reuse the existing, VERIFIED `public.notifications` table rather than
 * a second notification system — see lib/notifications.
 */

export type OutreachChannel = "whatsapp" | "notification" | "other";

export interface OutreachPolicy {
  /** Minimum time between outreach messages to the same recipient. */
  minIntervalHours: number;
  /** Maximum outreach messages a recipient may receive per week. */
  maxPerWeek: number;
  /** Recipient must be opted in to receive outreach at all. */
  requiresOptIn: true;
}

export type OutreachStatus = "planned" | "sent" | "responded" | "expired" | "cancelled";

export interface CommunityOutreach {
  id: string;
  knowledgeGapId: string;
  channel: OutreachChannel;
  message: string;
  status: OutreachStatus;
  createdAt: string;
}

export type OutreachRecipientStatus = "pending" | "notified" | "responded" | "skipped_policy";

/** A single person considered/contacted for a given outreach — must respect opt-in and dedupe/frequency rules. */
export interface OutreachRecipient {
  id: string;
  outreachId: string;
  trustHubProfileId: string;
  status: OutreachRecipientStatus;
  /** Why this recipient was skipped, if applicable (e.g. "opted_out", "frequency_limit_exceeded"). */
  skipReason: string | null;
  notifiedAt: string | null;
}

export interface OutreachResponse {
  id: string;
  outreachRecipientId: string;
  responseText: string;
  respondedAt: string;
}
