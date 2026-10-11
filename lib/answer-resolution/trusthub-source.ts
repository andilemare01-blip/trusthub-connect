import type { TrustHubBusiness } from "../../types/business";
import type { TrustHubClient } from "../trusthub/client";
import type { AnswerSource, AnswerSourceResult, EvidenceItem, NormalizedRequest } from "./types";

function normalise(value: string | null | undefined): string { return (value ?? "").trim().toLocaleLowerCase().replace(/[ _-]+/g, " "); }

function requestedField(business: TrustHubBusiness, attribute: string): { label: string; value: string | null } | null {
  const field = normalise(attribute);
  if (/^(phone|telephone|phone number|contact number)$/.test(field)) return { label: "phone number", value: business.phone };
  if (/^(address|street address)$/.test(field)) return { label: "address", value: business.address };
  if (/^(website|web site|url)$/.test(field)) return { label: "website", value: business.website };
  if (/^(category|service|subcategory)$/.test(field)) return { label: "category", value: business.category ?? business.subcategory };
  if (/^(area|suburb|service area)$/.test(field)) return { label: "area", value: business.area };
  if (/^(city|town)$/.test(field)) return { label: "city", value: business.city };
  if (/^(country)$/.test(field)) return { label: "country", value: business.country };
  return { label: attribute.trim(), value: null };
}

function evidenceFor(business: TrustHubBusiness, request: NormalizedRequest, retrievedAt: string): EvidenceItem {
  const details = [business.category ?? business.subcategory, [business.area, business.city].filter(Boolean).join(", ")].filter(Boolean);
  const attribute = request.questionType === "business_fact" ? request.requestedAttribute?.trim() : null;
  const requested = attribute ? requestedField(business, attribute) : null;
  const missingRequestedValue = !!requested && !requested.value;
  const claim = requested
    ? requested.value
      ? `TrustHub's record lists ${business.name}'s ${requested.label} as ${requested.value}.`
      : `TrustHub has a record for ${business.name}, but it does not include a ${requested.label}.`
    : `TrustHub lists ${business.name}${details.length ? ` (${details.join("; ")})` : ""}.`;
  return {
    id: `trusthub-business:${business.id}`,
    claim,
    source: "trusthub",
    sourceLabel: "TrustHub businesses record",
    verificationStatus: missingRequestedValue ? "unknown" : "observed",
    confidence: missingRequestedValue ? "medium" : "high",
    retrievedAt,
    sourceRecordId: business.id,
    completeness: missingRequestedValue ? "partial" : "complete",
    recordSource: business.source,
    recordSourceId: business.sourceId,
    ...(requested ? {} : {
      kind: "listing" as const, name: business.name, category: business.category ?? business.subcategory,
      businessDetails: { phone: business.phone, website: business.website, address: business.address, city: business.city, area: business.area, openingHours: business.openingHours ?? null },
    }),
  };
}

/** Converts authoritative TrustHub business rows into resolver evidence without implying a recommendation. */
export class TrustHubBusinessAnswerSource implements AnswerSource {
  private readonly client: Pick<TrustHubClient, "searchBusinesses" | "listCommunitiesByLocation">;
  private readonly now: () => string;

  constructor(client: Pick<TrustHubClient, "searchBusinesses" | "listCommunitiesByLocation">, now: () => string = () => new Date().toISOString()) {
    this.client = client;
    this.now = now;
  }

  async search(request: NormalizedRequest): Promise<AnswerSourceResult> {
    const businesses = await this.client.searchBusinesses(request);
    let communityLookup: AnswerSourceResult["communityLookup"];
    if (request.location?.city && ["business_discovery", "provider_recommendation", "business_fact"].includes(request.questionType)) {
      try {
        const records = await this.client.listCommunitiesByLocation(request.location.country ?? null, request.location.city);
        communityLookup = { status: records.length ? "checked" : "empty", records };
      } catch {
        communityLookup = { status: "unavailable", records: [] };
      }
    }
    if (request.questionType === "reputation") {
      // Reputation evidence remains outside the initial answer-source scope.
      return { matchStatus: businesses.length ? "partial" : "none", evidence: [], ...(communityLookup ? { communityLookup } : {}) };
    }
    const retrievedAt = this.now();
    const evidence = businesses.map((business) => evidenceFor(business, request, retrievedAt));
    const incomplete = evidence.some((item) => item.completeness === "partial");
    const multiple = evidence.length > 1;
    return {
      matchStatus: multiple ? "multiple" : incomplete ? "partial" : evidence.length ? "matched" : "none",
      evidence,
      ...(communityLookup ? { communityLookup } : {}),
      ...(request.questionType === "business_fact" && multiple ? {
        clarificationQuestion: `I found ${businesses.length} matching businesses: ${businesses.map(({ name }) => name).join(", ")}. Which one do you mean?`,
      } : {}),
    };
  }
}
