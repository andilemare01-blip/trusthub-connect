import type { GapDetectionResult, KnowledgeGap, KnowledgeItem } from "@/types/knowledge";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`KnowledgeGateway.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Searches remembered TrustHub knowledge and detects gaps when nothing confident is found. AI may help classify results but must not decide something is verified. */
export interface KnowledgeGateway {
  search(query: string, communityKey: string | null): Promise<KnowledgeItem[]>;
  detectGap(query: string, communityKey: string | null): Promise<GapDetectionResult>;
  recordGap(gap: Omit<KnowledgeGap, "id" | "detectedAt" | "status" | "resolvedAt">): Promise<KnowledgeGap>;
}

class NotConnectedKnowledgeGateway implements KnowledgeGateway {
  async search(): Promise<KnowledgeItem[]> {
    throw new NotConnectedError("search");
  }

  async detectGap(): Promise<GapDetectionResult> {
    throw new NotConnectedError("detectGap");
  }

  async recordGap(): Promise<KnowledgeGap> {
    throw new NotConnectedError("recordGap");
  }
}

/** TODO: implement once the knowledge/knowledge-gap schema is designed and approved. */
export function createKnowledgeGateway(): KnowledgeGateway {
  return new NotConnectedKnowledgeGateway();
}
