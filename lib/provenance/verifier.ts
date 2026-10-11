import type { KnowledgeClaim } from "@/types/knowledge";
import type { VerificationStatus } from "@/types/provenance";

export class VerifierNotConnectedError extends Error {
  constructor(method: string) {
    super(`KnowledgeVerifier.${method} is not connected yet. AI must never itself decide something is VERIFIED — this seam is for human/rule-based review only.`);
    this.name = "VerifierNotConnectedError";
  }
}

/** Reviews a knowledge claim and assigns/updates its verification status. Never automatic for the "verified" state. */
export interface KnowledgeVerifier {
  review(claim: KnowledgeClaim, decidedStatus: VerificationStatus, reviewerProfileId: string): Promise<KnowledgeClaim>;
}

class NotConnectedKnowledgeVerifier implements KnowledgeVerifier {
  async review(): Promise<KnowledgeClaim> {
    throw new VerifierNotConnectedError("review");
  }
}

/** TODO: implement once the knowledge-claim review workflow is designed and approved. */
export function createKnowledgeVerifier(): KnowledgeVerifier {
  return new NotConnectedKnowledgeVerifier();
}
