import type { CapabilityDeclaration, ProviderRecommendation } from "@/types/contribution";
import type { ContributionRepository, DeclaredContributionQuery, DeclaredContributionRecord } from "./repository";
import { requireDatabaseBigintId, requireDatabaseUuid } from "../conversation-coordinator/persistence-mapping.ts";
import { requireData, requireRows, SupabasePersistenceError, type SupabaseDataClient, type SupabaseRow } from "../supabase/data-client.ts";
import type { DetectedContribution } from "./detection";

/** Only columns the existing write path already populates. No column is invented. */
const DECLARED_COLUMNS = "id,category,claim_text,provider_name,community_id,area,source,relationship,evidence_notes,verification_status,source_message_id,related_conversation_id,created_at";
const DECLARED_LIMIT_MAX = 50;


export class SupabaseContributionRepository implements ContributionRepository {
  private readonly client: SupabaseDataClient;

  constructor(client: SupabaseDataClient) { this.client = client; }

  /** Persists the original inbound claim and ties it to its unique stored source message. */
  async recordDetectedContribution(input: {
    candidate: DetectedContribution;
    contributorProfileId: string;
    communityId: string | null;
    conversationId: string;
    sourceMessageId: string;
  }): Promise<string> {
    const sourceMessageId = requireDatabaseBigintId(input.sourceMessageId, "contributions.source_message_id");
    const relatedConversationId = requireDatabaseBigintId(input.conversationId, "contributions.related_conversation_id");
    const contributorProfileId = requireDatabaseBigintId(input.contributorProfileId, "contributions.contributor_profile_id");
    const communityId = input.communityId ? requireDatabaseUuid(input.communityId, "contributions.community_id") : null;
    const { data, error } = await this.client.from("contributions").insert({
      contributor_profile_id: contributorProfileId,
      category: input.candidate.category,
      claim_text: input.candidate.originalText,
      business_id: null,
      provider_name: input.candidate.providerName,
      community_id: communityId,
      area: input.candidate.area,
      source: "whatsapp",
      relationship: input.candidate.kind === "capability_declaration" ? "self" : "community_recommendation",
      evidence_notes: "Deterministically extracted candidate; not independently verified.",
      verification_status: "declared",
      related_conversation_id: relatedConversationId,
      related_help_request_id: null,
      source_message_id: sourceMessageId,
      subject_type: input.candidate.kind === "capability_declaration" ? "self" : "named_provider",
    }).select("id").single();
    if (error?.code === "23505") {
      const existing = await this.client.from("contributions").select("id").eq("source_message_id", sourceMessageId).maybeSingle();
      if (existing.error) throw new SupabasePersistenceError("Resolve duplicate message contribution: " + existing.error.message, existing.error.code);
      if (existing.data && !Array.isArray(existing.data)) return String((existing.data as SupabaseRow).id);
    }
    return String(requireData<SupabaseRow>({ data: data as SupabaseRow | null, error }, "Record detected contribution").id);
  }

  async declareCapability(input: Omit<CapabilityDeclaration, "id" | "createdAt">): Promise<CapabilityDeclaration> {
    const profileId = requireDatabaseBigintId(input.trustHubProfileId, "contributions.contributor_profile_id");
    const communityId = input.communityId ? requireDatabaseUuid(input.communityId, "contributions.community_id") : null;
    const row = await this.insert({
      contributor_profile_id: profileId,
      category: input.category,
      claim_text: "Self-declared capability: " + input.category,
      business_id: null,
      provider_name: null,
      community_id: communityId,
      area: input.area ?? null,
      source: input.source ?? "whatsapp",
      relationship: "self",
      evidence_notes: [input.availabilityNote, input.contactPreference].filter(Boolean).join("; ") || null,
      verification_status: "declared",
      related_conversation_id: input.relatedConversationId ? requireDatabaseBigintId(input.relatedConversationId, "contributions.related_conversation_id") : null,
      related_help_request_id: input.relatedHelpRequestId ? requireDatabaseUuid(input.relatedHelpRequestId, "contributions.related_help_request_id") : null,
      source_message_id: input.sourceMessageId ? requireDatabaseBigintId(input.sourceMessageId, "contributions.source_message_id") : null,
      subject_type: "self",
    });
    return {
      id: String(row.id), trustHubProfileId: profileId, category: input.category,
      communityKey: input.communityKey, communityId, area: input.area ?? null,
      availabilityNote: input.availabilityNote, contactPreference: input.contactPreference,
      createdAt: String(row.created_at),
    };
  }

