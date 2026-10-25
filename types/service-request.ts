/**
 * Service request types for TrustHub Connect.
 *
 * Application view over TrustHub's existing public.help_requests table.
 */

/** Single shared source of truth for the request lifecycle — do not scatter status strings elsewhere. */
export const SERVICE_REQUEST_STATUSES = [
  "open",
  "in_progress",
  "answered",
  "matched",
  "escalated_to_agent",
  "resolved",
  "unanswered",
  "cancelled",
] as const;

export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** What the requester is trying to accomplish, classified by AI but never auto-verified as fulfilled. */
export type RequestIntent = "find_business" | "find_provider" | "ask_question" | "report_issue" | "add_business" | "review_experience" | "get_reviews" | "profile_creation" | "job_seeker" | "employer_recruiting" | "vacancy_search" | "candidate_search" | "vacancy_create" | "recruitment_status" | "recruitment_other";

/**
 * The eventual, explicit outcome of a request. "Problem solved" must never
 * simply mean "the AI replied" — `usefulAnswerConfirmed`/`matchConfirmed`
 * require an explicit confirmation step (see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 16/17).
 */
export interface RequestOutcome {
  serviceRequestId: string;
  usefulAnswerConfirmed: boolean;
  matchConfirmed: boolean;
  resolvedAt: string | null;
}

export interface ServiceRequest {
  id: string;
  conversationId: string | null;
  trustHubProfileId: string | null;
  communityKey: string | null;
  communityId: string | null;
  area?: string | null;
  sourceChannel?: "whatsapp" | "web" | "admin" | "system";
  requestedCategory: string | null;
  requestText: string;
  intent: RequestIntent | null;
  status: ServiceRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Populated once resolved, used for the "time to useful answer" metric. */
  timeToUsefulAnswerSeconds: number | null;
  communityConsentAt?: string | null;
  communityConsentVersion?: string | null;
}

/** Inputs persisted by the repository require a community and stable source-event key. */
export type CreateServiceRequest = Omit<ServiceRequest, "id" | "createdAt" | "communityId"> & {
  communityId: string;
  idempotencyKey: string;
  communityConsentAt: string;
  communityConsentVersion: string;
};

