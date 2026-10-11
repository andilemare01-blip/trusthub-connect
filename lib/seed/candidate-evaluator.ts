import type { DeduplicationResult, ExistingSeedMatch, NormalizedBusiness, SeedRecord } from "@/types/seed";

const ZIMBABWE_PLACES = [
  "Harare", "Bulawayo", "Victoria Falls", "Masvingo", "Marondera", "Ruwa", "Chitungwiza",
  "Mutare", "Gweru", "Chinhoyi", "Kadoma", "Kwekwe", "Zvishavane", "Hwange", "Chiredzi",
  "Bindura", "Beitbridge", "Chegutu", "Norton", "Redcliff", "Kariba", "Chipinge", "Shurugwi",
  "Rusape", "Plumtree", "Gokwe", "Karoi", "Mvurwi", "Shamva", "Murehwa", "Nyanga", "Esigodini",
];
const ROAD_WORD = /\b(road|rd|street|st|avenue|ave|highway|drive|close|lane|way)\b/i;
const canonicalPlace = new Map(ZIMBABWE_PLACES.map((place) => [place.toLocaleLowerCase(), place]));

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/\b(private limited|pvt ltd|proprietary limited|pty ltd|limited|ltd|incorporated|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function clean(value: string | null | undefined): string | null { const trimmed = value?.trim(); return trimmed || null; }
function validCoordinate(value: number | null, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}
function addressCity(address: string | null): string | null {
  if (!address) return null;
  // Only an address component that is itself a known locality can establish a city.
  // Road/landmark names are never promoted to cities.
  for (const part of address.split(/[;,]/).map((value) => value.trim())) {
    if (ROAD_WORD.test(part)) continue;
    const match = canonicalPlace.get(part.toLocaleLowerCase());
    if (match) return match;
  }
  return null;
}
function validateSource(record: SeedRecord): string[] {
  const reasons: string[] = [];
  if (!record.id.trim()) reasons.push("source_record_id_missing");
  if (!record.evidence.sourceId) reasons.push("source_id_missing");
  if (!Number.isFinite(Date.parse(record.evidence.retrievedAt))) reasons.push("retrieval_time_invalid");
  if (!record.rawName.trim()) reasons.push("name_missing");
  return reasons;
}

/** Normalize provider data into an auditable candidate; no database writes occur. */
export function normalizeSeedCandidate(record: SeedRecord): NormalizedBusiness {
  const rawCity = clean(record.city);
  const structuredCity = rawCity ? canonicalPlace.get(rawCity.toLocaleLowerCase()) ?? rawCity : null;
  const city = structuredCity ?? addressCity(record.rawAddress);
  const country = clean(record.country);
  const name = record.rawName.trim().replace(/\s+/g, " ");
  const state = record.evidence.provenanceState ?? (record.evidence.source === "community" ? "DECLARED" : "POTENTIAL");
  const verification = record.evidence.verificationStatus ?? (state === "DECLARED" ? "declared" : state === "OBSERVED" ? "observed" : "unverified");
  const reviewReasons = validateSource(record);
  if (!city) reviewReasons.push("city_unresolved");
  if (rawCity && !canonicalPlace.has(rawCity.toLocaleLowerCase()) && addressCity(record.rawAddress) && normalizeText(rawCity) !== normalizeText(addressCity(record.rawAddress))) {
    reviewReasons.push("structured_city_conflicts_with_address");
  }
  const source = record.evidence.source;
  if (["overture", "openstreetmap"].includes(source) && (state === "VERIFIED" || verification === "verified")) {
    reviewReasons.push("external_source_cannot_self_verify");
  }
  const latitude = validCoordinate(record.latitude, -90, 90);
  const longitude = validCoordinate(record.longitude, -180, 180);
  if ((record.latitude !== null && latitude === null) || (record.longitude !== null && longitude === null)) reviewReasons.push("coordinates_invalid");
  return {
    name, normalizedName: normalizeText(name), category: clean(record.rawCategory), country,
    province: clean(record.province), city, area: clean(record.area), address: clean(record.rawAddress),
    phone: clean(record.phone), website: clean(record.website),
    communityKey: country && city ? `${normalizeText(country)}:${normalizeText(city)}` : null,
    latitude, longitude, evidence: { ...record.evidence, payload: record.evidence.payload },
    provenanceState: source === "overture" || source === "openstreetmap" ? "POTENTIAL" : state,
    verificationStatus: source === "overture" || source === "openstreetmap" ? "unverified" : verification,
    locationStatus: city ? "resolved" : "unresolved", reviewReasons,
  };
}

function phone(value: string | null | undefined): string { return (value ?? "").replace(/\D/g, ""); }
function website(value: string | null | undefined): string { return (value ?? "").trim().toLocaleLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""); }
function sameCity(a: string | null, b: string | null): boolean { return !!a && !!b && normalizeText(a) === normalizeText(b); }
function closeCoordinates(candidate: NormalizedBusiness, existing: ExistingSeedMatch): boolean {
  if (candidate.latitude === null || candidate.longitude === null || existing.latitude == null || existing.longitude == null) return false;
  return Math.abs(candidate.latitude - existing.latitude) <= 0.0005 && Math.abs(candidate.longitude - existing.longitude) <= 0.0005;
}

