import type { MatchCandidate, MatchResult } from "@/types/matching";
import type { ServiceRequest } from "@/types/service-request";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(
      `MatchingEngine.${method} is not implemented yet. Matching logic and data sources have not been designed/approved.`
    );
    this.name = "NotConnectedError";
  }
}

/**
 * Agent/service-area and business matching surface.
 *
 * Does not exist anywhere in TrustHub today (TRUSTHUB_CONNECT_RECON.md
 * section I). This interface is a placeholder seam only — no matching
 * algorithm, scoring model, or data source has been designed or approved.
 */
export interface MatchingEngine {
  findCandidates(request: ServiceRequest): Promise<MatchCandidate[]>;
  recordMatchOutcome(match: MatchResult): Promise<void>;
}

class NotConnectedMatchingEngine implements MatchingEngine {
  async findCandidates(): Promise<MatchCandidate[]> {
    throw new NotConnectedError("findCandidates");
  }

  async recordMatchOutcome(): Promise<void> {
    throw new NotConnectedError("recordMatchOutcome");
  }
}

/**
 * TODO: implement once a matching design is proposed and approved. Until
 * then this always returns the not-connected mock.
 */
export function createMatchingEngine(): MatchingEngine {
  return new NotConnectedMatchingEngine();
}
