import type { CommunityHelpRequest } from "@/types/community";

export class CommunityHelpRequestValidationError extends Error {
  constructor(message: string) { super(message); this.name = "CommunityHelpRequestValidationError"; }
}

export const COMMUNITY_HELP_CONSENT_VERSION = "community-help-v1";
export type CommunityHelpRequestInput = Omit<CommunityHelpRequest, "status" | "requesterConsentVersion"> & { requesterConsent: boolean };

/** Builds a city/community-scoped request only after explicit requester consent. */
export function createCommunityHelpRequest(input: CommunityHelpRequestInput): CommunityHelpRequest {
  if (!input.requesterConsent) throw new CommunityHelpRequestValidationError("Community help requests require explicit requester consent.");
  if (!input.serviceRequestId.trim() || !input.communityId.trim() || !input.communityKey.trim() || !input.city.trim()) {
    throw new CommunityHelpRequestValidationError("A service request and resolved community/city are required.");
  }
  const question = input.question.trim();
  if (!question || question.length > 2000) throw new CommunityHelpRequestValidationError("The shared question must contain 1 to 2000 characters.");
  if (!Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.requesterConsentAt))) {
    throw new CommunityHelpRequestValidationError("Request and consent timestamps must be valid dates.");
  }
  return {
    id: input.id,
    serviceRequestId: input.serviceRequestId,
    communityId: input.communityId,
    communityKey: input.communityKey,
    city: input.city.trim(),
    area: input.area?.trim() || null,
    category: input.category?.trim() || null,
    question,
    status: "open",
    requesterConsentAt: input.requesterConsentAt,
    requesterConsentVersion: COMMUNITY_HELP_CONSENT_VERSION,
    createdAt: input.createdAt,
  };
}

export interface CommunityHelpRequestRepository {
  findByServiceRequestId(serviceRequestId: string): Promise<CommunityHelpRequest | null>;
  create(request: CommunityHelpRequest): Promise<{ request: CommunityHelpRequest; created: boolean }>;
}

/** Idempotent application operation. Persistent implementations must use the database constraint/atomic compare-and-set. */
export async function createOrGetCommunityHelpRequest(
  repository: CommunityHelpRequestRepository,
  input: CommunityHelpRequestInput,
): Promise<{ request: CommunityHelpRequest; created: boolean }> {
  const candidate = createCommunityHelpRequest(input);
  const existing = await repository.findByServiceRequestId(candidate.serviceRequestId);
  if (existing) {
    if (existing.communityId !== candidate.communityId) throw new CommunityHelpRequestValidationError("This service request already has a help request for a different community.");
    return { request: existing, created: false };
  }
  return repository.create(candidate);
}

/** Local fake only; it does not imply a live community notification path. */
export class InMemoryCommunityHelpRequestRepository implements CommunityHelpRequestRepository {
  private readonly byServiceRequest = new Map<string, CommunityHelpRequest>();
  async findByServiceRequestId(id: string) { const request = this.byServiceRequest.get(id); return request ? structuredClone(request) : null; }
  async create(request: CommunityHelpRequest) {
    const existing = this.byServiceRequest.get(request.serviceRequestId);
    if (existing) return { request: structuredClone(existing), created: false };
    this.byServiceRequest.set(request.serviceRequestId, structuredClone(request));
    return { request: structuredClone(request), created: true };
  }
}
