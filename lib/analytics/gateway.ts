import type { CommunityMetric, DemandMetric, OutcomeMetric } from "@/types/analytics";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`AnalyticsGateway.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Derives dashboard metrics from operational records — no separate analytics database (see Section 19/27). */
export interface AnalyticsGateway {
  getCommunityMetrics(communityKey: string): Promise<CommunityMetric[]>;
  getDemandMetrics(communityKey: string): Promise<DemandMetric[]>;
  getOutcomeMetrics(communityKey: string): Promise<OutcomeMetric | null>;
}

class NotConnectedAnalyticsGateway implements AnalyticsGateway {
  async getCommunityMetrics(): Promise<CommunityMetric[]> {
    throw new NotConnectedError("getCommunityMetrics");
  }

  async getDemandMetrics(): Promise<DemandMetric[]> {
    throw new NotConnectedError("getDemandMetrics");
  }

  async getOutcomeMetrics(): Promise<OutcomeMetric | null> {
    throw new NotConnectedError("getOutcomeMetrics");
  }
}

/** TODO: implement as read queries over ServiceRequest/CommunityContribution/MatchResult/Conversation once those schemas exist. */
export function createAnalyticsGateway(): AnalyticsGateway {
  return new NotConnectedAnalyticsGateway();
}
