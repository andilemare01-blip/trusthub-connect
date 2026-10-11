import type { ResolutionResult, SourceKind } from "@/lib/answer-resolution/types";
import type { EvidenceItem } from "@/lib/answer-resolution/types";

/** A response is grounded in the exact resolver result supplied to its generator. */
export interface GeneratedAnswer {
  text: string;
  evidenceIds: string[];
  provenance: SourceKind[];
  confidence: ResolutionResult["confidence"];
  uncertainty: string | null;
}

export interface AnswerGenerator { generate(resolution: ResolutionResult): Promise<GeneratedAnswer>; }
export type AnswerEvidence = EvidenceItem;
