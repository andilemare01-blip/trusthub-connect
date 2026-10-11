import type { CommunityMetric, DemandMetric, OutcomeMetric } from "@/types/analytics";
import type { RequestOutcome, ServiceRequest } from "@/types/service-request";

/** Demand counts reflect persisted request records; dependency failures must never be supplied as empty arrays. */
export function aggregateDemandMetrics(requests: ServiceRequest[], communityKey: string): DemandMetric[] {
  const groups = new Map<string, DemandMetric>();
  for (const request of requests) {
    if (request.communityKey !== communityKey) continue;
    const category = request.requestedCategory?.trim() || "Uncategorized";
    const metric = groups.get(category) ?? { communityKey, category, requestCount: 0, unansweredCount: 0 };
    metric.requestCount += 1;
    if (request.status === "open" || request.status === "in_progress") metric.unansweredCount += 1;
    groups.set(category, metric);
  }
  return [...groups.values()].sort((a, b) => b.requestCount - a.requestCount || a.category.localeCompare(b.category));
}

/** Counts successful outcomes only from explicit requester confirmation events. */
export function aggregateOutcomeMetrics(
  requests: ServiceRequest[],
  outcomes: RequestOutcome[],
  communityKey: string,
): OutcomeMetric {
  const requestsById = new Map(requests.filter((request) => request.communityKey === communityKey).map((request) => [request.id, request]));
  let problemsSolved = 0;
  let successfulMatches = 0;
  const usefulDurations: number[] = [];
  const counted = new Set<string>();
  for (const outcome of outcomes) {
    const request = requestsById.get(outcome.serviceRequestId);
    if (!request || counted.has(outcome.serviceRequestId)) continue;
    counted.add(outcome.serviceRequestId);
    if (outcome.usefulAnswerConfirmed) problemsSolved += 1;
    if (outcome.matchConfirmed) successfulMatches += 1;
    if (!outcome.usefulAnswerConfirmed || !outcome.resolvedAt) continue;
    const start = Date.parse(request.createdAt);
    const end = Date.parse(outcome.resolvedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) usefulDurations.push((end - start) / 1000);
  }
  return {
    communityKey,
    problemsSolved,
    successfulMatches,
    averageTimeToUsefulAnswerSeconds: usefulDurations.length
      ? usefulDurations.reduce((total, duration) => total + duration, 0) / usefulDurations.length
      : null,
  };
}

export function communityMetricsFromDemand(demand: DemandMetric[]): CommunityMetric[] {
  return demand.map((item) => ({ communityKey: item.communityKey, metricKey: `requests:${item.category}`, value: item.requestCount }));
}
