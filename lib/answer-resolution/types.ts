import type { RequestIntent } from "../../types/service-request";
import type { VerificationStatus } from "../../types/provenance";
import type { ExistingCommunityReference } from "../../types/community";

export type SourceKind = "trusthub" | "community" | "human_trust_agent" | "overture" | "openstreetmap" | "google_places" | "authored" | "ai";
export type SourceAttemptStatus = "checked" | "empty" | "unavailable" | "skipped" | "declined";
export type ResolutionStatus = "answered" | "partially_answered" | "clarification_needed" | "community_needed" | "human_needed" | "unresolved";

export interface NormalizedRequest {
  text: string;
  intent: RequestIntent | null;
  category: string | null;
  location: { country?: string | null; city?: string | null; area?: string | null } | null;
  questionType: "business_discovery" | "provider_recommendation" | "business_fact" | "reputation" | "review_read" | "review_write" | "community_question" | "trusthub_policy" | "general" | "unknown" | "profile_creation" | "add_business" | "recruitment";
  requestedAttribute?: string | null;
  /** Specific business/person name when the request identifies an entity. */
  entityName?: string | null;
  /** Canonical taxonomy concept id; `category` keeps the user's own wording. */
  serviceConcept?: string | null;
  /** Set when the phrase could mean materially different services, so the resolver asks instead of guessing. */
  ambiguity?: { question: string; options: string[] };
}

export interface EvidenceItem {
  id: string;
  claim: string;
  source: SourceKind;
  sourceLabel: string;
  verificationStatus: VerificationStatus;
  confidence: "high" | "medium" | "low" | "unknown";
  retrievedAt: string;
  sourceRecordId: string;
  completeness?: "complete" | "partial";
  recordSource?: string | null;
  recordSourceId?: string | null;
  provenanceDetails?: string[]; sourceUrl?: string | null; confidenceValue?: number | null; operatingStatus?: string | null;
  /** Set for business listings so results can be presented as structured cards. */
  kind?: "listing" | "fact";
  name?: string | null;
  category?: string | null;
  businessDetails?: { phone?: string | null; whatsapp?: string | null; website?: string | null; address?: string | null; city?: string | null; area?: string | null; services?: string[]; openingHours?: Record<string, unknown> | null };
}

export interface SourceAttempt { source: SourceKind; status: SourceAttemptStatus; note?: string; }

export interface ResolverContext {
  requesterConsentedToCommunity?: boolean;
  requesterConsentedToHuman?: boolean;
  communityAvailable?: boolean;
  trustAgentAvailability?: "available" | "unavailable" | "unknown";
  externalDiscoveryEnabled?: boolean;
  externalSources?: SourceKind[];
  clarificationAsked?: boolean;
}

export interface ResolutionResult {
  status: ResolutionStatus;
  evidence: EvidenceItem[];
  provenance: EvidenceItem["source"][];
  confidence: EvidenceItem["confidence"];
  uncertainty: string | null;
  sourceAttempts: SourceAttempt[];
  /** TrustHub community lookup context is metadata, not a claim about local knowledge. */
  communityLookup?: { status: "checked" | "empty" | "unavailable"; records: ExistingCommunityReference[] };
  clarificationQuestion?: string;
  nextAction: "answer" | "clarify" | "ask_community_permission" | "request_human_permission" | "final_unresolved";
}

export interface AnswerSourceResult {
  matchStatus: "matched" | "multiple" | "partial" | "none";
  evidence: EvidenceItem[];
  availability?: "available" | "partial" | "unavailable";
  sourceNotes?: string[];
  clarificationQuestion?: string;
  communityLookup?: { status: "checked" | "empty" | "unavailable"; records: ExistingCommunityReference[] };
}

export interface AnswerSource { search(request: NormalizedRequest): Promise<AnswerSourceResult>; }

