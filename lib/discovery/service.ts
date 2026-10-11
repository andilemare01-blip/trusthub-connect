import type { TrustHubBusiness } from "@/types/business";
import type { NormalizedRequest, SourceKind } from "../answer-resolution/types";
import type { TrustHubClient } from "../trusthub/client";

export interface DiscoveryRecord {
  id: string; source: SourceKind; sourceLabel: string; sourceRecordId: string;
  recordType?: string;
  name: string; category: string | null; city: string | null; area: string | null;
  contact: string | null; summary: string | null;
  verificationStatus: "declared" | "observed" | "verified" | "potential" | "inferred" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown"; provenance: string[];
  completeness: "complete" | "partial";
  countryCode?: string | null; sourceUrl?: string | null; sourceLicense?: string | null; sourceRetrievedAt?: string | null;
  confidenceValue?: number | null; verificationStatusRaw?: string | null; provenanceState?: string | null;
  operatingStatus?: string | null; claimedStatus?: string | null; serviceTags?: string[];
  openingHours?: Record<string, unknown> | null; phone?: string | null; whatsapp?: string | null; website?: string | null; address?: string | null;
  evidence?: Record<string, unknown>[]; sourceMetadata?: Record<string, unknown> | null;
}
export interface DiscoverySource { readonly source: SourceKind; search(request: NormalizedRequest): Promise<DiscoveryRecord[]>; }
/** Port for a schema-confirmed knowledge_records adapter. No persistence columns are assumed. */
export interface KnowledgeRecordReader { searchDiscoverable(request: NormalizedRequest): Promise<DiscoveryRecord[]>; }
export class KnowledgeRecordDiscoverySource implements DiscoverySource {
  readonly source = "trusthub" as const;
  private readonly reader: KnowledgeRecordReader;
  constructor(reader: KnowledgeRecordReader) { this.reader = reader; }
  search(request: NormalizedRequest) { return this.reader.searchDiscoverable(request); }
}
function mapBusiness(business: TrustHubBusiness): DiscoveryRecord {
  const present = [business.category, business.city, business.area, business.address, business.phone, business.website].filter(Boolean).length;
  return {
    id: `business:${business.id}`, source: "trusthub", sourceLabel: "TrustHub business record", sourceRecordId: business.id,
    name: business.name, category: business.category ?? business.subcategory, city: business.city, area: business.area,
    contact: business.phone ?? business.website, summary: business.address,
    verificationStatus: business.businessVerified ? "verified" : "unknown", confidence: business.businessVerified ? "high" : "medium",
    provenance: ["trusthub.businesses", ...(business.source ? [`upstream:${business.source}`] : []), ...(business.sourceId ? [`upstream_id:${business.sourceId}`] : [])],
    completeness: present >= 4 ? "complete" : "partial",
  };
}
export class TrustHubBusinessDiscoverySource implements DiscoverySource {
  readonly source = "trusthub" as const;
  private readonly client: Pick<TrustHubClient, "searchBusinesses">;
  constructor(client: Pick<TrustHubClient, "searchBusinesses">) { this.client = client; }
  async search(request: NormalizedRequest) { return (await this.client.searchBusinesses(request)).map(mapBusiness); }
}
export interface DiscoveryResult { requestedCity: string | null; records: DiscoveryRecord[]; sources: { source: SourceKind; status: "checked" | "unavailable"; note?: string }[]; }
/** Combines independent sources without merging records or silently broadening the requested city. */
export class TrustHubDiscoveryService {
  private readonly sources: DiscoverySource[];
  constructor(sources: DiscoverySource[]) { this.sources = sources; }
  async search(request: NormalizedRequest): Promise<DiscoveryResult> {
    const city = request.location?.city?.trim() || null;
    const settled = await Promise.all(this.sources.map(async (source) => {
      try {
        const records = await source.search(request);
        return { records: city ? records.filter((item) => item.city?.trim().toLocaleLowerCase() === city.toLocaleLowerCase()) : records, source: source.source, status: "checked" as const };
      } catch (error) {
        return { records: [], source: source.source, status: "unavailable" as const, note: error instanceof Error ? error.message : "Source unavailable." };
      }
    }));
    return { requestedCity: city, records: settled.flatMap(({ records }) => records), sources: settled.map((item) => item.status === "checked" ? { source: item.source, status: item.status } : { source: item.source, status: item.status, note: item.note }) };
  }
}
