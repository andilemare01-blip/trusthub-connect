/**
 * Plain-language routing rules for TrustHub Connect. Each rule is a small,
 * testable pattern. They run before any model, so a clear message always
 * behaves the same way, and an AI provider outage never changes what a
 * simple question does.
 */
import { categorise, parsePlace } from "./parse.ts";

/** Words that describe the request itself, never the business or item being asked about. */
const REVIEW_WORDS = new Set([
  "people", "say", "saying", "said", "think", "thinking", "reviews", "review", "feedback", "opinions", "opinion",
  "rating", "ratings", "customers", "customer", "clients", "others", "everyone", "locals", "see", "read", "show",
  "tell", "about", "what", "reliable", "trusted", "legit", "honest", "good", "any", "are", "there", "would", "like",
  "want", "know", "places", "place", "businesses", "business", "how", "they", "does", "their", "really", "please",
]);

const FILLER_WORDS = new Set([
  "would", "like", "have", "with", "from", "this", "that", "your", "their", "them", "they", "some", "anything",
  "something", "there", "here", "please", "can", "you", "did", "does", "say", "tell", "for", "the", "and", "any",
  "who", "why", "when", "much", "more", "very", "much", "could", "should", "want", "need", "know", "see",
]);

/**
 * "What do people say about chicken in Chiredzi?", "reviews for Sunny Bakery",
 * "is Mai Zhou Catering reliable?". Returns the search terms and town, or null
 * when the message is not asking to read reviews.
 */
export function readReviewsQuestion(text: string): { terms: string[]; city: string | null } | null {
  const message = text.trim();
  const asksForReviews = /\breviews?\b|\bfeedback\b|\bopinions?\b|\bratings?\b/i.test(message)
    || /\bwhat\s+(?:(?:do|does|did|are|is|were)\s+)?(?:people|customers|clients|others|everyone|locals|they)\b.*\b(?:say|saying|said|think|thinking)\b/i.test(message)
    || /\bhow (?:is|are)\s+.+\b(?:people|customers|service)\b/i.test(message)
    || /^\s*(?:is|are)\s+.+?\s+(?:any good|good|reliable|trusted|trustworthy|legit|honest|safe)\s*\??\s*$/i.test(message);
  // Writing or answering a review is not a request to read them.
  const writing = /\b(?:write|leave|give|post|submit|add|rate|respond|reply|answer)\b[^.?!]*\breviews?\b|\breviews?\b[^.?!]*\b(?:write|leave|respond|reply)\b|\bhow (?:do|can|should) i (?:respond|reply|answer)\b/i.test(message);
  if (!asksForReviews || writing) return null;
  const place = parsePlace(message);
  let stripped = message;
  for (const value of [place.area, place.city]) if (value) stripped = stripped.replace(new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  // Filter before capping: keywords() keeps only six words, which filler words could push the subject out of.
  const terms = stripped.toLocaleLowerCase().split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 3 && !REVIEW_WORDS.has(word) && !FILLER_WORDS.has(word))
    .slice(0, 4);
  return { terms, city: place.city };
}

/** A message aimed at the TrustHub team or the bot itself, to be saved as feedback. */
export function isFeedbackCue(text: string): boolean {
  const message = text.trim();
  return /^(?:feedback|suggestion|complaint)\b/i.test(message)
    || /\b(?:bot|wisdom|you|you're|your|trusthub)\b.*\b(?:wrong|slow|stupid|useless|didn'?t understand|did not understand|doesn'?t understand|not working|bug|broken|error|rude)\b/i.test(message)
    || /\b(?:improve|improvement|please add|you should add|you need to add|you should have|i wish)\b/i.test(message);
}

/** Questions that need judgement or advice, so they are deep questions rather than searches. */
export function isDeepCue(text: string): boolean {
  return /\b(?:should i|should we|best way|why|how (?:do|can|should|would)|compare|advice|worth it|which is better|what would you|tips?|strategy|how to)\b/i.test(text);
}

/** A plain search ("Find me a hotel in Harare", "plumber in Avondale"): always free. */
export function isSearchLike(text: string): boolean {
  const message = text.trim();
  if (!message || message.length > 200 || isDeepCue(message)) return false;
  const hasPlace = !!parsePlace(message).city;
  const hasCategory = categorise(message) !== "general";
  // A search needs a search verb with a place or type of business, or a type of business in a place.
  const searching = /\b(?:find|looking for|need|where (?:can|do|is)|who sells|near|nearest)\b/i.test(message);
  // "plumber in Avondale": a noun phrase and a town, with no question wording.
  const bareNounPhrase = hasPlace && !/^\s*(?:what|why|how|should|which|who|is|are|do|does|can|could|would|will)\b/i.test(message) && !message.includes("?");
  return searching ? hasPlace || hasCategory : (hasPlace && hasCategory) || bareNounPhrase;
}
