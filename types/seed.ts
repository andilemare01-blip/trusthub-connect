/** Candidate-only seed contracts. These types describe evidence inputs and
 * review decisions; they do not represent a canonical Supabase write model. */
export type SeedSource = "overture" | "openstreetmap" | "official_public_registry" | "community" | "manual";
export type SeedProvenanceState = "DECLARED" | "OBSERVED" | "VERIFIED" | "POTENTIAL" | "INFERRED" | "UNKNOWN";
export type SeedVerificationStatus = "unverified" | "declared" | "observed" | "verified" | "unknown";

export interface SeedProvider { source: SeedSource; name: string; }
export interface SourceEvidence {
  source: SeedSource;
  sourceId: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  retrievedAt: string;
  provenanceState?: SeedProvenanceState;
  verificationStatus?: SeedVerificationStatus;
  confidence?: number | null;
  /** Original provider object, retained without rewriting for later audit. */
  payload?: unknown;
}
export interface SeedRecord {
  id: string;
  rawName: string;
  rawCategory: string | null;
  rawAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Explicit structured place fields supplied by the source. */
  country?: string | null;
  province?: string | null;
  city?: string | null;
  area?: string | null;
  phone?: string | null;
  website?: string | null;
  evidence: SourceEvidence;
}
export interface NormalizedBusiness {
  name: string;
  normalizedName: string;
  category: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  communityKey: string | null;
  latitude: number | null;
  longitude: number | null;
  evidence: SourceEvidence;
  provenanceState: SeedProvenanceState;
  verificationStatus: SeedVerificationStatus;
  locationStatus: "resolved" | "unresolved";
  reviewReasons: string[];
}
export interface ExistingSeedMatch {
  id: string;
  name: string;
  city: string | null;
  category?: string | null;
  province?: string | null;
  area?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: SeedSource | null;
  sourceId?: string | null;
}
export type SeedDecisionKind = "create_candidate" | "enrich_candidate" | "duplicate" | "review";
export interface DeduplicationResult {
  decision: SeedDecisionKind;
  matchedExistingBusinessId: string | null;
  confidence: "high" | "medium" | "low";
  matchingSignals: string[];
  proposedEnrichment: Record<string, string | number | null>;
  conflicts: string[];
  reviewReasons: string[];
}