  async recommendProvider(input: Omit<ProviderRecommendation, "id" | "createdAt">): Promise<ProviderRecommendation> {
    const profileId = requireDatabaseBigintId(input.recommendedByProfileId, "contributions.contributor_profile_id");
    const communityId = input.communityId ? requireDatabaseUuid(input.communityId, "contributions.community_id") : null;
    const row = await this.insert({
      contributor_profile_id: profileId,
      category: input.category,
      claim_text: "Community member recommendation: " + input.providerName + " provides " + input.category + ".",
      business_id: input.businessId ? requireDatabaseUuid(input.businessId, "contributions.business_id") : null,
      provider_name: input.providerName,
      community_id: communityId,
      area: input.area ?? null,
      source: input.source,
      relationship: input.contributorRelationship,
      evidence_notes: input.contributorExperienceNote,
      verification_status: "declared",
      related_conversation_id: input.relatedConversationId ? requireDatabaseBigintId(input.relatedConversationId, "contributions.related_conversation_id") : null,
      related_help_request_id: input.relatedHelpRequestId ? requireDatabaseUuid(input.relatedHelpRequestId, "contributions.related_help_request_id") : null,
      source_message_id: input.sourceMessageId ? requireDatabaseBigintId(input.sourceMessageId, "contributions.source_message_id") : null,
      subject_type: "named_provider",
    });
    return {
      id: String(row.id), recommendedByProfileId: profileId, providerName: input.providerName,
      category: input.category, communityKey: input.communityKey, communityId, area: input.area ?? null,
      businessId: input.businessId ?? null, contactInfo: input.contactInfo,
      contributorRelationship: input.contributorRelationship,
      contributorExperienceNote: input.contributorExperienceNote, source: input.source, createdAt: String(row.created_at),
    };
  }

  private async insert(payload: SupabaseRow): Promise<SupabaseRow> {
    const { data, error } = await this.client.from("contributions").insert(payload)
      .select("id,created_at,verification_status").single();
    return requireData<SupabaseRow>({ data: data as SupabaseRow | null, error }, "Record declared contribution");
  }

  /**
   * Reads persisted contributions back for answer resolution. Declared-only is
   * enforced in the query itself, so no caller can widen this read, and the
   * row mapping re-checks the status so a changed row fails loudly instead of
   * being rendered as a verified fact.
   */
  async findDeclaredByCommunity(query: DeclaredContributionQuery): Promise<DeclaredContributionRecord[]> {
    const communityId = requireDatabaseUuid(query.communityId, "contributions.community_id");
    const area = query.area?.trim();
    const category = query.category?.trim();
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 10) || 10, 1), DECLARED_LIMIT_MAX);
    let select = this.client.from("contributions").select(DECLARED_COLUMNS)
      .eq("community_id", communityId)
      .eq("verification_status", "declared")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (area) select = select.eq("area", area);
    if (category) select = select.eq("category", category);
    return requireRows<SupabaseRow>(await select, "Read declared community contributions")
      .map((row) => this.mapDeclaredRow(row));
  }

  private mapDeclaredRow(row: SupabaseRow): DeclaredContributionRecord {
    const status = String(row.verification_status);
    if (status !== "declared") throw new SupabasePersistenceError("A community contribution was returned outside the declared-only read contract: " + status);
    return {
      id: String(row.id),
      claim: String(row.claim_text ?? ""),
      category: typeof row.category === "string" ? row.category : null,
      providerName: typeof row.provider_name === "string" ? row.provider_name : null,
      communityId: requireDatabaseUuid(String(row.community_id), "contributions.community_id"),
      area: typeof row.area === "string" ? row.area : null,
      source: typeof row.source === "string" ? row.source : null,
      relationship: typeof row.relationship === "string" ? row.relationship : null,
      evidenceNotes: typeof row.evidence_notes === "string" ? row.evidence_notes : null,
      verificationStatus: "declared",
      sourceMessageId: row.source_message_id == null ? null : requireDatabaseBigintId(String(row.source_message_id), "contributions.source_message_id"),
      relatedConversationId: row.related_conversation_id == null ? null : requireDatabaseBigintId(String(row.related_conversation_id), "contributions.related_conversation_id"),
      createdAt: String(row.created_at),
    };
  }
}
