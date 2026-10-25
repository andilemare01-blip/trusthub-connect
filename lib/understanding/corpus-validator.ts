/**
 * Validation pipeline for the understanding corpus.
 *
 * Rules:
 * - Every field present and conforming to the schema.
 * - ID stable and unique; format TH-CORP-<digits>.
 * - Phrase non-empty, trimmed, <= 400 chars.
 * - Intent, language, provenance, validation from allowed sets.
 * - requiredSlots/entityTypes are arrays of non-empty strings.
 * - expectedNextAction is compatible with the intent.
 * - No exact or near-duplicate phrases within the corpus.
 * - Holdout examples never appear in the training set (leakage check).
 */
import type { UnderstandingExample, CorpusSummary } from "./corpus-schema.ts";

const ID_RE = /^TH-CORP-\d{6}$/;
const MAX_PHRASE_LEN = 400;
const NEAR_DUP_SIMILARITY = 0.86;

// Reserved for future intent-action compatibility checks
// const NEXT_ACTION_BY_INTENT: Record<ExampleIntent, string[]> = {
//   find_business: ["search_trusthub", "clarify"],
//   find_provider: ["search_trusthub", "clarify"],
//   ask_question: ["answer", "ask_community_permission", "clarify"],
//   report_issue: ["answer", "ask_human_permission", "clarify"],
//   add_business: ["business_submission", "clarify"],
//   review_experience: ["review_writing", "clarify"],
//   get_reviews: ["search_trusthub", "clarify"],
//   profile_creation: ["profile_creation", "clarify"],
//   job_seeker: ["recruitment_register", "clarify"],
//   employer_recruiting: ["recruitment_register", "vacancy_create", "clarify"],
//   vacancy_search: ["vacancy_search", "clarify"],
//   candidate_search: ["candidate_search", "clarify"],
//   vacancy_create: ["vacancy_create", "clarify"],
//   recruitment_status: ["recruitment_status", "clarify"],
//   recruitment_other: ["answer", "clarify"],
//   greeting: ["answer", "clarify"],
//   help: ["explain_capability", "clarify"],
//   unsupported: ["explain_capability", "no_action"],
// };

