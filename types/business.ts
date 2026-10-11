/**
 * Conceptual, application-layer business/review types for TrustHub Connect.
 *
 * NOT a confirmed database schema — field names mirror what
 * TRUSTHUB_CONNECT_RECON.md (sections B and D) confirmed exists in the
 * real TrustHub `businesses`, `reviews`, `review_helpfulness`, and
 * `business_hours` tables, so TrustHub Connect can read the same data
 * shape instead of inventing a parallel one. VERIFIED (live inspection):
 * `businesses` also has `latitude, longitude, website, source, source_id`
 * with a UNIQUE constraint on `(source, source_id)` — a real dedupe key
 * TrustHub Connect's future seed pipeline should respect, not duplicate.
 * A separate, VERIFIED `business_owners` table also exists (schema not yet
 * inspected) — do not assume `ownerClaimed` below is its full replacement.
 */

export interface TrustHubBusiness {
  /** `businesses.id` is UUID in TrustHub; represented as a string at the TS boundary. */
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  province: string | null;
  country: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
  sourceId: string | null;
  trustScore: number | null;
  reviewsCount: number | null;
  businessVerified: boolean | null;
  ownerClaimed: boolean | null;
  /** `businesses.opening_hours` (jsonb) when present. */
  openingHours?: Record<string, unknown> | null;
  description?: string | null;
  createdAt: string | null;
}

/**
 * An individual TrustHub person who has self-declared a capability/service
 * (e.g. "I am a hairdresser"), as distinct from a registered `businesses`
 * row. Not a confirmed database schema — see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md and types/contribution.ts's
 * `CapabilityDeclaration`, which this type is the read-model counterpart of.
 */
export interface ServiceProvider {
  id: string;
  trustHubProfileId: string;
  displayName: string;
  category: string;
  communityKey: string | null;
  verified: boolean;
}

/**
 * A provider known only through a community recommendation, not yet a
 * `businesses` row or a self-declared `ServiceProvider`. Unverified by
 * definition until reviewed — see types/contribution.ts's
 * `ProviderRecommendation`.
 */
export interface UnverifiedProviderCandidate {
  id: string;
  providerName: string;
  category: string;
  communityKey: string | null;
  recommendationCount: number;
}

export interface TrustHubBusinessHours {
  businessId: string;
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean | null;
}

export interface TrustHubReview {
  id: string;
  businessId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface TrustHubReviewHelpfulness {
  reviewId: string;
  userId: string;
  value: "up" | "down";
}
