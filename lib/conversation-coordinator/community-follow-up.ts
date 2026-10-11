import type { TrustHubClient } from "../trusthub/client";
import type { RuntimeConversationRepository } from "./repository";

/**
 * When a turn carries no city of its own (a clarification answer, or the consent
 * reply that follows it), the city lives in the conversation's saved request.
 * Returns the community for that city, or null when none is stored or exactly one cannot be matched.
 */
export async function resolveCommunityFromPendingRequest(
  repository: Pick<RuntimeConversationRepository, "get">,
  trustHubClient: Pick<TrustHubClient, "listCommunitiesByLocation">,
  conversationId: string,
): Promise<string | null> {
  const conversation = await repository.get(conversationId);
  if (!conversation || conversation.persistence?.communityId) return null;
  const location = conversation.lastRequest?.location;
  const city = location?.city?.trim();
  if (!city) return null;
  const country = location?.country?.trim() ?? null;
  const matches = (await trustHubClient.listCommunitiesByLocation(country, city)).filter((community) => community.city.trim().toLocaleLowerCase() === city.toLocaleLowerCase()
    && (!country || community.country.trim().toLocaleLowerCase() === country.toLocaleLowerCase()));
  return matches.length === 1 ? matches[0].id : null;
}
