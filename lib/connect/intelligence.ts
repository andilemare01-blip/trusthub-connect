/**
 * Community intelligence: what is happening to people's money and daily life, told like a friend would.
 * The brief mixes Benita's facts (fuel, the ZiG rate), news headlines about prices, jobs and services,
 * and signals from TrustHub's own data (typical rents, car prices, jobs, what people search for).
 */
import type { AreaPulse, NewsItem, TownSignals } from "./store.ts";

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const day = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Harare" });
};

/** "▲ up 0.4%" / "▼ down 3%" / "" when there is no earlier value. */
export function change(value: number | null, previous: number | null): string {
  if (value === null || previous === null || !previous) return "";
  const percent = ((value - previous) / previous) * 100;
  if (Math.abs(percent) < 0.05) return " (no change)";
  return percent > 0 ? ` (▲ up ${Math.abs(percent).toFixed(1)}%)` : ` (▼ down ${Math.abs(percent).toFixed(1)}%)`;
}

function moneyLines(signals: TownSignals | null): string[] {
  const facts = new Map((signals?.facts ?? []).map((fact) => [fact.key, fact]));
  const lines: string[] = [];
  const usd = facts.get("fx.usd_zwg");
  if (usd?.value) lines.push(`• 1 US$ = ZiG ${usd.value.toFixed(2)}${change(usd.value, usd.previous)}, official rate, ${day(usd.asOf)}`);
  const diesel = facts.get("fuel.diesel"), petrol = facts.get("fuel.petrol_blend");
  if (diesel?.value || petrol?.value) {
    lines.push(`• Fuel: ${[petrol?.value ? `petrol $${petrol.value.toFixed(2)}${change(petrol.value, petrol.previous)}` : null, diesel?.value ? `diesel $${diesel.value.toFixed(2)}${change(diesel.value, diesel.previous)}` : null].filter(Boolean).join(" · ")} a litre (ZERA)`);
  }
  const gas = facts.get("fuel.lpg");
  if (gas?.value) lines.push(`• Cooking gas (LPG): $${gas.value.toFixed(2)} a kg${change(gas.value, gas.previous)}`);
  return lines;
}

/** Names cars properly: "Toyota Land" is a Land Cruiser. */
const carName = (model: string) => model.replace(/^Toyota Land$/i, "Toyota Land Cruiser").replace(/^Mercedes Benz$/i, "Mercedes-Benz");

export function newsLine(item: NewsItem, index: number): string {
  return `${index + 1}. ${item.title} _(${item.source}${item.publishedAt ? `, ${day(item.publishedAt)}` : ""})_\n${item.url}`;
}

/** The Community intelligence brief for a town. */
export function intelligenceBrief(city: string, greeting: string, signals: TownSignals | null, news: NewsItem[], pulse: AreaPulse | null): string {
  const sections: string[] = [`${greeting}\n\n*${city}: what's happening* 📊`];
  const moneyNow = moneyLines(signals);
  if (moneyNow.length) sections.push(["💵 *Money today*", ...moneyNow].join("\n"));
  if (news.length) sections.push(["📰 *News that matters*", ...news.slice(0, 3).map(newsLine)].join("\n"));
  if (signals?.rents.length) sections.push(["🏠 *Typical rents asked*", signals.rents.slice(0, 4).map((rent) => `${rent.area} ~${money(rent.median)}`).join(" · ")].join("\n"));
  if (signals?.cars.length) sections.push(["🚗 *Car prices asked*", signals.cars.slice(0, 4).map((car) => `${carName(car.model)} ~${money(car.median)}`).join(" · ")].join("\n"));
  if (signals?.jobsTotal) sections.push(`💼 *Jobs*: ${signals.jobsTotal.toLocaleString("en-US")} openings listed right now. Tap Main menu → Jobs to look.`);
  if (pulse?.topSearches.length) sections.push(["🔎 *People here are looking for*", pulse.topSearches.slice(0, 3).map((item) => item.label).join(" · ")].join("\n"));
  if (pulse?.notFound.length) sections.push(`💡 *Wanted, but nobody listed*: ${pulse.notFound.slice(0, 3).map((item) => item.label).join(" · ")}. A business opportunity!`);
  if (sections.length === 1) sections.push(`It's early days for ${city}: I don't have enough news, prices or searches here yet. Every search people make helps build this picture.`);
  sections.push(`Ask me anything about prices, money or ${city}: *is bread going up?*, *rent in Avondale*, *any news on ZESA?*`);
  return sections.join("\n\n");
}

/** True when a message in Community intelligence is a question for it rather than a new search. */
export function isIntelligenceQuestion(text: string): boolean {
  const message = text.trim();
  if (message.length < 3 || message.length > 300) return false;
  if (/\?\s*$/.test(message)) return true;
  if (/^(what|what's|whats|how|is|are|any|anything|why|when|tell|news|will|should|can|do|does|did|has|have)\b/i.test(message)) return true;
  return /\b(price|prices|cost|rent|rate|zig|dollar|fuel|petrol|diesel|zesa|electricity|inflation|economy|salary|salaries|news|market|tax|bread|mealie|cheap|expensive)\b/i.test(message);
}

/** An answer without AI: matching headlines and the signals that fit the question. */
export function intelligenceFallback(question: string, city: string, signals: TownSignals | null, news: NewsItem[]): string {
  const q = question.toLocaleLowerCase();
  const parts: string[] = [];
  if (/\b(rate|zig|dollar|usd|fuel|petrol|diesel|gas|lpg)\b/.test(q)) parts.push(...moneyLines(signals));
  if (/\b(rent|house|flat|room|cottage|property)\b/.test(q) && signals?.rents.length) {
    const asked = signals.rents.find((rent) => q.includes(rent.area.toLocaleLowerCase()));
    parts.push(asked ? `• Typical rent asked in ${asked.area}: ~${money(asked.median)} a month (from ${asked.listings} listings)` : `• Typical rents asked in ${city}: ${signals.rents.slice(0, 4).map((rent) => `${rent.area} ~${money(rent.median)}`).join(", ")}`);
  }
  if (/\b(car|cars|vehicle|honda|toyota|nissan|mazda|hilux|fit)\b/.test(q) && signals?.cars.length) parts.push(`• Car prices asked in ${city}: ${signals.cars.slice(0, 4).map((car) => `${carName(car.model)} ~${money(car.median)}`).join(", ")}`);
  if (/\b(job|jobs|work|vacanc|hiring)\b/.test(q) && signals?.jobsTotal) parts.push(`• ${signals.jobsTotal.toLocaleString("en-US")} job openings listed right now.`);
  if (news.length) parts.push("", "*In the news:*", ...news.slice(0, 3).map(newsLine));
  if (!parts.length) return `I haven't seen anything on that yet, and I'd rather say so than guess. Benita reads the news every hour, so ask me again later, or try *fuel price*, *rent in Avondale* or *any news on ZESA?*`;
  return ["Here's what I've got:", ...parts].join("\n");
}
