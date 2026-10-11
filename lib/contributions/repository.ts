import type { CapabilityDeclaration, ProviderRecommendation } from "@/types/contribution";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`ContributionRepository.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/**
 * A persisted community contribution read back for answer resolution. This is
 * a read model over the EXISTING `contributions` table, not a new schema, and
 * it adds no column. `verificationStatus` is typed as the literal `"declared"`
 * so a read physically cannot surface a row as a verified fact.
 */
export interface DeclaredContributionRecord {
  id: string;
  /** The original inbound claim, stored verbatim by the write path. */
  claim: string;
  category: string | null;
  providerName: string | null;
  communityId: string;
  area: string | null;
  source: string | null;
  relationship: string | null;
  evidenceNotes: string | null;
  verificationStatus: "declared";
  /** `contributions.source_message_id` — the originating stored inbound message. */
  sourceMessageId: string | null;
  relatedConversationId: string | null;
  createdAt: string;
}

/**
 * Community-scoped, declared-only read. `area` and `category` narrow by exact
 * equality when supplied; omitting them returns every declared contribution for
 * the community rather than silently widening to another scope.
 */
export interface DeclaredContributionQuery {
  communityId: string;
  area?: string | null;
  category?: string | null;
  limit?: number;
}

/**
 * Records self-declared capabilities and community provider recommendations.
 * Neither is ever auto-verified — verification happens via the
 * provenance/review path (see lib/provenance).
 */
export interface ContributionRepository {
  declareCapability(declaration: Omit<CapabilityDeclaration, "id" | "createdAt">): Promise<CapabilityDeclaration>;
  recommendProvider(recommendation: Omit<ProviderRecommendation, "id" | "createdAt">): Promise<ProviderRecommendation>;
  /**
   * Reads persisted community contributions back as declared-only evidence.
   * This is the other half of the write path: a contribution that is only
   * written can never answer a later request, which leaves the community
   * intelligence loop open.
   */
  findDeclaredByCommunity(query: DeclaredContributionQuery): Promise<DeclaredContributionRecord[]>;
}

class NotConnectedContributionRepository implements ContributionRepository {
  async declareCapability(): Promise<CapabilityDeclaration> {
    throw new NotConnectedError("declareCapability");
  }

  async recommendProvider(): Promise<ProviderRecommendation> {
    throw new NotConnectedError("recommendProvider");
  }

  async findDeclaredByCommunity(): Promise<DeclaredContributionRecord[]> {
    throw new NotConnectedError("findDeclaredByCommunity");
  }
}

/** TODO: implement once the contribution schema is designed and approved. */
export function createContributionRepository(): ContributionRepository {
  return new NotConnectedContributionRepository();
}
