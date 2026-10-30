/**
 * Deep questions for Ask Wisdom. The model only sees figures pulled from
 * TrustHub (search demand, listings, matching businesses) and is told to
 * answer from them alone, so it cannot present a guess as TrustHub data.
 */
import type { AiGateway } from "../ai/gateway.ts";
import type { DeepQuestionAnswerer } from "./journeys.ts";
import { keywords } from "./parse.ts";
import type { ConnectStore } from "./store.ts";
import { styleFor } from "./persona.ts";

/** The voice is set per assistant name, so the same person keeps the same character. */
function systemPrompt(assistantName: string): string {
  return [
    `You are ${assistantName}, the assistant for TrustHub Connect, a WhatsApp community directory in Zimbabwe. Your style is ${styleFor(assistantName).tone}.`,
    "Be witty and a little sarcastic about situations, the way a clever friend would, but never rude to the person and never mock a business or a customer.",
    "Answer the person's question using ONLY the TrustHub data provided. Never invent businesses, prices, numbers or facts.",
    "When you mention a result from benitaResults, say its trust label in plain words (for example: found online, not checked by TrustHub). Quote publicFacts with their date.",
    "When you use a headline from news, name its source (for example: says NewsDay) and give its link once; never add details the headline and summary do not contain.",
    "townSignals are typical asking prices from TrustHub listings (rents, cars) and money facts with their previous value; say they are asking prices, not guarantees.",
    "For advice questions (starting a business, what sells, what is in demand, where to live), reason like a sharp local consultant: use searchedButNotFound (unmet demand), mostSearched, typicalPrices, townSignals rents and car prices, news and matching listings; give two or three concrete suggestions for that town with the numbers that support them, plus one honest risk.",
    "Talk like a friendly, well-informed neighbour having a good conversation: start with the answer, add one useful insight, and end with a short question or tip that keeps the chat going.",
    "If the data is too thin to answer, say so with a light touch and suggest one practical next step.",
    "Write for WhatsApp: plain sentences, at most 120 words, no markdown headings, no tables.",
    "Do not give legal, medical or financial advice; for business decisions, describe what the data shows.",
  ].join(" ");
}

export function createDeepQuestionAnswerer(gateway: Pick<AiGateway, "complete">, store: ConnectStore): DeepQuestionAnswerer {
  return async (question, city, key, assistantName = "Wisdom") => {
    const words = keywords(question);
    const [pulse, listings, businesses, benita, facts, news, signals] = await Promise.all([
      city ? store.areaPulse(city, 30).catch(() => null) : Promise.resolve(null),
      store.searchListings({ intents: ["offering", "seeking", "recruiting", "job_seeking"], words, city, limit: 8 }).catch(() => []),
      words[0] ? store.searchDirectory(words[0], city, 8).catch(() => []) : Promise.resolve([]),
      store.benitaSearch({ text: question, city, limit: 8 }).catch(() => []),
      store.currentFacts().catch(() => []),
      store.news ? store.news({ text: question, town: city, limit: 5 }).catch(() => []) : Promise.resolve([]),
      city && store.signals ? store.signals(city).catch(() => null) : Promise.resolve(null),
    ]);
    const data = {
      city: city ?? "not given",
      last30Days: pulse ? { mostSearched: pulse.topSearches, searchedButNotFound: pulse.notFound, newBusinesses: pulse.newBusinesses, newListings: pulse.newListings, typicalPrices: pulse.typicalPrices } : "no town given",
      matchingListings: listings.map((item) => ({ title: item.title, intent: item.intent, price: item.priceText, area: item.area, city: item.city, checked: item.status === "approved" })),
      matchingBusinesses: businesses.map((item) => ({ name: item.name, category: item.category, area: item.area, city: item.city, reviews: item.reviewsCount })),
      // Benita's wider index: every result carries its trust label, which the answer must repeat.
      benitaResults: benita.map((item) => ({ name: item.name, kind: item.kind, category: item.category ?? item.subcategory, price: item.priceText, area: item.area, city: item.city, trust: item.tierLabel })),
      news: news.map((item) => ({ headline: item.title, summary: item.summary, source: item.source, date: item.publishedAt?.slice(0, 10) ?? null, link: item.url })),
      townSignals: signals,
      publicFacts: facts.map((fact) => ({ fact: fact.label, value: fact.value ?? fact.valueText, unit: fact.unit, currency: fact.currency, asOf: fact.effectiveFrom, source: fact.sourceKey })),
    };
    const result = await gateway.complete({
      key: `${key}:deep_question`,
      purpose: "deep_question",
      system: systemPrompt(assistantName),
      user: `Question: ${question.slice(0, 500)}\n\nTrustHub data (JSON):\n${JSON.stringify(data).slice(0, 9000)}`,
    });
    return result.ok && result.text.trim() ? result.text.trim() : null;
  };
}
