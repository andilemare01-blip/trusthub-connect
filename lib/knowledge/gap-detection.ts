import type { KnowledgeGap } from "@/types/knowledge";
import type { ServiceRequest } from "@/types/service-request";

export interface CommunityRequestSample { request: ServiceRequest; city: string; }
export interface GapDetectionOptions { now: string; windowDays?: number; repeatedRequestThreshold?: number; }

function normalized(value: string | null | undefined): string { return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " "); }
function slug(value: string): string { return normalized(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uncategorized"; }

/** Detects recurring unanswered/open demand without reading or repeating users' free-text request content. */
export function detectKnowledgeGaps(samples: CommunityRequestSample[], options: GapDetectionOptions): KnowledgeGap[] {
  const now = Date.parse(options.now);
  if (!Number.isFinite(now)) throw new Error("Gap detection requires a valid reference timestamp.");
  const windowDays = options.windowDays ?? 30;
  const threshold = options.repeatedRequestThreshold ?? 3;
  if (!Number.isFinite(windowDays) || windowDays <= 0 || !Number.isInteger(threshold) || threshold < 2) throw new Error("Gap detection window and repeat threshold must be positive.");
  const start = now - windowDays * 86_400_000;
  const groups = new Map<string, { communityKey: string; city: string; category: string | null; requests: ServiceRequest[] }>();
  for (const { request, city } of samples) {
    if (!request.communityKey || !city.trim() || request.status !== "open") continue;
    const created = Date.parse(request.createdAt);
    if (!Number.isFinite(created) || created < start || created > now) continue;
    const category = request.requestedCategory?.trim() || null;
    const key = `${normalized(request.communityKey)}|${normalized(category) || "uncategorized"}`;
    const group = groups.get(key) ?? { communityKey: request.communityKey, city: city.trim(), category, requests: [] };
    group.requests.push(request);
    groups.set(key, group);
  }
  const gaps: KnowledgeGap[] = [];
  for (const [groupKey, group] of groups) {
    const unansweredCount = group.requests.length;
    const reason = group.requests.length >= threshold ? "repeated_service_request" : "unanswered_request";
    const category = group.category;
    gaps.push({
      id: `gap:${slug(groupKey)}`,
      reason,
      category,
      communityKey: group.communityKey,
      description: `${unansweredCount} unanswered and ${group.requests.length - unansweredCount} open ${group.requests.length === 1 ? "request" : "requests"} for ${category ?? "local help"} in ${group.city}`,
      status: "open",
      detectedAt: options.now,
      resolvedAt: null,
    });
  }
  return gaps.sort((a, b) => a.communityKey!.localeCompare(b.communityKey!) || (a.category ?? "").localeCompare(b.category ?? ""));
}
