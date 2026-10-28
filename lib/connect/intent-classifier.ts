/**
 * Offline intent suggestions for TrustHub Connect. A multinomial Naive Bayes
 * model trained on the labelled Wisdom dataset (see
 * scripts/build-connect-intent-model.ts). It needs no AI provider.
 *
 * It is never used to act on a message. Its suggestions are only offered as
 * "Did you mean…?" buttons when no rule matched, and a tap confirms the intent.
 */
import { CONNECT_INTENT_MODEL } from "./intent-classifier.generated.ts";
import { INTENT_ROUTE, type ConnectRoute } from "./intent-routes.ts";

export interface IntentModel {
  readonly intents: readonly string[];
  readonly docCount: readonly number[];
  readonly tokenTotals: readonly number[];
  readonly vocabulary: number;
  readonly rows: number;
  /** word -> [intentIndex, count] pairs for every intent that uses the word. */
  readonly tokens: Readonly<Record<string, readonly (readonly [number, number])[]>>;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/'/g, "").split(/\s+/).filter((word) => word.length > 1);
}

/** Probability of every intent for this text, most likely first. Unknown words are ignored. */
export function distribution(model: IntentModel, text: string): { intent: string; probability: number }[] {
  const words = tokenize(text).filter((word) => model.tokens[word]);
  const scores = model.intents.map((_, i) => Math.log(model.docCount[i] / model.rows));
  for (const word of words) {
    const hits = new Map(model.tokens[word]);
    for (let i = 0; i < scores.length; i += 1) {
      scores[i] += Math.log(((hits.get(i) ?? 0) + 1) / (model.tokenTotals[i] + model.vocabulary));
    }
  }
  const max = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return model.intents.map((intent, i) => ({ intent, probability: exps[i] / total })).sort((a, b) => b.probability - a.probability);
}

export interface RouteSuggestion { route: ConnectRoute; probability: number }

/** The most likely routes (at most three), each above a minimum probability. Empty when nothing is plausible. */
export function suggestRoutes(text: string, model: IntentModel = CONNECT_INTENT_MODEL, minimum = 0.15): RouteSuggestion[] {
  if (!tokenize(text).some((word) => model.tokens[word])) return [];
  const byRoute = new Map<ConnectRoute, number>();
  for (const { intent, probability } of distribution(model, text)) {
    const route = INTENT_ROUTE[intent];
    if (route) byRoute.set(route, (byRoute.get(route) ?? 0) + probability);
  }
  return [...byRoute.entries()]
    .map(([route, probability]) => ({ route, probability }))
    .filter((item) => item.probability >= minimum && item.route !== "community" && item.route !== "social")
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}
