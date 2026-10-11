import type { NormalizedRequest } from "../answer-resolution/types";
import { SERVICE_TAXONOMY, isFocusedServiceRequest } from "../discovery/service-taxonomy.ts";

/** "How about …", "What about …" and "Any … in …" are ordinary search wording, not questions. */
const SEARCH_PHRASE = /\b(?:find|need|want|looking for|search for|recommend|where can i find|who sells|looking to buy)\b\s+(.*)$/i;
const HOW_ABOUT = /^(?:how about|what about|how 'bout|what 'bout)\s+(.+)$/i;
/** "Any hair salons in Harare?" — the location is required so a bare "any money" cannot match. */
const ANY_IN = /^(?:any|some)\s+(.+?)\s+(?:in|near|around|within)\s+(.+)$/i;
// "a store that sells phones in Harare" — a retailer of something.
// "cells" is an ordinary misspelling of "sells"; both are accepted,
// along with the other ways people phrase "a shop that has X".
const RETAILER_PATTERN = /^(?:a|an|the|some|any|good|local|reliable|nearby|new|best)?\s*(?:store|shop|place|dealer|outlet|market|stall|booth)\s+(?:that|which|who)\s+(?:sells|cells|sale|sell|selling|has|carries|stocks|deals\s+in|offers|provides)\s+(.+)$/i;
const LOCATION_PHRASE = /\b(?:in|near|around|within)\s+(.+)$/i;

function cleanPhrase(value: string): string {
  return value.trim().replace(/[?.!,;:]+$/, "").replace(/\s+(?:please|thanks|today|near me)$/i, "").trim();
}

const MAX_PARSE_CHARS = 500;

function locationFrom(locationPhrase: string | null): { city: string | null; country: string | null } {
  let city = locationPhrase && /^(?:me|my area|here)$/i.test(locationPhrase) ? null : locationPhrase;
  let country: string | null = "Zimbabwe";
  if (locationPhrase?.includes(",")) {
    const parts = locationPhrase.split(",").map((part) => part.trim()).filter(Boolean);
    city = parts[0] ?? null;
    country = parts[1] ?? country;
  }
  return { city, country };
}

function build(text: string, category: string | null, locationPhrase: string | null, recommendation: boolean, serviceConcept: string | null, ambiguity?: { question: string; options: string[] }): NormalizedRequest {
  const { city, country } = locationFrom(locationPhrase);
  return {
    text: text.trim(),
    intent: recommendation ? "find_provider" : "find_business",
    category,
    location: { country, city },
    questionType: recommendation ? "provider_recommendation" : "business_discovery",
    ...(serviceConcept ? { serviceConcept } : {}),
    ...(ambiguity ? { ambiguity } : {}),
  };
}

/** Adds the taxonomy's reading of a category phrase; a phrase with several plausible meanings becomes a question. */
/**
 * Splits one search phrase into its service and its location. A recommendation
 * such as "a good plumber in Harare called Mr Moyo" puts the named person
 * between the service and the place, so the named person is stripped before the
 * location is read; otherwise "Harare called Mr Moyo" is stored as the city.
 * An existing location is kept when the phrase has none of its own.
 */
