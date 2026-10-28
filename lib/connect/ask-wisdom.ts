/**
 * Deep questions for Ask Wisdom. The model only sees figures pulled from
 * TrustHub (search demand, listings, matching businesses) and is told to
 * answer from them alone, so it cannot present a guess as TrustHub data.
 */
import type { AiGateway } from "../ai/gateway.ts";
import type { DeepQuestionAnswerer } from "./journeys.ts";
import { keywords } from "./parse.ts";
import type { ConnectStore } from "./store.ts";

const SYSTEM_PROMPT = [
  "You are Wisdom, the assistant for TrustHub Connect, a WhatsApp community directory in Zimbabwe.",
  "Answer the person's question using ONLY the TrustHub data provided. Never invent businesses, prices, numbers or facts.",
  "If the data is too thin to answer, say so plainly and suggest one practical next step.",
  "Write for WhatsApp: plain sentences, at most 120 words, no markdown headings, no tables.",
  "Do not give legal, medical or financial advice; for business decisions, describe what the data shows.",
].join(" ");

export function createDeepQuestionAnswerer(gateway: Pick<AiGateway, "complete">, store: ConnectStore): DeepQuestionAnswerer {
  return async (question, city, key) => {
    const words = keywords(question);
    const [pulse, listings, businesses] = await Promise.all([
      city ? store.areaPulse(city, 30) : Promise.resolve(null),
      store.searchListings({ intents: ["offering", "seeking", "recruiting", "job_seeking"], words, city, limit: 8 }),
      words[0] ? store.searchDirectory(words[0], city, 8) : Promise.resolve([]),
    ]);
    const data = {
      city: city ?? "not given",
      last30Days: pulse ? { mostSearched: pulse.topSearches, searchedButNotFound: pulse.notFound, newBusinesses: pulse.newBusinesses, newListings: pulse.newListings, typicalPrices: pulse.typicalPrices } : "no town given",
      matchingListings: listings.map((item) => ({ title: item.title, intent: item.intent, price: item.priceText, area: item.area, city: item.city, checked: item.status === "approved" })),
      matchingBusinesses: businesses.map((item) => ({ name: item.name, category: item.category, area: item.area, city: item.city, reviews: item.reviewsCount })),
    };
    const result = await gateway.complete({
      key: `${key}:deep_question`,
      purpose: "deep_question",
      system: SYSTEM_PROMPT,
      user: `Question: ${question.slice(0, 500)}\n\nTrustHub data (JSON):\n${JSON.stringify(data).slice(0, 6000)}`,
    });
    return result.ok && result.text.trim() ? result.text.trim() : null;
  };
}