/**
 * Conservative comparison against canonical rows. A decision is advisory only:
 * proposed enrichment contains missing fields and never overwrites existing values.
 */
export function evaluateSeedCandidate(candidate: NormalizedBusiness, existing: ExistingSeedMatch[]): DeduplicationResult {
  const scored = existing.map((item) => {
    const signals: string[] = [];
    const cityMatches = sameCity(candidate.city, item.city);
    if (candidate.evidence.sourceId && item.sourceId && item.source === candidate.evidence.source && candidate.evidence.sourceId === item.sourceId) signals.push("source_record_id");
    if (candidate.normalizedName && candidate.normalizedName === normalizeText(item.name)) signals.push("normalized_name");
    if (phone(candidate.phone) && phone(candidate.phone) === phone(item.phone)) signals.push("phone");
    if (website(candidate.website) && website(candidate.website) === website(item.website)) signals.push("website");
    if (candidate.address && normalizeText(candidate.address) === normalizeText(item.address)) signals.push("address");
    if (closeCoordinates(candidate, item)) signals.push("coordinates");
    const strong = signals.includes("source_record_id") || (cityMatches && signals.includes("phone")) ||
      (cityMatches && signals.includes("normalized_name") && signals.some((signal) => ["website", "address", "coordinates"].includes(signal)));
    const medium = cityMatches && signals.includes("normalized_name") || signals.filter((signal) => signal !== "source_record_id").length >= 2;
    return { item, signals, cityMatches, strong, medium };
  }).filter((item) => item.signals.length).sort((a, b) => Number(b.strong) - Number(a.strong) || b.signals.length - a.signals.length);
  const match = scored[0];
  if (!match) return {
    decision: candidate.reviewReasons.length || !candidate.city ? "review" : "create_candidate",
    matchedExistingBusinessId: null, confidence: "low", matchingSignals: [], proposedEnrichment: {}, conflicts: [], reviewReasons: candidate.reviewReasons,
  };
  const conflicts: string[] = [];
  const proposedEnrichment: Record<string, string | number | null> = {};
  for (const key of ["category", "province", "city", "area", "address", "phone", "website", "latitude", "longitude"] as const) {
    const newValue = candidate[key];
    const oldValue = key === "latitude" || key === "longitude" ? match.item[key] ?? null : match.item[key] ?? null;
    if (newValue === null || newValue === "") continue;
    if (oldValue === null || oldValue === "") proposedEnrichment[key] = newValue;
    else if (normalizeText(String(newValue)) !== normalizeText(String(oldValue))) conflicts.push(key);
  }
  const reviewReasons = [...candidate.reviewReasons];
  if (!match.cityMatches && !match.signals.includes("source_record_id")) reviewReasons.push("location_conflicts_with_possible_match");
  if (!match.strong) reviewReasons.push("possible_duplicate_requires_review");
  if (conflicts.length) reviewReasons.push("canonical_field_conflicts_preserved");
  const locationConflict = !match.cityMatches && (candidate.city !== null || match.item.city !== null);
  const decision = !match.strong || locationConflict ? "review" :
    Object.keys(proposedEnrichment).length ? "enrich_candidate" : "duplicate";
  return {
    decision, matchedExistingBusinessId: match.item.id,
    confidence: match.strong ? "high" : match.medium ? "medium" : "low",
    matchingSignals: match.signals, proposedEnrichment, conflicts, reviewReasons,
  };
}
