/**
 * Knowledge/knowledge-gap types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Represents the "TrustHub remembers"
 * half of the data flywheel (see docs/TRUSTHUB_CONNECT_FOUNDATION.md,
 * section V) — a searchable unit of community knowledge, and the gap
 * detected when no such knowledge exists yet.
 */

import type { Evidence, VerificationStatus } from "./provenance";

export type KnowledgeSubjectType =
  | "business"
  | "service_provider"
  | "capability"
  | "area_information"
  | "general";

/** A single, reusable unit of remembered knowledge. */
export interface KnowledgeItem {
  id: string;
  subjectType: KnowledgeSubjectType;
  subjectId: string | null;
  summary: string;
  verificationStatus: VerificationStatus;
  communityKey: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single assertion contributing to a KnowledgeItem, before/after review. */
export interface KnowledgeClaim {
  id: string;
  knowledgeItemId: string | null;
  claimText: string;
  evidence: Evidence[];
  verificationStatus: VerificationStatus;
  createdAt: string;
}

export type KnowledgeGapReason =
  | "repeated_question"
  | "repeated_service_request"
  | "unanswered_request"
  | "missing_provider_category"
  | "missing_business_information"
  | "missing_contact_information"
  | "missing_area_information";

export type KnowledgeGapStatus = "open" | "outreach_in_progress" | "resolved" | "abandoned";

export interface KnowledgeGap {
  id: string;
  reason: KnowledgeGapReason;
  category: string | null;
  communityKey: string | null;
  description: string;
  status: KnowledgeGapStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

/** Result of evaluating operational records for a possible knowledge gap. */
export interface GapDetectionResult {
  gapDetected: boolean;
  gap: KnowledgeGap | null;
  matchingKnowledgeItemId: string | null;
}

export interface GapResolution {
  gapId: string;
  resolvingKnowledgeItemId: string;
  resolvedAt: string;
}