function splitServiceAndLocation(phrase: string, existingLocation: string | null = null): { categoryPhrase: string; locationPhrase: string | null } {
  const cleaned = cleanPhrase(phrase);
  // "called <name>" and "named <name>" mark a person, not a place. They are
  // stripped before the location is read: otherwise the location regex grabs
  // "in Harare called Mr Moyo" and stores "Harare called Mr Moyo" as the city.
  const named = cleaned.match(/\b(?:called|named|known as)\s+([\p{L}][\p{L}\s'.-]{1,40})$/u);
  const withoutName = named ? cleaned.slice(0, named.index).trim() : cleaned;
  const locationMatch = withoutName.match(LOCATION_PHRASE);
  const locationPhrase = locationMatch ? cleanPhrase(locationMatch[1]) : existingLocation;
  const categoryPhrase = cleanPhrase(locationMatch ? withoutName.slice(0, locationMatch.index) : withoutName)
    .replace(/^(?:(?:me\s+)?(?:a|an|the|any|good|local|reliable)\s+)+/i, "");
  return { categoryPhrase, locationPhrase };
}

/** Adds the taxonomy's reading of a category phrase; a phrase with several plausible meanings becomes a question. */
function annotate(text: string, category: string, locationPhrase: string | null, recommendation: boolean): NormalizedRequest {
  const intent = SERVICE_TAXONOMY.resolve(category);
  if (intent?.kind === "concept") return build(text, category, locationPhrase, recommendation, intent.concept.id);
  if (intent?.kind === "ambiguous") return build(text, null, locationPhrase, recommendation, null, { question: intent.question, options: intent.options.map((option) => option.label) });
  return build(text, category, locationPhrase, recommendation, null);
}

/** Deterministic no-provider fallback. The city comes from user text, never a hard-coded city list. */
export function parseLocalSearchRequest(text: string): NormalizedRequest | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_PARSE_CHARS) return undefined;

  // "How about a car rental company?" and "What about car hire?" are ordinary search wording.
  const howAbout = HOW_ABOUT.exec(trimmed);
  if (howAbout) {
    const { categoryPhrase, locationPhrase } = splitServiceAndLocation(howAbout[1]);
    if (categoryPhrase) return annotate(trimmed, categoryPhrase, locationPhrase, /\b(?:recommend|good|reliable|best)\b/i.test(trimmed));
  }

  // "Any hair salons in Harare?" — the location is required so a bare "any money" cannot match.
  const anyIn = ANY_IN.exec(trimmed);
  if (anyIn) {
    const { categoryPhrase, locationPhrase } = splitServiceAndLocation(`${anyIn[1]} in ${anyIn[2]}`);
    if (categoryPhrase) return annotate(trimmed, categoryPhrase, locationPhrase, false);
  }

  const match = trimmed.match(SEARCH_PHRASE);
  if (match) {
    const { categoryPhrase, locationPhrase } = splitServiceAndLocation(match[1]);
    if (categoryPhrase) return annotate(trimmed, categoryPhrase, locationPhrase, /\b(?:recommend|good|reliable|best)\b/i.test(match[0]));
  }

  // "A store that sells phones in Harare" — a retailer of something, phrased
  // without a search verb. A shop that sells X is an "X shop", so the item is
  // singularised and read as the shop category the taxonomy knows ("phones"
  // becomes a "phone shop" search); anything the taxonomy does not know as a
  // shop falls back to the item itself.
  const retailer = RETAILER_PATTERN.exec(trimmed);
  if (retailer) {
    const { categoryPhrase, locationPhrase } = splitServiceAndLocation(retailer[1]);
    if (categoryPhrase) {
      const shopCategory = `${categoryPhrase.replace(/s$/, "")} shop`;
      const shopified = SERVICE_TAXONOMY.resolve(shopCategory);
      if (shopified?.kind === "concept") return annotate(trimmed, shopCategory, locationPhrase, false);
      return annotate(trimmed, categoryPhrase, locationPhrase, /\b(?:recommend|good|reliable|best)\b/i.test(trimmed));
    }
  }

  // No request verb: accept ordinary phrasing ("where can I learn to drive", "my tap is leaking") only when the
  // taxonomy recognises a service the message is mainly about.
  const named = trimmed.match(/\b(?:called|named|known as)\s+([\p{L}][\p{L}\s'.-]{1,40})$/u);
  const withoutName = named ? trimmed.slice(0, named.index).trim() : trimmed;
  const locationMatch = withoutName.match(LOCATION_PHRASE);
  const locationPhrase = locationMatch ? cleanPhrase(locationMatch[1]) : null;
  const recommendation = /\b(?:recommend|good|reliable|best)\b/i.test(trimmed);
  const core = cleanPhrase(locationMatch ? withoutName.slice(0, locationMatch.index) : withoutName);
  const intent = SERVICE_TAXONOMY.resolve(core);
  if (intent?.kind === "concept" && isFocusedServiceRequest(core, intent.matched, intent.via)) {
    return build(trimmed, intent.via === "ask" ? intent.concept.label : intent.matched, locationPhrase, recommendation, intent.concept.id);
  }
  if (intent?.kind === "ambiguous" && core.split(/\s+/).length <= 8) {
    return build(trimmed, null, locationPhrase, recommendation, null, { question: intent.question, options: intent.options.map((option) => option.label) });
  }
  return undefined;
}
