export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`NotificationGateway.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Read-model shape mirroring the existing, VERIFIED `public.notifications` table — column names confirmed, not a new schema. */
export interface ExistingNotification {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  dedupeKey: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * Reuse seam for TrustHub's existing `public.notifications` table — the
 * intended delivery mechanism for outreach (lib/outreach). Do NOT build a
 * second notification system unless this is proven insufficient (see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 26).
 */
export interface NotificationGateway {
  send(notification: Omit<ExistingNotification, "readAt" | "createdAt">): Promise<ExistingNotification>;
  listUnread(userId: string): Promise<ExistingNotification[]>;
}

class NotConnectedNotificationGateway implements NotificationGateway {
  async send(): Promise<ExistingNotification> {
    throw new NotConnectedError("send");
  }

  async listUnread(): Promise<ExistingNotification[]> {
    throw new NotConnectedError("listUnread");
  }
}

/** TODO: implement once table-level RLS/policy details for `notifications` are confirmed (IMPLEMENTATION_PREREQUISITES.md item 3). */
export function createNotificationGateway(): NotificationGateway {
  return new NotConnectedNotificationGateway();
}
