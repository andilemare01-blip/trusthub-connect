export interface DetectedContribution {
  kind: "provider_recommendation" | "capability_declaration";
  originalText: string;
  category: string;
  providerName: string | null;
  city: string | null;
  area: string | null;
  verificationStatus: "declared";
}

function clean(value: string): string {
  return value.trim().replace(/[.!?,;:]+$/, "").replace(/\s+/g, " ");
}

/**
 * "a good plumber in Harare called Mr Moyo" puts the location between the
 * service and the name, so the extracted category still carries it. The place
 * is split back out instead of being stored as part of the service.
 */
function splitLocation(category: string, city: string | null): { category: string; city: string | null } {
  const separated = /^(.*?)\s+(?:in|around|near)\s+([\p{L}][\p{L}\s-]{1,60})$/u.exec(category);
  if (!separated) return { category, city };
  const service = clean(separated[1]);
  const place = clean(separated[2]);
  return service ? { category: service, city: city ?? place } : { category, city };
}

/** Extracts a conservative candidate from explicit first-person messages; no facts are verified here. */
export function detectContribution(text: string): DetectedContribution | null {
  const originalText = text.trim();
  if (!originalText || originalText.length > 5000) return null;

  const recommendation = originalText.match(/\b(?:i know|i recommend|try|contact)\s+(?:a|an|the)?\s*([\p{L}][\p{L}\s&-]{1,50}?)\s+(?:called|named)\s+([\p{L}][\p{L}\s.'-]{0,80}?)(?:\s+(?:in|around|near)\s+([\p{L}][\p{L}\s-]{1,60}))?(?:[.!?,;:]|$)/iu);
  if (recommendation) {
    const separated = splitLocation(clean(recommendation[1]), recommendation[3] ? clean(recommendation[3]) : null);
    const providerName = clean(recommendation[2]);
    if (separated.category && providerName) return { kind: "provider_recommendation", originalText, category: separated.category, providerName, city: separated.city, area: null, verificationStatus: "declared" };
  }

  // "I'm looking for a plumber" is a search, not a declaration of what the
  // sender does, so the look-for phrasing is excluded before the profession is
  // read. Without this the sentence is stored as the sender's own capability
  // and never searched for.
  const capability = originalText.match(/\b(?:i am|i'm|i work as|my business is)\s+(?!looking\s+for\b|searching\s+for\b|in\s+search\s+of\b|after\b)(?:a|an)?\s*([\p{L}][\p{L}\s&-]{1,50}?)(?:\s+(?:in|around|near)\s+([\p{L}][\p{L}\s-]{1,60}))?(?:[.!?,;:]|$)/iu);
  if (capability) {
    const category = clean(capability[1]);
    const city = capability[2] ? clean(capability[2]) : null;
    if (category) return { kind: "capability_declaration", originalText, category, providerName: null, city, area: null, verificationStatus: "declared" };
  }

  return null;
}
