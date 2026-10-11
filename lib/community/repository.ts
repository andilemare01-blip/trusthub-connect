import {
  createCommunityLocation,
  type CommunityLocation,
} from "@/types/community";

/**
 * Read/write surface for a future persisted `communities` concept.
 *
 * SUPERSEDED NOTE: a live, read-only Supabase inspection VERIFIED that a
 * real `public.communities` table (plus `community_members`,
 * `community_posts`, `help_requests`) already exists in the existing
 * TrustHub database — see `lib/community/gateway.ts`'s `CommunityGateway`,
 * which is the intended reuse seam for that real table. This in-memory
 * implementation remains only as a local-development/testing placeholder
 * and must not be treated as a real persistence layer or as license to
 * build a second, competing community table.
 */
export interface CommunityRepository {
  upsertCommunity(location: CommunityLocation): Promise<CommunityLocation>;
  getCommunityByKey(communityKey: string): Promise<CommunityLocation | null>;
  listCommunities(): Promise<CommunityLocation[]>;
}

class InMemoryCommunityRepository implements CommunityRepository {
  private readonly communities = new Map<string, CommunityLocation>();

  async upsertCommunity(location: CommunityLocation): Promise<CommunityLocation> {
    const normalized = createCommunityLocation(location);
    this.communities.set(normalized.communityKey, normalized);
    return normalized;
  }

  async getCommunityByKey(communityKey: string): Promise<CommunityLocation | null> {
    return this.communities.get(communityKey) ?? null;
  }

  async listCommunities(): Promise<CommunityLocation[]> {
    return Array.from(this.communities.values());
  }
}

/**
 * TODO: once a persisted `communities` design is approved (see
 * TRUSTHUB_CONNECT_RECON.md section O, step 2), replace this with a real
 * database-backed implementation. Until then this returns a process-local,
 * non-persistent in-memory implementation — suitable for local
 * development/testing only.
 */
export function createCommunityRepository(): CommunityRepository {
  return new InMemoryCommunityRepository();
}
