/**
 * Launch/knowledge-coverage types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Represents "prepare the information
 * environment before large-scale distribution" (see
 * TRUSTHUB_CONNECT_FOUNDATION.md section P) — a city/community should not
 * launch into an empty knowledge base.
 */

export type LaunchStatus =
  | "pre_launch"
  | "building_coverage"
  | "ready"
  | "active"
  | "paused";

export interface LaunchCommunity {
  communityKey: string;
  displayName: string;
  status: LaunchStatus;
  updatedAt: string;
}

export interface CoverageCategory {
  category: string;
  knownProviderCount: number;
  knownBusinessCount: number;
  openKnowledgeGapCount: number;
}

export type CoverageStatus = "insufficient" | "developing" | "sufficient";

export interface KnowledgeCoverage {
  communityKey: string;
  categories: CoverageCategory[];
  overallStatus: CoverageStatus;
  evaluatedAt: string;
}

export interface LaunchReadiness {
  communityKey: string;
  ready: boolean;
  blockingReasons: string[];
  evaluatedAt: string;
}
