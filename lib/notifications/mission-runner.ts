import { checkEligibility, chooseMission, missionDedupeKey, type MissionGap, type MissionPolicy, type PreferenceLevel, type SkipReason } from "./community-missions.ts";

export interface MissionCandidate {
  identityId: string;
  /** E.164 number, used only to send and never stored in events or returned. */
  phone: string;
  preference: PreferenceLevel | null;
  sentAt: number[];
  askedKeys: string[];
  lastInboundAt: number | null;
}

export interface MissionDeps {
  now: () => number;
  policy: MissionPolicy;
  /** False means dry run: eligibility is evaluated and counted, but nothing is sent or recorded per person. */
  enabled: boolean;
  maxPerRun?: number;
  candidates(): Promise<MissionCandidate[]>;
  gaps(): Promise<MissionGap[]>;
  alreadyRecorded(dedupeKey: string): Promise<boolean>;
  send(phone: string, text: string, correlationId: string): Promise<void>;
  record(event: { identityId: string; dedupeKey: string; resultKey: string; status: "queued" | "accepted" | "failed"; mission: string; at: number }): Promise<void>;
  recordRun(summary: MissionRunSummary): Promise<void>;
}

export interface MissionRunSummary {
  dryRun: boolean;
  considered: number;
  eligible: number;
  /** Dry run: how many would be sent. Live run: how many the provider accepted. */
  sent: number;
  failed: number;
  duplicatesPrevented: number;
  skipped: Partial<Record<SkipReason, number>>;
}

const DEFAULT_MAX_PER_RUN = 50;

/** A queued marker is written before sending, so a retried or overlapping run cannot send the same mission twice. */
export async function runCommunityMissions(deps: MissionDeps): Promise<MissionRunSummary> {
  const summary: MissionRunSummary = { dryRun: !deps.enabled, considered: 0, eligible: 0, sent: 0, failed: 0, duplicatesPrevented: 0, skipped: {} };
  const skip = (reason: SkipReason) => { summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1; };
  const now = deps.now();
  const candidates = await deps.candidates();
  const gaps = await deps.gaps();
  const limit = deps.maxPerRun ?? DEFAULT_MAX_PER_RUN;
  for (const candidate of candidates) {
    summary.considered += 1;
    const eligibility = checkEligibility({ preference: candidate.preference, sentAt: candidate.sentAt, lastInboundAt: candidate.lastInboundAt, now, policy: deps.policy });
    if (!eligibility.ok) { skip(eligibility.reason); continue; }
    const mission = chooseMission(gaps, new Set(candidate.askedKeys));
    if (!mission) { skip("no_mission"); continue; }
    summary.eligible += 1;
    const dedupeKey = missionDedupeKey(candidate.identityId, now, deps.policy, mission.key);
    if (await deps.alreadyRecorded(dedupeKey)) { summary.duplicatesPrevented += 1; continue; }
    if (summary.sent + summary.failed >= limit) { skip("daily_limit"); continue; }
    if (!deps.enabled) { summary.sent += 1; continue; }
    await deps.record({ identityId: candidate.identityId, dedupeKey, resultKey: `${dedupeKey}:result`, status: "queued", mission: mission.key, at: now });
    try {
      await deps.send(candidate.phone, mission.message, dedupeKey);
      await deps.record({ identityId: candidate.identityId, dedupeKey, resultKey: `${dedupeKey}:result`, status: "accepted", mission: mission.key, at: deps.now() });
      summary.sent += 1;
    } catch {
      await deps.record({ identityId: candidate.identityId, dedupeKey, resultKey: `${dedupeKey}:result`, status: "failed", mission: mission.key, at: deps.now() });
      summary.failed += 1;
    }
  }
  await deps.recordRun(summary);
  return summary;
}
