/**
 * Matching types for TrustHub Connect.
 *
 * NOT a confirmed database schema — agent/service-area matching does not
 * exist yet anywhere (TRUSTHUB_CONNECT_RECON.md section I).
 */

export type MatchCandidateType = "business" | "trust_agent";

/** Deterministic, rule-based inputs only — no ML ranking in the MVP. */
export interface MatchCriteria {
  category: string | null;
  country: string | null;
  city: string | null;
  area: string | null;
  communityKey: string | null;
}

export interface MatchCandidate {
  type: MatchCandidateType;
  id: string;
  displayName: string;
  score: number;
}

export type MatchOutcome = "successful" | "unsuccessful" | "pending";

export interface MatchResult {
  id: string;
  serviceRequestId: string;
  candidate: MatchCandidate;
  outcome: MatchOutcome;
  matchedAt: string;
  resolvedAt: string | null;
}
