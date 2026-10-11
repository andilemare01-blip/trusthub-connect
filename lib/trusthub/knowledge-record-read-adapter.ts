import type { NormalizedRequest } from "../answer-resolution/types";
import type { DiscoveryRecord } from "../discovery/service";
import type { SupabaseReadResponse } from "./supabase-types";
import { databaseFilterTerms, scoreServiceMatch, serviceMatchIntent } from "../discovery/service-taxonomy.ts";

export interface KnowledgeRecordReadQuery extends PromiseLike<SupabaseReadResponse> {
  select(columns: string): KnowledgeRecordReadQuery;
  eq(column: string, value: string): KnowledgeRecordReadQuery;
  ilike(column: string, pattern: string): KnowledgeRecordReadQuery;
  or(filters: string): KnowledgeRecordReadQuery;
  limit(count: number): KnowledgeRecordReadQuery;
}
export interface KnowledgeRecordReadClient { from(table: "knowledge_records"): KnowledgeRecordReadQuery; }
const COLUMNS = "id,record_type,name,country_code,province,city,area,category,subcategory,service_tags,description,phone,whatsapp,website,address,opening_hours,provenance_state,verification_status,confidence,operating_status,claimed_status,source_id,source_record_id,source_url,source_license,source_retrieved_at,created_at,updated_at,knowledge_record_evidence(id,source_id,source_record_id,source_url,evidence_type,observed_at,confidence),knowledge_sources!inner(name,source_type,base_url,license,reuse_status,attribution_required)";
const COUNTRY_CODES: Record<string, string> = { zimbabwe: "ZW", "south africa": "ZA", botswana: "BW", zambia: "ZM", mozambique: "MZ", malawi: "MW", namibia: "NA", lesotho: "LS", eswatini: "SZ" };
/**
 * Alternate country codes found in the data that normalise to an ISO
 * alpha-2 code. Zimbabwe's records are a mix of the correct "ZW" and the
 * informal "ZI"; both are Zimbabwe, so "ZI" is normalised rather than
 * dropped. This is a read-side normalisation, not a data rewrite.
 */
const COUNTRY_CODE_ALIASES: Record<string, string> = { ZI: "ZW" };
/** Text columns the database narrowing matches, so a record with no search_text is still discoverable by its own fields. */
const SEARCH_COLUMNS = ["search_text", "name", "category", "subcategory", "description"] as const;
/** Alternate codes that normalise to the given ISO alpha-2 code. */
function countryAliases(code: string): string[] { return Object.keys(COUNTRY_CODE_ALIASES).filter((alias) => COUNTRY_CODE_ALIASES[alias] === code); }
/** Normalises an alternate country code to its ISO alpha-2 form for matching; null when absent. */
function normaliseCountryCode(code: string | null | undefined): string | null { const upper = code?.trim().toUpperCase(); return upper ? COUNTRY_CODE_ALIASES[upper] ?? upper : null; }
function text(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
function confidence(v: unknown): DiscoveryRecord["confidence"] { if (typeof v !== "number") return "unknown"; return v >= 0.8 ? "high" : v >= 0.5 ? "medium" : "low"; }
function verification(provenanceState: unknown, rawStatus: unknown): DiscoveryRecord["verificationStatus"] {
  switch (provenanceState) {
    case "VERIFIED": return ["business_verified", "community_verified", "admin_verified"].includes(String(rawStatus)) ? "verified" : "unknown";
    case "DECLARED": return "declared";
    case "OBSERVED": return "observed";
    case "INFERRED": return "inferred";
    case "POTENTIAL": return "potential";
    case "UNKNOWN": return "unknown";
  }
  switch (rawStatus) {
    case "business_verified": case "community_verified": case "admin_verified": return "verified";
    case "unverified": return "unknown";
    default: return "unknown";
  }
}
function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}
function escapeIlike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
function record(row: Record<string, unknown>): DiscoveryRecord {
  const tags = Array.isArray(row.service_tags) ? row.service_tags.filter((v): v is string => typeof v === "string") : [];
  const category = text(row.category) ?? text(row.subcategory) ?? tags[0] ?? text(row.record_type);
  const contact = text(row.phone) ?? text(row.whatsapp) ?? text(row.website);
  const completeness = [category, row.city, row.area, row.address, contact, row.description].filter(Boolean).length >= 4 ? "complete" : "partial";
  const sourceId = text(row.source_id);
  const confidenceValue = typeof row.confidence === "number" ? row.confidence : null;
  const source = relation(row.knowledge_sources);
  return {
    id: `knowledge:${String(row.id)}`, source: "trusthub", sourceLabel: "TrustHub knowledge record",
    sourceRecordId: String(row.id), recordType: text(row.record_type) ?? "", name: String(row.name ?? ""), category, city: text(row.city), area: text(row.area),
    contact, summary: text(row.description) ?? text(row.address),
    verificationStatus: verification(row.provenance_state, row.verification_status), confidence: confidence(confidenceValue ?? undefined), completeness,
    provenance: ["trusthub.knowledge_records", ...(text(row.provenance_state) ? [`state:${String(row.provenance_state).toUpperCase()}`] : []), ...(text(row.verification_status) ? [`verification:${String(row.verification_status)}`] : []), ...(sourceId ? [`source_id:${sourceId}`] : []), ...(text(source?.source_type) ? [`source_type:${String(source!.source_type)}`] : []), ...(text(source?.reuse_status) ? [`reuse_status:${String(source!.reuse_status)}`] : []), ...(text(row.source_record_id) ? [`source_record_id:${String(row.source_record_id)}`] : []), ...(text(row.source_url) ? [`source_url:${String(row.source_url)}`] : []), ...(text(row.source_license) ? [`source_license:${String(row.source_license)}`] : []) , ...(text(row.source_retrieved_at) ? [`retrieved_at:${String(row.source_retrieved_at)}`] : [])],
    countryCode: text(row.country_code), sourceUrl: text(row.source_url), sourceLicense: text(row.source_license), sourceRetrievedAt: text(row.source_retrieved_at),
    confidenceValue, verificationStatusRaw: text(row.verification_status), provenanceState: text(row.provenance_state),
    phone: text(row.phone), whatsapp: text(row.whatsapp), website: text(row.website), address: text(row.address),
    evidence: Array.isArray(row.knowledge_record_evidence) ? row.knowledge_record_evidence : [], sourceMetadata: source,
    operatingStatus: text(row.operating_status), claimedStatus: text(row.claimed_status), serviceTags: tags,
    openingHours: row.opening_hours && typeof row.opening_hours === "object" ? row.opening_hours as Record<string, unknown> : null,
  };
}

