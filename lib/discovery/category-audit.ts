import { SERVICE_TAXONOMY, normalizeServiceText, expandTerm, type ServiceConcept } from "./service-taxonomy.ts";

/** Read-only category quality audit. It proposes classifications for human review and never writes anything. */
export interface AuditBusiness { id: string; name: string | null; category: string | null; subcategory: string | null; description?: string | null }

export interface CategorySuggestion {
  id: string;
  name: string;
  conceptId: string;
  label: string;
  family: string;
  confidence: "high" | "candidate";
  basis: "name" | "subcategory" | "description";
  matchedTerm: string;
  /** Other concepts the same text also matched, which is why a record is only a candidate. */
  alternatives: string[];
}

export interface CategoryAuditReport {
  total: number;
  missingCategory: number;
  blankCategory: number;
  missingSubcategory: number;
  missingBoth: number;
  distinctCategories: number;
  genericCategories: { value: string; count: number }[];
  casingVariants: { normalized: string; variants: { value: string; count: number }[] }[];
  /** Different spellings of the same service, e.g. "Plumber" and "Plumbing". */
  namingGroups: { conceptId: string; label: string; variants: { value: string; count: number }[] }[];
  highConfidence: CategorySuggestion[];
  uncertain: CategorySuggestion[];
  insufficient: { count: number; sampleIds: string[] };
  limits: string[];
}

const GENERIC = new Set(["other", "others", "business", "businesses", "general", "misc", "miscellaneous", "service", "services", "n a", "na", "none", "unknown", "uncategorized", "uncategorised", "null", "undefined", "test", "company", "shop", "store"]);
/** Words that appear in business names without reliably meaning the category (a "Motors" name is not always a dealership). */
const WEAK_TERMS = new Set(["motors", "club", "bar", "inn", "trust", "foundation", "assembly", "academy", "institute", "coffee", "bread", "steel", "wedding", "events", "hall", "court", "council", "school", "college", "university", "legal", "fabric", "shuttle", "grill", "dining", "tents", "books", "beds", "cement", "brick", "bricks", "maize", "seed", "seeds", "farm", "fashion", "clothes", "shoes", "lodge", "resort", "spa", "wifi", "internet", "fibre", "fiber", "solar", "generator", "church", "temple", "relief", "shelter", "doctor", "surgery", "glasses", "mc", "dj", "gp", "isp", "ngo"]);
const SAMPLE_LIMIT = 25;

const blank = (value: string | null | undefined) => !value || !value.trim();

interface Hit { concept: ServiceConcept; term: string }

function hitsIn(text: string | null | undefined): Hit[] {
  const normalized = normalizeServiceText(text);
  if (!normalized) return [];
  const padded = ` ${normalized} `;
  const hits: Hit[] = [];
  for (const concept of SERVICE_TAXONOMY.concepts) {
    if (concept.excludes.some((exclude) => padded.includes(` ${normalizeServiceText(exclude)} `))) continue;
    const term = concept.terms.flatMap((item) => expandTerm(normalizeServiceText(item))).filter((item) => padded.includes(` ${item} `)).sort((left, right) => right.length - left.length)[0];
    if (term) hits.push({ concept, term });
  }
  return hits;
}

function strongTerm(term: string): boolean {
  return term.includes(" ") ? !WEAK_TERMS.has(term) : term.length >= 6 && !WEAK_TERMS.has(term);
}

function suggest(record: AuditBusiness, basis: CategorySuggestion["basis"], text: string | null | undefined): CategorySuggestion | null {
  const hits = hitsIn(text);
  if (!hits.length) return null;
  // The longest matched phrase is the most specific evidence; ties across concepts stay ambiguous.
  const longest = Math.max(...hits.map((hit) => hit.term.length));
  const top = hits.filter((hit) => hit.term.length === longest);
  const [lead] = top;
  const alternatives = hits.filter((hit) => hit !== lead).map((hit) => hit.concept.id);
  const high = top.length === 1 && hits.length === 1 && strongTerm(lead.term) && basis !== "description";
  return { id: record.id, name: record.name ?? "", conceptId: lead.concept.id, label: lead.concept.label, family: lead.concept.family, confidence: high ? "high" : "candidate", basis, matchedTerm: lead.term, alternatives };
}

export function auditBusinessCategories(records: AuditBusiness[]): CategoryAuditReport {
  const report: CategoryAuditReport = {
    total: records.length, missingCategory: 0, blankCategory: 0, missingSubcategory: 0, missingBoth: 0, distinctCategories: 0,
    genericCategories: [], casingVariants: [], namingGroups: [], highConfidence: [], uncertain: [], insufficient: { count: 0, sampleIds: [] },
    limits: ["Suggestions come only from the business name, subcategory and (when supplied) description; nothing is written or assigned.", "A name match is evidence of the service offered, not of verification or quality."],
  };
  const categories = new Map<string, Map<string, number>>();
  const generic = new Map<string, number>();
  const groups = new Map<string, { concept: ServiceConcept; variants: Map<string, number> }>();

  for (const record of records) {
    const missingCategory = blank(record.category);
    const missingSubcategory = blank(record.subcategory);
    if (record.category === null || record.category === undefined) report.missingCategory += 1;
    else if (missingCategory) { report.missingCategory += 1; report.blankCategory += 1; }
    if (missingSubcategory) report.missingSubcategory += 1;
    if (missingCategory && missingSubcategory) report.missingBoth += 1;

    let genericCategory = false;
    if (!missingCategory) {
      const value = record.category!.trim();
      const normalized = normalizeServiceText(value);
      if (GENERIC.has(normalized)) { genericCategory = true; generic.set(value, (generic.get(value) ?? 0) + 1); }
      const variants = categories.get(normalized) ?? new Map<string, number>();
      variants.set(value, (variants.get(value) ?? 0) + 1);
      categories.set(normalized, variants);
      const intent = genericCategory ? null : SERVICE_TAXONOMY.resolve(value);
      if (intent?.kind === "concept") {
        const group = groups.get(intent.concept.id) ?? { concept: intent.concept, variants: new Map<string, number>() };
        group.variants.set(value, (group.variants.get(value) ?? 0) + 1);
        groups.set(intent.concept.id, group);
      }
    }

    if (!missingCategory && !genericCategory) continue;
    const found = suggest(record, "name", record.name) ?? (blank(record.subcategory) ? null : suggest(record, "subcategory", record.subcategory)) ?? (blank(record.description) ? null : suggest(record, "description", record.description));
    if (!found) { report.insufficient.count += 1; if (report.insufficient.sampleIds.length < SAMPLE_LIMIT) report.insufficient.sampleIds.push(record.id); continue; }
    (found.confidence === "high" ? report.highConfidence : report.uncertain).push(found);
  }

  report.distinctCategories = categories.size;
  report.genericCategories = [...generic].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count);
  report.casingVariants = [...categories].filter(([, variants]) => variants.size > 1)
    .map(([normalized, variants]) => ({ normalized, variants: [...variants].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count) }))
    .sort((left, right) => right.variants.length - left.variants.length);
  report.namingGroups = [...groups.values()].filter((group) => normalizedDistinct(group.variants) > 1)
    .map((group) => ({ conceptId: group.concept.id, label: group.concept.label, variants: [...group.variants].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count) }));
  return report;
}

function normalizedDistinct(variants: Map<string, number>): number { return new Set([...variants.keys()].map((value) => normalizeServiceText(value))).size; }
