import type { AgentAvailability, AgentCoverage, TrustAgent } from "@/types/agent";
import type { MatchCandidate } from "@/types/matching";
import type { ServiceRequest } from "@/types/service-request";

export interface AgentMatchProfile {
  agent: TrustAgent;
  availability: AgentAvailability | null;
  coverage: AgentCoverage[];
}

function key(value: string | null | undefined): string { return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " "); }

/**
 * Ranks only currently available agents whose declared coverage includes the
 * exact community. It never broadens to a neighboring city or uses precise
 * coordinates. Null category coverage means general service coverage.
 */
export function rankTrustAgentCandidates(request: Pick<ServiceRequest, "communityKey" | "requestedCategory">, candidates: AgentMatchProfile[]): MatchCandidate[] {
  const community = key(request.communityKey);
  const category = key(request.requestedCategory);
  if (!community) return [];
  return candidates.flatMap(({ agent, availability, coverage }) => {
    if (!availability?.isAvailable) return [];
    const localCoverage = coverage.filter((item) => key(item.communityKey) === community);
    if (!localCoverage.length) return [];
    const categoryMatch = !category
      ? localCoverage.find((item) => item.category === null)
      : localCoverage.find((item) => key(item.category) === category) ?? localCoverage.find((item) => item.category === null);
    if (!categoryMatch) return [];
    const exactCategory = !!category && key(categoryMatch.category) === category;
    return [{ type: "trust_agent" as const, id: agent.id, displayName: "Trust Agent", score: exactCategory ? 100 : 70 }];
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
