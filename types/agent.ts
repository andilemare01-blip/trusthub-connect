/**
 * Trust Agent network types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Trust Agents are explicitly distinct
 * from TrustHub's existing `referral_partners` (marketing referrals) — see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 14. `admin_users` is not
 * modified by these types; role storage mechanism is still undecided.
 */

export type AdminRoleName = "OWNER" | "TRUST_AGENT";

export interface TrustAgent {
  id: string;
  trustHubProfileId: string;
  role: AdminRoleName;
  createdAt: string;
}

export interface AgentCoverage {
  agentId: string;
  communityKey: string;
  category: string | null;
}

export interface AgentAvailability {
  agentId: string;
  isAvailable: boolean;
  /** Optional free-text note, e.g. "back Monday". */
  note: string | null;
  updatedAt: string;
}

export type AgentAssignmentStatus = "assigned" | "accepted" | "declined" | "completed";

export interface AgentAssignment {
  id: string;
  agentId: string;
  serviceRequestId: string;
  status: AgentAssignmentStatus;
  assignedAt: string;
}
