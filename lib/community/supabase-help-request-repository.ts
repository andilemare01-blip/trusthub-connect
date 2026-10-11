import type { CommunityHelpRequest } from "../../types/community.ts";
import { createCityLevelOrFullCommunityKey } from "../../types/community.ts";
import { COMMUNITY_HELP_CONSENT_VERSION, CommunityHelpRequestValidationError, type CommunityHelpRequestRepository } from "./help-requests.ts";
import { requireDatabaseUuid } from "../conversation-coordinator/persistence-mapping.ts";
import { SupabasePersistenceError, type SupabaseDataClient, type SupabaseRow } from "../supabase/data-client.ts";

const HELP_FIELDS = "id,community_id,title,description,status,created_at,requested_category,area,community_consent_at,community_consent_version";

/**
 * The community-help contract is a consented view of the canonical
 * help_requests row. It never creates a duplicate help/community record.
 */
export class SupabaseCommunityHelpRequestRepository implements CommunityHelpRequestRepository {
  private readonly client: SupabaseDataClient;
  constructor(client: SupabaseDataClient) { this.client = client; }

  async findByServiceRequestId(serviceRequestId: string): Promise<CommunityHelpRequest | null> {
    const row = await this.loadRow(serviceRequestId);
    if (!row) return null;
    // A request without recorded consent stays private to its requester.
    if (typeof row.community_consent_at !== "string" || typeof row.community_consent_version !== "string") return null;
    return this.mapRow(row);
  }

  /**
   * The live database rejects (SQLSTATE 23514) any UPDATE that attaches
   * consent evidence to a row that was created without it, so a community
   * share can only ever reuse a canonical request whose consent was recorded
   * atomically at insert time. This method therefore never writes.
   */
  async create(request: CommunityHelpRequest): Promise<{ request: CommunityHelpRequest; created: boolean }> {
    const requestId = requireDatabaseUuid(request.serviceRequestId, "community help service request ID");
    const communityId = requireDatabaseUuid(request.communityId, "community help community ID");
    if (request.requesterConsentVersion !== COMMUNITY_HELP_CONSENT_VERSION) {
      throw new CommunityHelpRequestValidationError("Unsupported community-help consent version.");
    }
    const row = await this.loadRow(requestId);
    if (!row) throw new SupabasePersistenceError("Community help requires an existing canonical help_requests row with the same community.");
    if (typeof row.community_consent_at !== "string" || typeof row.community_consent_version !== "string") {
      throw new CommunityHelpRequestValidationError("Community consent must be recorded when the help request is created; it cannot be attached afterwards.");
    }
    if (String(row.community_id) !== communityId) throw new CommunityHelpRequestValidationError("This service request already belongs to a different community.");
    return { request: await this.mapRow(row), created: false };
  }

  private async loadRow(serviceRequestId: string): Promise<SupabaseRow | null> {
    const id = requireDatabaseUuid(serviceRequestId, "community help service request ID");
    const result = await this.client.from("help_requests").select(HELP_FIELDS).eq("id", id).maybeSingle();
    if (result.error) throw new SupabasePersistenceError("Load community help request: " + result.error.message, result.error.code);
    if (!result.data || Array.isArray(result.data)) return null;
    return result.data as SupabaseRow;
  }

  private async mapRow(row: SupabaseRow): Promise<CommunityHelpRequest> {
    if (typeof row.community_id !== "string") throw new SupabasePersistenceError("Persisted community help request has no community.");
    const community = await this.client.from("communities").select("id,city,country")
      .eq("id", row.community_id).maybeSingle();
    if (community.error) throw new SupabasePersistenceError("Resolve community for help request: " + community.error.message, community.error.code);
    if (!community.data || Array.isArray(community.data)) throw new SupabasePersistenceError("Community for help request was not found.");
    const communityRow = community.data as SupabaseRow;
    const city = String(communityRow.city ?? "").trim();
    const country = String(communityRow.country ?? "").trim();
    const area = typeof row.area === "string" ? row.area : null;
    if (!city || !country || typeof row.community_consent_at !== "string" || typeof row.community_consent_version !== "string") {
      throw new SupabasePersistenceError("Persisted help request is missing city or consent evidence.");
    }
    const status = String(row.status);
    if (!(status === "open" || status === "in_progress" || status === "resolved" || status === "cancelled")) {
      throw new SupabasePersistenceError("Persisted help request has a status outside the live contract.");
    }
    return {
      id: String(row.id),
      serviceRequestId: String(row.id),
      communityId: String(row.community_id),
      communityKey: createCityLevelOrFullCommunityKey(country, city, area),
      city,
      area,
      category: typeof row.requested_category === "string" ? row.requested_category : null,
      question: String(row.description ?? ""),
      status,
      requesterConsentAt: row.community_consent_at,
      requesterConsentVersion: row.community_consent_version,
      createdAt: String(row.created_at),
    };
  }
}
