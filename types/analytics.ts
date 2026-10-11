/**
 * Admin dashboard analytics types for TrustHub Connect.
 *
 * These are UI-facing label/key definitions only — not a database schema
 * and not wired to real aggregation queries yet (recon section K).
 */

export const DASHBOARD_METRIC_KEYS = [
  "Total Users",
  "New Sign-ups",
  "Active Users",
  "WhatsApp Conversations",
  "Service Requests",
  "Problems Solved",
  "Unanswered Requests",
  "Community Contributions",
  "Businesses / Services Added",
  "Successful Matches",
  "Time to Useful Answer",
] as const;

export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

export const DASHBOARD_COMMUNITY_KEYS = [
  "Harare",
  "Chinhoyi",
  "Other Communities",
] as const;

export type DashboardCommunityKey = (typeof DASHBOARD_COMMUNITY_KEYS)[number];

export const DASHBOARD_ACTIVITY_PANEL_KEYS = [
  "Community Demand",
  "Top Unanswered Requests",
  "Recent Contributions",
  "Recent Users",
  "Recent Problems Solved",
  "Agent Activity",
] as const;

export type DashboardActivityPanelKey =
  (typeof DASHBOARD_ACTIVITY_PANEL_KEYS)[number];

/**
 * Conceptual analytics contracts for future dashboard wiring. MVP metrics
 * derive from operational records (no separate analytics database) — see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 19.
 */
export interface MetricDefinition {
  key: string;
  label: string;
  /** Free-form description of which operational records this derives from. */
  derivedFrom: string;
}

export interface AnalyticsQuery {
  metricKey: string;
  communityKey: string | null;
  fromDate: string | null;
  toDate: string | null;
}

export interface CommunityMetric {
  communityKey: string;
  metricKey: string;
  value: number;
}

export interface DemandMetric {
  communityKey: string;
  category: string;
  requestCount: number;
  unansweredCount: number;
}

export interface OutcomeMetric {
  communityKey: string;
  problemsSolved: number;
  successfulMatches: number;
  averageTimeToUsefulAnswerSeconds: number | null;
}