/** Authenticated read adapter over the existing knowledge_records table; never writes or merges with businesses. */
export class SupabaseKnowledgeRecordReader {
  private readonly client: KnowledgeRecordReadClient;
  private readonly limit: number;
  constructor(client: KnowledgeRecordReadClient, limit = 100) { this.client = client; this.limit = limit; }
  async searchDiscoverable(request: NormalizedRequest): Promise<DiscoveryRecord[]> {
    const city = request.location?.city?.trim();
    if (!city) return [];
    let query = this.client.from("knowledge_records").select(COLUMNS).ilike("city", escapeIlike(city)).eq("knowledge_sources.reuse_status", "approved").limit(this.limit);
    const searchTerm = request.entityName?.trim() || request.category?.trim();
    const intent = !request.entityName?.trim() && request.category?.trim() ? serviceMatchIntent(request.category, request.serviceConcept) : null;
    const narrowing = intent ? databaseFilterTerms(intent).substrings : [];
    // The narrowing matches any searchable text column, not only search_text, so a
    // record whose search_text was never populated is still discoverable by its
    // own name, category, subcategory or description.
    if (narrowing.length) query = query.or(narrowing.flatMap((term) => SEARCH_COLUMNS.map((column) => `${column}.ilike.*${term}*`)).join(","));
    else if (searchTerm) query = query.or(SEARCH_COLUMNS.map((column) => `${column}.ilike.%${searchTerm.replace(/[\\%_]/g, "\\$&")}%`).join(","));
    const country = request.location?.country?.trim();
    const countryCode = country ? COUNTRY_CODES[country.toLocaleLowerCase()] ?? (/^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null) : null;
    if (country && !countryCode) return [];
    // A country with an alternate code (e.g. Zimbabwe's "ZI") must not be narrowed
    // to its ISO code at the database, or alternate-code rows would be dropped
    // before they can be normalised; those rows are matched in memory instead.
    if (countryCode && countryAliases(countryCode).length === 0) query = query.eq("country_code", countryCode);
    const { data, error } = await query;
    if (error) throw new Error(`TrustHub knowledge_records read failed: ${error.message}`);
    const area = request.location?.area?.trim().toLocaleLowerCase();
    const entity = request.entityName?.trim().toLocaleLowerCase();
    const scoreOf = (item: DiscoveryRecord) => intent ? scoreServiceMatch(intent, { name: item.name, category: item.category, tags: item.serviceTags, description: item.summary }) : 0;
    return (data ?? []).map(record).filter((item) => {
      if (item.recordType !== "business" && item.recordType !== "service") return false;
      if (item.sourceMetadata?.reuse_status !== "approved") return false;
      if (item.city?.toLocaleLowerCase() !== city.toLocaleLowerCase()) return false;
      if (countryCode && normaliseCountryCode(item.countryCode) !== countryCode) return false;
      if (area && item.area?.toLocaleLowerCase() !== area) return false;
      if (entity && !item.name.toLocaleLowerCase().includes(entity)) return false;
      if (intent && scoreOf(item) === 0) return false;
      return true;
    }).sort((left, right) => scoreOf(right) - scoreOf(left) || left.name.localeCompare(right.name));
  }
}

export function mapKnowledgeRecordRow(row: Record<string, unknown>): DiscoveryRecord { return record(row); }
