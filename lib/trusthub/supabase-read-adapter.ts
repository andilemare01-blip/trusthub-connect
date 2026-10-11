import type { ExistingCommunityReference } from "@/types/community";
import type { TrustHubBusiness } from "@/types/business";
import type { NormalizedRequest } from "../answer-resolution/types";
import type { SupabaseReadClient } from "./supabase-types";
import type { TrustHubClient } from "./client";
import { SupabaseConfigurationError } from "./supabase-types.ts";
import { databaseFilterTerms, scoreServiceMatch, serviceMatchIntent } from "../discovery/service-taxonomy.ts";

// The live `businesses` table has no `business_verified` or `owner_claimed`
// column, so they are deliberately not selected. `businessVerified` therefore
// resolves to null and discovery reports "unknown" — never "verified". No
// proxy field (trust_score, reviews_count, source) is used to infer trust.
const BUSINESS_COLUMNS = "id,name,category,subcategory,province,city,area,address,phone,website,latitude,longitude,source,source_id,trust_score,reviews_count,opening_hours,description,created_at";
const COMMUNITY_COLUMNS = "id,name,city,country,description,latitude,longitude,created_at";
const DEFAULT_LIMIT = 500;
/** A category search returns only the best matches rather than every listing in the city. */
const RESULT_LIMIT = 10;
const MATCH_COLUMNS = ["name", "category", "subcategory"] as const;

