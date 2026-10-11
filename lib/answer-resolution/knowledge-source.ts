import type { TrustHubBusiness } from "../../types/business";
import type { AnswerSource, AnswerSourceResult, EvidenceItem, NormalizedRequest } from "./types";
import { TrustHubBusinessAnswerSource } from "./trusthub-source.ts";
import type { DiscoveryRecord, KnowledgeRecordReader } from "../discovery/service";

function knowledgeEvidence(record: DiscoveryRecord, request: NormalizedRequest, retrievedAt: string): EvidenceItem {
  const attribute = request.questionType === "business_fact" ? request.requestedAttribute?.toLocaleLowerCase() ?? "" : "";
  const value = attribute.includes("whatsapp") ? record.whatsapp : attribute.includes("phone") ? record.phone : attribute.includes("website") ? record.website : attribute.includes("address") ? record.address : attribute.includes("area") ? record.area : attribute.includes("city") ? record.city : attribute.includes("hour") ? record.openingHours ? JSON.stringify(record.openingHours) : null : attribute.includes("service") || attribute.includes("category") ? record.category : null;
  const isFact = request.questionType === "business_fact" && !!attribute;
  const missing = isFact && !value;
  const detail = [record.category, [record.area, record.city].filter(Boolean).join(", ")].filter(Boolean).join("; ");
  const claim = isFact
    ? value ? `TrustHub's knowledge record lists ${record.name}'s ${attribute} as ${value}.` : `TrustHub has a knowledge record for ${record.name}, but it does not include a ${attribute}.`
    : `TrustHub's knowledge record lists ${record.name}${detail ? ` (${detail})` : ""}.`;
  return {
    id: record.id, claim, source: "trusthub", sourceLabel: record.sourceLabel,
    verificationStatus: missing ? "unknown" : record.verificationStatus,
    confidence: missing ? "unknown" : record.confidence, retrievedAt, sourceRecordId: record.sourceRecordId,
    completeness: missing || record.completeness === "partial" ? "partial" : "complete",
    recordSource: record.sourceMetadata && typeof record.sourceMetadata.name === "string" ? record.sourceMetadata.name : "TrustHub knowledge_records",
    recordSourceId: record.provenance.find((item) => item.startsWith("source_record_id:"))?.slice("source_record_id:".length) ?? null,
    provenanceDetails: record.provenance, sourceUrl: record.sourceUrl, confidenceValue: record.confidenceValue,
    operatingStatus: record.operatingStatus,
    ...(isFact ? {} : { kind: "listing" as const }), name: record.name, category: record.category,
    businessDetails: { phone: record.phone, whatsapp: record.whatsapp, website: record.website, address: record.address, city: record.city, area: record.area, services: record.serviceTags, openingHours: record.openingHours },
  };
}

const listingKey = (item: EvidenceItem) => `${(item.name ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}|${(item.businessDetails?.city ?? "").toLocaleLowerCase()}`;

/**
 * The same business can appear as a businesses row and a knowledge_records row. Presentation shows it once: the first
 * record keeps its own status and source, gaps are filled from the duplicate, and the duplicate is noted in provenance.
 * Nothing is merged or changed in the database.
 */
export function dedupeListings(items: EvidenceItem[]): EvidenceItem[] {
  const kept = new Map<string, EvidenceItem>();
  const result: EvidenceItem[] = [];
  for (const item of items) {
    if (item.kind !== "listing" || !item.name) { result.push(item); continue; }
    const key = listingKey(item);
    const existing = kept.get(key);
    if (!existing) { kept.set(key, item); result.push(item); continue; }
    const details = { ...existing.businessDetails };
    for (const field of ["phone", "whatsapp", "website", "address", "area", "openingHours"] as const) {
      if (!details[field] && item.businessDetails?.[field]) (details as Record<string, unknown>)[field] = item.businessDetails[field];
    }
    existing.businessDetails = details;
    existing.provenanceDetails = [...(existing.provenanceDetails ?? []), `also_listed_in:${item.sourceLabel}:${item.sourceRecordId}`];
  }
  return result;
}

/** Queries businesses and knowledge_records independently, then adapts both to the resolver evidence contract. */
export class TrustHubKnowledgeAnswerSource implements AnswerSource {
  private readonly businesses: TrustHubBusinessAnswerSource;
  private readonly knowledge: KnowledgeRecordReader;
  private readonly now: () => string;
  constructor(businessClient: { searchBusinesses(request: NormalizedRequest): Promise<TrustHubBusiness[]>; listCommunitiesByLocation(country: string | null, city: string): Promise<import("../../types/community").ExistingCommunityReference[]> }, knowledge: KnowledgeRecordReader, now: () => string = () => new Date().toISOString()) {
    this.businesses = new TrustHubBusinessAnswerSource(businessClient, now);
    this.knowledge = knowledge;
    this.now = now;
  }
  async search(request: NormalizedRequest): Promise<AnswerSourceResult> {
    const [businessResult, knowledgeResult] = await Promise.allSettled([this.businesses.search(request), this.knowledge.searchDiscoverable(request)]);
    const failures: string[] = [];
    if (businessResult.status === "rejected") failures.push(`businesses: ${businessResult.reason instanceof Error ? businessResult.reason.message : "read failed"}`);
    if (knowledgeResult.status === "rejected") failures.push(`knowledge_records: ${knowledgeResult.reason instanceof Error ? knowledgeResult.reason.message : "read failed"}`);
    if (businessResult.status === "rejected" && knowledgeResult.status === "rejected") return { matchStatus: "none", evidence: [], availability: "unavailable", sourceNotes: failures };
    const records = knowledgeResult.status === "fulfilled" ? knowledgeResult.value : [];
    const businessEvidence = businessResult.status === "fulfilled" ? businessResult.value.evidence : [];
    const retrievedAt = this.now();
    const knowledgeEvidenceItems = records.map((record) => knowledgeEvidence(record, request, retrievedAt));
    const evidence = dedupeListings([...businessEvidence, ...knowledgeEvidenceItems]);
    const communityLookup = businessResult.status === "fulfilled" ? businessResult.value.communityLookup : undefined;
    const incomplete = evidence.some((item) => item.completeness === "partial");
    const matchStatus = evidence.length > 1 ? "multiple" as const : incomplete ? "partial" as const : evidence.length ? "matched" as const : "none" as const;
    const names = [...new Set([...businessEvidence.map((item) => item.claim.match(/lists (.+?)(?:'s| \(|\.)/)?.[1]), ...records.map((item) => item.name)].filter((value): value is string => !!value))];
    return {
      matchStatus, evidence, ...(communityLookup ? { communityLookup } : {}),
      availability: failures.length ? "partial" : "available", ...(failures.length ? { sourceNotes: failures } : {}),
      ...(request.questionType === "business_fact" && evidence.length > 1 ? { clarificationQuestion: `I found ${names.join(", ")}. Which record do you mean?` } : {}),
    };
  }
}
