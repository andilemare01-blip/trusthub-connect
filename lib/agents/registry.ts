import type { AgentAssignment, AgentAvailability, AgentCoverage, TrustAgent } from "@/types/agent";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`TrustAgentRegistry.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Registry of operational Trust Agents — explicitly distinct from TrustHub's existing `referral_partners` (marketing referrals). Does not modify `admin_users`. */
export interface TrustAgentRegistry {
  listCoverage(communityKey: string, category: string | null): Promise<AgentCoverage[]>;
  getAvailability(agentId: string): Promise<AgentAvailability | null>;
  assign(assignment: Omit<AgentAssignment, "id" | "assignedAt" | "status">): Promise<AgentAssignment>;
  getAgent(agentId: string): Promise<TrustAgent | null>;
}

class NotConnectedTrustAgentRegistry implements TrustAgentRegistry {
  async listCoverage(): Promise<AgentCoverage[]> {
    throw new NotConnectedError("listCoverage");
  }

  async getAvailability(): Promise<AgentAvailability | null> {
    throw new NotConnectedError("getAvailability");
  }

  async assign(): Promise<AgentAssignment> {
    throw new NotConnectedError("assign");
  }

  async getAgent(): Promise<TrustAgent | null> {
    throw new NotConnectedError("getAgent");
  }
}

/** TODO: implement once the Trust Agent role-storage mechanism (Section 14/21) is designed and approved. */
export function createTrustAgentRegistry(): TrustAgentRegistry {
  return new NotConnectedTrustAgentRegistry();
}
