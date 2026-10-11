import type { AgentAssignment, AgentAssignmentStatus } from "@/types/agent";
import type { ServiceRequest } from "@/types/service-request";
import { rankTrustAgentCandidates, type AgentMatchProfile } from "./matching.ts";

export interface TrustAgentHandoffProvider {
  requestHandoff(input: { serviceRequestId: string; agentId: string; communityKey: string }): Promise<AgentAssignment>;
  getStatus(assignmentId: string): Promise<AgentAssignmentStatus | null>;
  acknowledge?(assignmentId: string, status: Extract<AgentAssignmentStatus, "accepted" | "declined" | "completed">): Promise<void>;
}

export type AgentHandoffResult =
  | { status: "consent_required"; assignment: null }
  | { status: "no_eligible_agent"; assignment: null }
  | { status: "requested"; assignment: AgentAssignment };

/** Consent-first, exact-community dispatch orchestration over injected agent and handoff providers. */
export async function requestTrustAgentHandoff(input: {
  request: ServiceRequest;
  consentGiven: boolean;
  candidates: AgentMatchProfile[];
  provider: TrustAgentHandoffProvider;
}): Promise<AgentHandoffResult> {
  if (!input.consentGiven) return { status: "consent_required", assignment: null };
  const candidate = rankTrustAgentCandidates(input.request, input.candidates)[0];
  if (!candidate || !input.request.communityKey) return { status: "no_eligible_agent", assignment: null };
  const assignment = await input.provider.requestHandoff({
    serviceRequestId: input.request.id,
    agentId: candidate.id,
    communityKey: input.request.communityKey,
  });
  return { status: "requested", assignment };
}

/** Test double only; status acknowledgement is explicit and no agent is contacted. */
export class InMemoryTrustAgentHandoffProvider implements TrustAgentHandoffProvider {
  readonly requests: { serviceRequestId: string; agentId: string; communityKey: string }[] = [];
  private readonly assignments = new Map<string, AgentAssignment>();
  private readonly now: () => string;
  constructor(now: () => string = () => new Date().toISOString()) { this.now = now; }
  async requestHandoff(input: { serviceRequestId: string; agentId: string; communityKey: string }): Promise<AgentAssignment> {
    const existing = [...this.assignments.values()].find((item) => item.serviceRequestId === input.serviceRequestId);
    if (existing) return structuredClone(existing);
    this.requests.push(structuredClone(input));
    const assignment: AgentAssignment = { id: `assignment-${this.assignments.size + 1}`, agentId: input.agentId, serviceRequestId: input.serviceRequestId, status: "assigned", assignedAt: this.now() };
    this.assignments.set(assignment.id, assignment);
    return structuredClone(assignment);
  }
  async getStatus(assignmentId: string): Promise<AgentAssignmentStatus | null> { return this.assignments.get(assignmentId)?.status ?? null; }
  async acknowledge(assignmentId: string, status: Extract<AgentAssignmentStatus, "accepted" | "declined" | "completed">): Promise<void> {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new Error("Trust Agent assignment was not found.");
    this.assignments.set(assignmentId, { ...assignment, status });
  }
}
