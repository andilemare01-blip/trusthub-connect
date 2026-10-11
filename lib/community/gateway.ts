import type {
  ExistingCommunityPostReference,
  ExistingCommunityReference,
  ExistingHelpRequestReference,
} from "@/types/community";

export class CommunityGatewayNotConnectedError extends Error {
  constructor(method: string) {
    super(`CommunityGateway.${method} is not connected yet. Column-level schema of the existing community tables is still unverified (IMPLEMENTATION_PREREQUISITES.md item 7).`);
    this.name = "CommunityGatewayNotConnectedError";
  }
}

/**
 * Reuse seam for TrustHub's existing, VERIFIED `communities`,
 * `community_members`, `community_posts`, and `help_requests` tables. Do
 * NOT build a second community architecture — this exists so Connect can
 * eventually read/write through those tables instead of duplicating them.
 */
export interface CommunityGateway {
  getCommunity(communityKey: string): Promise<ExistingCommunityReference | null>;
  listHelpRequests(communityKey: string): Promise<ExistingHelpRequestReference[]>;
  listCommunityPosts(communityKey: string): Promise<ExistingCommunityPostReference[]>;
}

class NotConnectedCommunityGateway implements CommunityGateway {
  async getCommunity(): Promise<ExistingCommunityReference | null> {
    throw new CommunityGatewayNotConnectedError("getCommunity");
  }

  async listHelpRequests(): Promise<ExistingHelpRequestReference[]> {
    throw new CommunityGatewayNotConnectedError("listHelpRequests");
  }

  async listCommunityPosts(): Promise<ExistingCommunityPostReference[]> {
    throw new CommunityGatewayNotConnectedError("listCommunityPosts");
  }
}

/** TODO: implement once the existing community tables' column-level schema is inspected and confirmed. */
export function createCommunityGateway(): CommunityGateway {
  return new NotConnectedCommunityGateway();
}
