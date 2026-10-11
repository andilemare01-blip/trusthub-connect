import type { CommunityContribution, ProvenanceEvidence } from "@/types/contribution";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(
      `ProvenanceRecorder.${method} is not connected yet. No persistence has been configured for TrustHub Connect.`
    );
    this.name = "NotConnectedError";
  }
}

/**
 * Recording surface for community contributions and their supporting
 * evidence, modeled after TrustHub's existing `business_information_updates`
 * pattern (TRUSTHUB_CONNECT_RECON.md sections F and H).
 *
 * Must NOT be implemented against a live database until that is explicitly
 * approved.
 */
export interface ProvenanceRecorder {
  recordContribution(
    contribution: Omit<CommunityContribution, "id" | "createdAt" | "status">
  ): Promise<CommunityContribution>;
  attachEvidence(
    evidence: Omit<ProvenanceEvidence, "id" | "createdAt">
  ): Promise<ProvenanceEvidence>;
}

class NotConnectedProvenanceRecorder implements ProvenanceRecorder {
  async recordContribution(): Promise<CommunityContribution> {
    throw new NotConnectedError("recordContribution");
  }

  async attachEvidence(): Promise<ProvenanceEvidence> {
    throw new NotConnectedError("attachEvidence");
  }
}

/**
 * TODO: once persistence is approved, add a real implementation. Until
 * then this always returns the not-connected mock.
 */
export function createProvenanceRecorder(): ProvenanceRecorder {
  return new NotConnectedProvenanceRecorder();
}
