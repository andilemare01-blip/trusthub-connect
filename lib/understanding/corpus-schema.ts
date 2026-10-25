/**
 * Schema for one validated understanding example in the TrustHub Connect
 * understanding corpus.
 *
 * Each example is a structured, version-controlled training/validation asset
 * that feeds runtime intent recognition. Provenance labels track whether an
 * entry is authored (hand-written), derived from the PDF-sourced Wisdom
 * library, or synthetic/generated for coverage. AI-generated entries are
 * never blindly merged — they must pass the same validation as authored ones.
 */
export type ExampleLanguage = "en" | "shona" | "en_shona" | "nde" | "other";
export type ExampleProvenance = "authored" | "pdf_library" | "generated";
export type ExampleValidation = "validated" | "pending" | "rejected";
export type ExampleIntent =
  | "find_business"
  | "find_provider"
  | "ask_question"
  | "report_issue"
  | "add_business"
  | "review_experience"
  | "get_reviews"
  | "profile_creation"
  | "job_seeker"
  | "employer_recruiting"
  | "vacancy_search"
  | "candidate_search"
  | "vacancy_create"
  | "recruitment_status"
  | "recruitment_other"
  | "greeting"
  | "help"
  | "unsupported";

export interface UnderstandingExample {
  /** Stable example ID (never reused across versions). */
  id: string;
  /** Canonical primary intent. */
  intent: ExampleIntent;
  /** Optional secondary intent when a phrase plausibly covers two workflows. */
  secondaryIntent: ExampleIntent | null;
  /** Exact user wording, including typos/local expressions as written. */
  phrase: string;
  /** Language or locale of the example. */
  language: ExampleLanguage;
  /** Entity types mentioned (city, role, category, skill, business name...). */
  entityTypes: string[];
  /** Slots that must be resolved before a useful answer is possible. */
  requiredSlots: string[];
  /** Expected next action taken by the runtime. */
  expectedNextAction:
    | "answer"
    | "clarify"
    | "search_trusthub"
    | "ask_community_permission"
    | "ask_human_permission"
    | "record_contribution"
    | "profile_creation"
    | "business_submission"
    | "review_writing"
    | "recruitment_register"
    | "vacancy_create"
    | "vacancy_search"
    | "candidate_search"
    | "recruitment_status"
    | "explain_capability"
    | "no_action";
  /** Whether the runtime must ask one clarifying question before acting. */
  requiresClarification: boolean;
  /** Whether the runtime must query TrustHub/knowledge data. */
  requiresDatabaseLookup: boolean;
  /** Whether community escalation is appropriate. */
  communityEscalation: boolean;
  /** Expected safe response behavior summary. */
  expectedResponseBehavior: string;
  /** Provenance label. */
  provenance: ExampleProvenance;
  /** Validation status. */
  validation: ExampleValidation;
}

export interface CorpusSummary {
  total: number;
  validated: number;
  byIntent: Record<string, number>;
  byLanguage: Record<string, number>;
  byProvenance: Record<string, number>;
  duplicatePhraseCount: number;
  leakageRiskPairs: Array<{ a: string; b: string; reason: string }>;
}
