/**
 * Maps validated corpus examples onto the runtime intent recognizer and
 * reports whether each example is classified as expected.
 *
 * This is the wire between the understanding corpus and runtime behavior:
 * every validated example should be recognized by `recognizeNonSearchIntent`
 * (or the local search parser) with the intent it claims. Mismatches are
 * reported so the corpus or the recognizer can be fixed — never silently
 * ignored.
 */
import { recognizeNonSearchIntent } from "../conversation-coordinator/intents.ts";
import type { RecognizedIntent } from "../conversation-coordinator/intents.ts";
import { parseLocalSearchRequest } from "../whatsapp/intent-parser.ts";
import type { NormalizedRequest } from "../answer-resolution/types.ts";
import type { UnderstandingExample } from "./corpus-schema.ts";
import { normalizePhrase } from "./corpus-validator.ts";

export interface IntentCheckResult {
  exampleId: string;
  phrase: string;
  expectedIntent: string;
  expectedQuestionType: string;
  recognized: RecognizedIntent | null;
  match: boolean;
  note: string;
}

function expectedQuestionType(intent: string): NormalizedRequest["questionType"] {
  const map: Record<string, NormalizedRequest["questionType"]> = {
    find_business: "business_discovery",
    find_provider: "provider_recommendation",
    ask_question: "community_question",
    report_issue: "community_question",
    add_business: "add_business",
    review_experience: "review_write",
    get_reviews: "reputation",
    profile_creation: "profile_creation",
    job_seeker: "recruitment",
    employer_recruiting: "recruitment",
    vacancy_search: "recruitment",
    candidate_search: "recruitment",
    vacancy_create: "recruitment",
    recruitment_status: "recruitment",
    recruitment_other: "recruitment",
    greeting: "general",
    help: "general",
    unsupported: "unknown",
  };
  return map[intent] ?? "unknown";
}

/**
 * Finds a validated corpus example whose normalized phrase exactly matches the
 * incoming text, and returns the corresponding runtime request.
 *
 * Precedence contract: callers must consult the explicit deterministic
 * recognizers (`parseLocalSearchRequest`, `recognizeNonSearchIntent`) FIRST and
 * only fall back to this corpus match when they return null. A weak corpus
 * match never overrides a clear, high-confidence existing intent.
 *
 * Greeting/help/unsupported examples (questionType `general`/`unknown`) are
 * deliberately not routed here: they are handled by the coordinator's existing
 * greeting and fallback paths, and routing them to the resolver would regress
 * behavior when no AI provider is configured (the `general` source is `ai`).
 */
export function matchExample(text: string, examples: UnderstandingExample[]): NormalizedRequest | null {
  const normalized = normalizePhrase(text);
  for (const ex of examples) {
    if (ex.validation !== "validated") continue;
    if (normalizePhrase(ex.phrase) !== normalized) continue;
    const questionType = expectedQuestionType(ex.intent);
    if (questionType === "general" || questionType === "unknown") return null;
    return {
      text: text.trim(),
      intent: ex.intent as NormalizedRequest["intent"],
      category: null,
      location: null,
      questionType,
    };
  }
  return null;
}

export function checkCorpusIntents(examples: UnderstandingExample[]): IntentCheckResult[] {
  const results: IntentCheckResult[] = [];
  for (const ex of examples) {
    if (ex.validation !== "validated") continue;
    const recognized = recognizeNonSearchIntent(ex.phrase);
    const search = parseLocalSearchRequest(ex.phrase);
    const effective = recognized ?? (search ? { intent: search.intent as NormalizedRequest["intent"], questionType: search.questionType, request: search } as RecognizedIntent : null);
    const expectedQT = expectedQuestionType(ex.intent);
    // Greeting/help/unsupported are deliberately not classified by
    // recognizeNonSearchIntent; null recognition is the correct outcome and
    // they are routed by the general answer path instead.
    const nullRecognizedMatch = (ex.intent === "greeting" || ex.intent === "help" || ex.intent === "unsupported") && effective === null;
    const match = nullRecognizedMatch || (effective !== null
      && effective.intent === ex.intent
      && effective.questionType === expectedQT);
    results.push({
      exampleId: ex.id,
      phrase: ex.phrase,
      expectedIntent: ex.intent,
      expectedQuestionType: expectedQT,
      recognized: effective,
      match,
      note: match ? "" : effective ? `recognized as ${effective.intent}/${effective.questionType}` : "not recognized",
    });
  }
  return results;
}

export function corpusIntentReport(examples: UnderstandingExample[]): {
  total: number;
  matched: number;
  mismatched: IntentCheckResult[];
  matchRate: number;
} {
  const results = checkCorpusIntents(examples);
  const mismatched = results.filter((r) => !r.match);
  return {
    total: results.length,
    matched: results.length - mismatched.length,
    mismatched,
    matchRate: results.length === 0 ? 1 : (results.length - mismatched.length) / results.length,
  };
}
