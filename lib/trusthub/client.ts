import type { ServiceProvider, TrustHubBusiness, TrustHubReview } from "@/types/business";
import type { TrustHubProfile } from "@/types/identity";
import type { ExistingCommunityReference } from "@/types/community";
import type { NormalizedRequest } from "../answer-resolution/types";

/**
 * Error thrown by every method of the not-connected mock client. Making it a
 * distinct class lets callers/tests detect "not wired up yet" vs. a real
 * data error.
 */
export class NotConnectedError extends Error {
  constructor(method: string) {
    super(
      `TrustHubClient.${method} is not connected yet. No Supabase connection has been configured for TrustHub Connect.`
    );
    this.name = "NotConnectedError";
  }
}

/**
 * Read-oriented integration surface for reusing existing TrustHub data
 * (businesses, reviews, profiles) instead of duplicating it.
 *
 * This interface exposes read-only operations only. The Supabase adapter
 * runtime uses a server-only service credential for the authenticated-only tables.
 */
export interface TrustHubClient {
  getProfileByUserId(userId: string): Promise<TrustHubProfile | null>;
  getBusinessById(businessId: string): Promise<TrustHubBusiness | null>;
  listBusinessesByCommunity(communityKey: string): Promise<TrustHubBusiness[]>;
  listReviewsForBusiness(businessId: string): Promise<TrustHubReview[]>;
  /** Individual self-declared service providers — distinct from `businesses` rows. */
  listServiceProvidersByCommunity(communityKey: string): Promise<ServiceProvider[]>;
  /** Read-only search against the existing TrustHub businesses table. */
  searchBusinesses(request: NormalizedRequest): Promise<TrustHubBusiness[]>;
  /** Communities are city-level UUID records; area remains on the request/business. */
  listCommunitiesByLocation(country: string | null, city: string): Promise<ExistingCommunityReference[]>;
}

