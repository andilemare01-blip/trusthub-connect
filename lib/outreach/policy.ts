import type { KnowledgeGap } from "@/types/knowledge";
import type { CommunityOutreach, OutreachPolicy, OutreachRecipient } from "@/types/outreach";

export interface OutreachRecipientHistory { profileId: string; optedIn: boolean; notifiedAt: string[]; }

export function planCommunityOutreach(input: {
  id: string; gap: KnowledgeGap; channel: CommunityOutreach["channel"]; message: string; createdAt: string;
}): CommunityOutreach {
  if (input.gap.status !== "open" && input.gap.status !== "outreach_in_progress") throw new Error("Outreach can only be planned for an open knowledge gap.");
  if (!input.message.trim() || !Number.isFinite(Date.parse(input.createdAt))) throw new Error("Outreach requires a message and valid creation timestamp.");
  return { id: input.id, knowledgeGapId: input.gap.id, channel: input.channel, message: input.message.trim(), status: "planned", createdAt: input.createdAt };
}

/** Returns policy decisions only; notification dispatch must remain a separate, consent-aware operation. */
export function evaluateOutreachRecipients(input: {
  outreachId: string; histories: OutreachRecipientHistory[]; policy: OutreachPolicy; now: string;
}): OutreachRecipient[] {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || input.policy.minIntervalHours < 0 || input.policy.maxPerWeek < 0 || !input.outreachId) throw new Error("Valid outreach policy, time and ID are required.");
  const weekAgo = now - 7 * 86_400_000;
  return input.histories.map((history) => {
    const recent = history.notifiedAt.map(Date.parse).filter((time) => Number.isFinite(time) && time <= now);
    const tooSoon = recent.some((time) => now - time < input.policy.minIntervalHours * 3_600_000);
    const weeklyLimitReached = recent.filter((time) => time >= weekAgo).length >= input.policy.maxPerWeek;
    const skipReason = !history.optedIn && input.policy.requiresOptIn ? "opted_out"
      : tooSoon ? "frequency_interval_not_elapsed"
      : weeklyLimitReached ? "weekly_limit_reached"
      : null;
    return {
      id: `${input.outreachId}:${history.profileId}`,
      outreachId: input.outreachId,
      trustHubProfileId: history.profileId,
      status: skipReason ? "skipped_policy" : "pending",
      skipReason,
      notifiedAt: null,
    };
  });
}