function stringOrNull(value: unknown): string | null { return typeof value === "string" ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function booleanOrNull(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function escapeIlike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
function normalise(value: string | null | undefined): string { return (value ?? "").trim().toLocaleLowerCase(); }

export function mapTrustHubBusinessRow(row: Record<string, unknown>): TrustHubBusiness {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    category: stringOrNull(row.category),
    subcategory: stringOrNull(row.subcategory),
    province: stringOrNull(row.province),
    country: stringOrNull(row.country),
    city: stringOrNull(row.city),
    area: stringOrNull(row.area),
    address: stringOrNull(row.address),
    phone: stringOrNull(row.phone),
    website: stringOrNull(row.website),
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    source: stringOrNull(row.source),
    sourceId: stringOrNull(row.source_id),
    trustScore: numberOrNull(row.trust_score),
    reviewsCount: numberOrNull(row.reviews_count),
    businessVerified: booleanOrNull(row.business_verified),
    ownerClaimed: booleanOrNull(row.owner_claimed),
    openingHours: row.opening_hours && typeof row.opening_hours === "object" && !Array.isArray(row.opening_hours) ? row.opening_hours as Record<string, unknown> : null,
    description: stringOrNull(row.description),
    createdAt: stringOrNull(row.created_at),
  };
}

function mapCommunityRow(row: Record<string, unknown>): ExistingCommunityReference {
  return {
    id: String(row.id ?? ""), name: String(row.name ?? ""), city: String(row.city ?? ""),
    country: String(row.country ?? ""), description: stringOrNull(row.description),
    latitude: numberOrNull(row.latitude), longitude: numberOrNull(row.longitude),
    createdAt: String(row.created_at ?? ""),
  };
}

export class SupabaseTrustHubClient implements TrustHubClient {
  private readonly readClient?: SupabaseReadClient;

  /** The adapter accepts an already-configured client; secret handling stays in the server-only factory. */
  constructor(client?: SupabaseReadClient) { this.readClient = client; }

  private get client(): SupabaseReadClient {
    if (!this.readClient) throw new SupabaseConfigurationError("TrustHub reads are unavailable: server-side SUPABASE_URL and server-only SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required for authenticated-only reads.");
    return this.readClient;
  }

  async searchBusinesses(request: NormalizedRequest): Promise<TrustHubBusiness[]> {
    const city = request.location?.city?.trim();
    if (!city) return [];
    let query = this.client.from("businesses").select(BUSINESS_COLUMNS);
    const country = request.location?.country?.trim();
    if (country) query = query.ilike("country", escapeIlike(country));
    query = query.ilike("city", escapeIlike(city));
    const requestedName = normalise(request.entityName);
    const requestedCategory = normalise(request.category);
    // The taxonomy supplies canonical terms; a record with a NULL category can still match by name or subcategory.
    const intent = !requestedName && requestedCategory ? serviceMatchIntent(request.category, request.serviceConcept) : null;
    if (intent) {
      const { substrings, words } = databaseFilterTerms(intent);
      const clauses = [
        ...substrings.flatMap((term) => MATCH_COLUMNS.map((column) => `${column}.ilike.*${term}*`)),
        // Short terms (bar, dj, gp) only match as whole words so they do not pull in unrelated names.
        ...words.flatMap((word) => MATCH_COLUMNS.flatMap((column) => [`${column}.ilike.${word}`, `${column}.ilike.${word} *`, `${column}.ilike.* ${word}`, `${column}.ilike.* ${word} *`])),
      ];
      if (clauses.length) query = query.or(clauses.join(","));
    }
    query = query.limit(DEFAULT_LIMIT);
    const { data, error } = await query;
    if (error) throw new Error(`TrustHub businesses read failed: ${error.message}`);

    const requestedArea = normalise(request.location?.area);
    const scored = (data ?? []).map(mapTrustHubBusinessRow).map((business) => ({
      business,
      score: intent ? scoreServiceMatch(intent, { name: business.name, category: business.category, subcategory: business.subcategory }) : 0,
    })).filter(({ business, score }) => {
      if (requestedName && !normalise(business.name).includes(requestedName)) return false;
      if (intent && score === 0) return false;
      if (requestedArea && !normalise(business.area).includes(requestedArea)) return false;
      return true;
    }).sort((left, right) => {
      const rank = (business: TrustHubBusiness) => Number(normalise(business.name) === requestedName && !!requestedName) + Number(normalise(business.area) === requestedArea && !!requestedArea);
      return right.score - left.score || rank(right.business) - rank(left.business) || left.business.name.localeCompare(right.business.name);
    }).map(({ business }) => business);
    return intent ? scored.slice(0, RESULT_LIMIT) : scored;
  }

  async listCommunitiesByLocation(country: string | null, city: string): Promise<ExistingCommunityReference[]> {
    let query = this.client.from("communities").select(COMMUNITY_COLUMNS).ilike("city", escapeIlike(city.trim())).limit(100);
    if (country?.trim()) query = query.ilike("country", escapeIlike(country.trim()));
    const { data, error } = await query;
    if (error) throw new Error(`TrustHub communities read failed: ${error.message}`);
    return (data ?? []).map(mapCommunityRow);
  }

  async getProfileByUserId(): Promise<never> { throw new Error("Profile lookup is outside this read adapter's initial scope."); }
  async getBusinessById(businessId: string): Promise<TrustHubBusiness | null> {
    const { data, error } = await this.client.from("businesses").select(BUSINESS_COLUMNS).eq("id", businessId).limit(1);
    if (error) throw new Error(`TrustHub business read failed: ${error.message}`);
    return data?.[0] ? mapTrustHubBusinessRow(data[0]) : null;
  }
  async listBusinessesByCommunity(communityKey: string): Promise<TrustHubBusiness[]> {
    const { data, error } = await this.client.from("businesses").select(BUSINESS_COLUMNS).eq("community_key", communityKey).limit(DEFAULT_LIMIT);
    if (error) throw new Error(`TrustHub businesses read failed: ${error.message}`);
    return (data ?? []).map(mapTrustHubBusinessRow);
  }
  async listReviewsForBusiness(): Promise<never> { throw new Error("Review reads are outside this adapter's initial scope."); }
  async listServiceProvidersByCommunity(): Promise<never> { throw new Error("Service provider reads are outside this read adapter's initial scope."); }
}