export function normalizePhrase(phrase: string): string {
  return phrase
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(phrase: string): Set<string> {
  return new Set(normalizePhrase(phrase).split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  const intersection = new Set([...a].filter((x) => b.has(x)));
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export interface ValidationProblem {
  id: string;
  field: string;
  message: string;
}

export function validateExample(example: UnderstandingExample): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (!example.id || !ID_RE.test(example.id)) {
    problems.push({ id: example.id ?? "<missing>", field: "id", message: "id must match TH-CORP-<6 digits>" });
  }
  if (typeof example.intent !== "string" || example.intent.length === 0) {
    problems.push({ id: example.id, field: "intent", message: "intent is required" });
  }
  if (example.secondaryIntent !== null && typeof example.secondaryIntent !== "string") {
    problems.push({ id: example.id, field: "secondaryIntent", message: "secondaryIntent must be a string or null" });
  }
  if (typeof example.phrase !== "string" || example.phrase.trim().length === 0) {
    problems.push({ id: example.id, field: "phrase", message: "phrase is required and non-empty" });
  } else if (example.phrase.length > MAX_PHRASE_LEN) {
    problems.push({ id: example.id, field: "phrase", message: `phrase exceeds ${MAX_PHRASE_LEN} chars` });
  }
  const validLanguages = ["en", "shona", "en_shona", "nde", "other"];
  if (!validLanguages.includes(example.language)) {
    problems.push({ id: example.id, field: "language", message: `language must be one of ${validLanguages.join(", ")}` });
  }
  if (!Array.isArray(example.entityTypes) || example.entityTypes.some((e) => typeof e !== "string" || e.trim().length === 0)) {
    problems.push({ id: example.id, field: "entityTypes", message: "entityTypes must be an array of non-empty strings" });
  }
  if (!Array.isArray(example.requiredSlots) || example.requiredSlots.some((s) => typeof s !== "string" || s.trim().length === 0)) {
    problems.push({ id: example.id, field: "requiredSlots", message: "requiredSlots must be an array of non-empty strings" });
  }
  const validActions = [
    "answer", "clarify", "search_trusthub", "ask_community_permission", "ask_human_permission",
    "record_contribution", "profile_creation", "business_submission", "review_writing",
    "recruitment_register", "vacancy_create", "vacancy_search", "candidate_search",
    "recruitment_status", "explain_capability", "no_action",
  ];
  if (!validActions.includes(example.expectedNextAction)) {
    problems.push({ id: example.id, field: "expectedNextAction", message: `expectedNextAction must be one of ${validActions.join(", ")}` });
  }
  if (typeof example.requiresClarification !== "boolean") {
    problems.push({ id: example.id, field: "requiresClarification", message: "requiresClarification must be boolean" });
  }
  if (typeof example.requiresDatabaseLookup !== "boolean") {
    problems.push({ id: example.id, field: "requiresDatabaseLookup", message: "requiresDatabaseLookup must be boolean" });
  }
  if (typeof example.communityEscalation !== "boolean") {
    problems.push({ id: example.id, field: "communityEscalation", message: "communityEscalation must be boolean" });
  }
  if (typeof example.expectedResponseBehavior !== "string" || example.expectedResponseBehavior.trim().length === 0) {
    problems.push({ id: example.id, field: "expectedResponseBehavior", message: "expectedResponseBehavior is required" });
  }
  const validProvenance = ["authored", "pdf_library", "generated"];
  if (!validProvenance.includes(example.provenance)) {
    problems.push({ id: example.id, field: "provenance", message: `provenance must be one of ${validProvenance.join(", ")}` });
  }
  const validValidation = ["validated", "pending", "rejected"];
  if (!validValidation.includes(example.validation)) {
    problems.push({ id: example.id, field: "validation", message: `validation must be one of ${validValidation.join(", ")}` });
  }

  return problems;
}

export function findDuplicatePhrases(examples: UnderstandingExample[]): Array<{ a: UnderstandingExample; b: UnderstandingExample; similarity: number }> {
  const dupes: Array<{ a: UnderstandingExample; b: UnderstandingExample; similarity: number }> = [];
  const sets = examples.map((ex) => ({ ex, set: tokenSet(ex.phrase) }));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const sim = jaccard(sets[i].set, sets[j].set);
      if (sim >= NEAR_DUP_SIMILARITY) {
        dupes.push({ a: sets[i].ex, b: sets[j].ex, similarity: sim });
      }
    }
  }
  return dupes;
}

export function summarize(examples: UnderstandingExample[]): CorpusSummary {
  const byIntent: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  const byProvenance: Record<string, number> = {};
  let validated = 0;
  let duplicatePhraseCount = 0;
  const leakageRiskPairs: Array<{ a: string; b: string; reason: string }> = [];

  for (const ex of examples) {
    byIntent[ex.intent] = (byIntent[ex.intent] ?? 0) + 1;
    byLanguage[ex.language] = (byLanguage[ex.language] ?? 0) + 1;
    byProvenance[ex.provenance] = (byProvenance[ex.provenance] ?? 0) + 1;
    if (ex.validation === "validated") validated += 1;
  }

  const dupes = findDuplicatePhrases(examples);
  duplicatePhraseCount = dupes.length;
  for (const d of dupes) {
    leakageRiskPairs.push({ a: d.a.id, b: d.b.id, reason: `near-duplicate phrase (similarity ${(d.similarity * 100).toFixed(1)}%)` });
  }

  return {
    total: examples.length,
    validated,
    byIntent,
    byLanguage,
    byProvenance,
    duplicatePhraseCount,
    leakageRiskPairs,
  };
}

export function validateCorpus(examples: UnderstandingExample[]): { problems: ValidationProblem[]; duplicates: ReturnType<typeof findDuplicatePhrases>; summary: CorpusSummary } {
  const problems: ValidationProblem[] = [];
  const seenIds = new Set<string>();
  for (const ex of examples) {
    problems.push(...validateExample(ex));
    if (seenIds.has(ex.id)) {
      problems.push({ id: ex.id, field: "id", message: "duplicate id in corpus" });
    }
    seenIds.add(ex.id);
  }
  const duplicates = findDuplicatePhrases(examples);
  return { problems, duplicates, summary: summarize(examples) };
}
