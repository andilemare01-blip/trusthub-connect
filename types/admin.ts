/**
 * Admin authorization types for TrustHub Connect.
 *
 * NOT a confirmed database schema and NOT a working authorization system.
 * `admin_users` is VERIFIED to currently have only `user_id` (primary key)
 * and `created_at` — no role column. These types describe the eventual
 * shape once a role-storage mechanism is designed and approved (see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 21). The current `/admin`
 * UI remains an explicitly non-production, unauthenticated skeleton.
 */

import type { AdminRoleName } from "./agent";

export interface AdminIdentity {
  trustHubProfileId: string;
  role: AdminRoleName;
}

export type Permission =
  | "view_dashboard"
  | "review_contributions"
  | "manage_agents"
  | "manage_launch_coverage";

export interface AuthorizationPolicy {
  role: AdminRoleName;
  permissions: Permission[];
}

export interface AdminContext {
  identity: AdminIdentity | null;
  isAuthorized: boolean;
}
