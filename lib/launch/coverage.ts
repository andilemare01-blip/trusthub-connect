import type { KnowledgeCoverage, LaunchCommunity, LaunchReadiness } from "@/types/launch";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`LaunchCoverageTracker.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/**
 * Tracks whether a city/community has enough known businesses, providers,
 * and resolved knowledge gaps to launch responsibly — "TrustHub should
 * launch communities with useful knowledge, not merely with a functioning
 * chatbot." Same mechanism for Harare, Chinhoyi, and future communities.
 */
export interface LaunchCoverageTracker {
  getCommunityStatus(communityKey: string): Promise<LaunchCommunity | null>;
  evaluateCoverage(communityKey: string): Promise<KnowledgeCoverage>;
  evaluateReadiness(communityKey: string): Promise<LaunchReadiness>;
}

class NotConnectedLaunchCoverageTracker implements LaunchCoverageTracker {
  async getCommunityStatus(): Promise<LaunchCommunity | null> {
    throw new NotConnectedError("getCommunityStatus");
  }

  async evaluateCoverage(): Promise<KnowledgeCoverage> {
    throw new NotConnectedError("evaluateCoverage");
  }

  async evaluateReadiness(): Promise<LaunchReadiness> {
    throw new NotConnectedError("evaluateReadiness");
  }
}

/** TODO: implement once the knowledge-coverage data sources (businesses, providers, knowledge gaps per community) are approved. */
export function createLaunchCoverageTracker(): LaunchCoverageTracker {
  return new NotConnectedLaunchCoverageTracker();
}
