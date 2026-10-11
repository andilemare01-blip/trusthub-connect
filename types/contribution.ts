/**
 * Community contribution / provenance-evidence types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Modeled after the existing TrustHub
 * `business_information_updates` pattern documented in
 * TRUSTHUB_CONNECT_RECON.md (sections F and H) — field/value/source/
 * evidence/status — rather than inventing an unrelated shape.
 */

export type ContributionStatus = "pending" | "approved" | "rejected";

export interface CommunityContribution {
  id: string;
  trustHubProfileId: string;
  businessId: string | null;
  fieldName: string;
  suggestedValue: string;
  source: string | null;
  evidenceNotes: string | null;
  status: ContributionStatus;
  createdAt: string;
}

/** A single piece of supporting evidence attached to a contribution or service request. */
export interface ProvenanceEvidence {
  id: string;
  contributionId: string | null;
  serviceRequestId: string | null;
  description: string;
  submittedByProfileId: string;
  createdAt: string;
}

/**
 * Self-declared capability, e.g. "I am a hairdresser." Never auto-verified —
 * starts as a declaration, becomes VERIFIED only through the standard
 * provenance/review path (see types/provenance.ts).
 */
export interface CapabilityDeclaration {
  id: string;
  trustHubProfileId: string;
  category: string;
  communityKey: string | null;
  communityId?: string | null;
  area?: string | null;
  source?: string;
  relatedConversationId?: string | null;
  relatedHelpRequestId?: string | null;
  sourceMessageId?: string | null;
  availabilityNote: string | null;
  contactPreference: string | null;
  createdAt: string;
}

/**
 * A community recommendation of someone else, e.g. "I know a plumber in
 * Chinhoyi." Distinct from CapabilityDeclaration (self) — captures the
 * contributor's relationship to the provider and is never auto-verified.
 */
export interface ProviderRecommendation {
  id: string;
  recommendedByProfileId: string;
  providerName: string;
  category: string;
  communityKey: string | null;
  communityId?: string | null;
  area?: string | null;
  businessId?: string | null;
  relatedConversationId?: string | null;
  relatedHelpRequestId?: string | null;
  sourceMessageId?: string | null;
  contactInfo: string | null;
  contributorRelationship: string | null;
  contributorExperienceNote: string | null;
  source: string;
  createdAt: string;
}

