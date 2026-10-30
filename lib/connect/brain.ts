/**
 * Wisdom's brain: open questions ("I want to start a business in Harare, what would you advise?",
 * "what's in demand in Bulawayo?", "how much is rent in Avondale?") are answered from everything
 * TrustHub knows about the place: what people search for and can't find, prices, rents, news,
 * listings and Benita's collection. The AI words the answer when it is available; when it is not,
 * the same data is laid out plainly, so a person never gets nothing.
 */
import type { AreaPulse, NewsItem, TownSignals } from "./store.ts";
import { intelligenceFallback, newsLine } from "./intelligence.ts";

/** Advice, insight and "how much / why / should I" questions, as opposed to "find me X" searches. */
export function isOpenQuestion(text: string): boolean {
  const message = text.trim();
  if (message.length < 12 || message.length > 500) return false;
  if (/^(?:find|search|looking for|i need|i'?m looking|where can i (?:buy|find|get)|where is|show me|list)\b/i.test(message)) return false;
  return /\b(advice|advise|recommend|suggest|should i|shall i|is it (?:worth|wise|good|safe)|worth it|how (?:do|can|should|would) i|how to|what (?:business|businesses|kind of business|is the best way|can i sell|sells)|in demand|demand for|opportunit\w*|start(?:ing)? (?:a |my )?business|business idea|ideas? for|tips?|profitable|make money|side hustle|how much (?:does|do|is|are|would|should)|cost of living|compare|difference between|explain|why (?:is|are|do|does)|what do you think|your opinion|trends?|market for)\b/i.test(message);
}

/** Questions that are about advice or the market even when they name a kind of business. */
export function isAdviceQuestion(text: string): boolean {
  return /\b(advice|advise|should i|shall i|in demand|demand for|opportunit\w*|start(?:ing)? (?:a |my )?business|business idea|profitable|make money|side hustle|how much (?:does|do|is|are|would|should)|cost of living|worth it|market for|trends?)\b/i.test(text);
}

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** The plain answer when the AI is unavailable: what the data for the town actually shows. */
export function brainFallback(question: string, city: string | null, pulse: AreaPulse | null, signals: TownSignals | null, news: NewsItem[]): string {
  const where = city ?? "your area";
  const business = /\b(business|start|opportunit|demand|sell|hustle|make money|idea|profitable|market)\b/i.test(question);
  if (!business) return intelligenceFallback(question, where, signals, news);
  const parts: string[] = [`Here's what TrustHub's data shows for ${where}, so you can decide with real numbers:`];
  if (pulse?.notFound.length) parts.push("", "*Wanted, but nobody listed* (the clearest gaps):", ...pulse.notFound.slice(0, 5).map((item) => `• ${item.label}: asked ${item.count} ${item.count === 1 ? "time" : "times"}, nobody found`));
  if (pulse?.topSearches.length) parts.push("", "*What people search for most*:", ...pulse.topSearches.slice(0, 5).map((item) => `• ${item.label} (${item.count})`));
  if (signals?.rents.length) parts.push("", `*Rent for a base*: ${signals.rents.slice(0, 3).map((rent) => `${rent.area} ~${money(rent.median)}/month`).join(", ")} (asking prices)`);
  if (news.length) parts.push("", "*Worth reading first*:", ...news.slice(0, 2).map(newsLine));
  if (parts.length === 1) {
    parts.push("", "There isn't enough search data for this town yet to point at a gap. Three things that usually work: pick a service people need weekly (food, transport, repairs), start small from home before paying rent, and ask 20 people what they struggle to find.");
  } else {
    parts.push("", "My tip: a gap that people keep asking for and nobody offers is the safest place to start. Check prices with two or three suppliers before you commit.");
  }
  return parts.join("\n");
}
