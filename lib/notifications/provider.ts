export interface NotificationDispatch {
  recipientProfileId: string;
  type: "community_help_request" | "trust_agent_handoff" | "contribution_review";
  title: string;
  message: string;
  dedupeKey: string;
  communityId: string | null;
}

export interface NotificationDispatchResult { id: string; status: "accepted" | "duplicate"; acceptedAt: string; }
export interface NotificationProvider { dispatch(notification: NotificationDispatch): Promise<NotificationDispatchResult>; }

export class NotificationProviderUnavailableError extends Error {
  constructor() { super("Notification delivery is unavailable: no production notification provider is configured."); this.name = "NotificationProviderUnavailableError"; }
}

/** Local deterministic fake; it is not a live notification or WhatsApp sender. */
export class InMemoryNotificationProvider implements NotificationProvider {
  readonly dispatched: NotificationDispatch[] = [];
  private readonly byDedupeKey = new Map<string, NotificationDispatchResult>();
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) { this.now = now; }
  async dispatch(notification: NotificationDispatch): Promise<NotificationDispatchResult> {
    if (!notification.recipientProfileId || !notification.dedupeKey) throw new Error("Recipient and deduplication key are required.");
    const existing = this.byDedupeKey.get(notification.dedupeKey);
    if (existing) return { ...existing, status: "duplicate" };
    const result = { id: `notification-${this.byDedupeKey.size + 1}`, status: "accepted" as const, acceptedAt: this.now() };
    this.byDedupeKey.set(notification.dedupeKey, result);
    this.dispatched.push(structuredClone(notification));
    return result;
  }
}
