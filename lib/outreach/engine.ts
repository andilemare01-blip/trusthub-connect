import type { CommunityOutreach, OutreachRecipient, OutreachResponse } from "@/types/outreach";
import type { KnowledgeGap } from "@/types/knowledge";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`OutreachEngine.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/**
 * Plans and tracks targeted, consent-aware community outreach for a
 * knowledge gap. Delivery should route through lib/notifications (reusing
 * the existing `public.notifications` table) rather than a new channel.
 * Must respect opt-in, frequency limits, and deduplication — never spam
 * someone just because they were mentioned before.
 */
export interface OutreachEngine {
  planOutreach(gap: KnowledgeGap): Promise<CommunityOutreach>;
  selectRecipients(outreach: CommunityOutreach): Promise<OutreachRecipient[]>;
  recordResponse(response: Omit<OutreachResponse, "id">): Promise<OutreachResponse>;
}

class NotConnectedOutreachEngine implements OutreachEngine {
  async planOutreach(): Promise<CommunityOutreach> {
    throw new NotConnectedError("planOutreach");
  }

  async selectRecipients(): Promise<OutreachRecipient[]> {
    throw new NotConnectedError("selectRecipients");
  }

  async recordResponse(): Promise<OutreachResponse> {
    throw new NotConnectedError("recordResponse");
  }
}

/** TODO: implement once opt-in tracking and the outreach schema are designed and approved. */
export function createOutreachEngine(): OutreachEngine {
  return new NotConnectedOutreachEngine();
}
