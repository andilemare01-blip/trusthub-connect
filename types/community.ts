/**
 * Community/location types for TrustHub Connect.
 *
 * NOT a confirmed database schema for anything new. IMPORTANT CORRECTION:
 * a live, read-only Supabase inspection (reported by the project owner)
 * VERIFIED that the existing TrustHub database already has a real
 * `public.communities` table (columns: `id, name, city, country,
 * description, latitude, longitude, created_at` — currently ZERO rows, NO
 * `area` column), plus `community_members`, `community_posts`,
 * `post_comments`, `post_reactions`, and `help_requests`. TrustHub Connect
 * must NOT build a second/competing community architecture — see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 5 and
 * docs/TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md. The exact column-level
 * schema of the related tables (`community_members`, `community_posts`,
 * etc.) is still unverified, so those reference shapes remain minimal.
 */

export interface CommunityLocation {
  country: string;
  province: string;
  city: string;
  area: string;
  communityKey: string;
}

function normalisePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derives a stable `country:city:area` key. Province is intentionally excluded. */
export function createCommunityKey(
  country: unknown,
  city: unknown,
  area: unknown
): string {
  return [country, city, area]
    .map(normalisePart)
    .filter(Boolean)
    .join(":");
}

/**
 * Same convention as `createCommunityKey`, but tolerant of a missing
 * `area` — resolves to a valid city-level key so a user/business with an
 * unknown area can still fully participate at city/community level.
 */
export function createCityLevelOrFullCommunityKey(
  country: unknown,
  city: unknown,
  area?: unknown
): string {
  return area
    ? createCommunityKey(country, city, area)
    : [country, city].map(normalisePart).filter(Boolean).join(":");
}

export function createCommunityLocation(input: {
  country?: unknown;
  province?: unknown;
  city?: unknown;
  area?: unknown;
}): CommunityLocation {
  const country = String(input.country ?? "").trim();
  const province = String(input.province ?? "").trim();
  const city = String(input.city ?? "").trim();
  const area = String(input.area ?? "").trim();

  return {
    country,
    province,
    city,
    area,
    communityKey: createCommunityKey(country, city, area),
  };
}

/** Known initial rollout communities, per the admin dashboard requirements. */
export const INITIAL_ROLLOUT_COMMUNITIES = ["Harare", "Chinhoyi"] as const;

/**
 * Minimal read-model reference to the existing, VERIFIED `public.communities`
 * row shape: `id, name, city, country, description, latitude, longitude,
 * created_at`. VERIFIED: this table currently has ZERO rows and has NO
 * `area` column — it represents a city/community entity only. Do not
 * extend this without confirming further against the live schema first.
 */
export interface ExistingCommunityReference {
  /** `communities.id` is UUID, unlike bigint profile/conversation IDs. */
  id: string;
  name: string;
  city: string;
  country: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

/**
 * PROPOSED APPLICATION CONTRACT — NOT a database schema, NOT yet approved
 * for migration. Since the existing `communities` table has no `area`
 * column, an area/subdivision layer must live beneath it (a separate
 * table referencing `communities.id`) rather than adding `area` directly
 * to `communities` — this keeps `communities` reusable as-is. See
 * docs/TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md section 6.
 */
export interface AreaSubdivision {
  id: string;
  communityId: string;
  name: string;
  createdAt: string;
}

/** Read-model reference to the existing `public.help_requests` table — schema UNKNOWN, must be inspected before ServiceRequest is finalized (see Section 9). */
export interface ExistingHelpRequestReference {
  id: string;
  communityKey: string | null;
}

/** Read-model reference to the existing `public.community_posts` table — schema UNKNOWN. */
export interface ExistingCommunityPostReference {
  id: string;
  communityKey: string | null;
}

/** Application contract for a community help request; this does not add a database table. */
/** Mirrors the status constraint on the canonical public.help_requests table. */
export type CommunityHelpRequestStatus = "open" | "in_progress" | "resolved" | "cancelled";
export interface CommunityHelpRequest {
  id: string;
  serviceRequestId: string;
  communityId: string;
  communityKey: string;
  city: string;
  area: string | null;
  category: string | null;
  question: string;
  status: CommunityHelpRequestStatus;
  requesterConsentAt: string;
  requesterConsentVersion: string;
  createdAt: string;
}
