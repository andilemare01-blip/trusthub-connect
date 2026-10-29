/**
 * Public facts people ask Wisdom about every day: ZERA's fuel price ceilings
 * and the Reserve Bank's official ZiG rate. Each value is stored with the date
 * it takes effect and the page it came from, never overwritten.
 */
import { rest } from "./db.ts";
import { clean, USER_AGENT } from "./normalise.ts";

interface Fact { fact_key: string; label: string; value: number; unit: string; currency: string; effective_from: string; source_key: string; source_url: string }

const FACT_SOURCES = {
  zera: (Deno.env.get("BENITA_ZERA_URL") ?? "https://www.zera.co.zw/").split(","),
  rbz: (Deno.env.get("BENITA_RBZ_URL") ?? "https://www.rbz.co.zw/").split(","),
};

async function page(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100_000);
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const html = (await response.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/&#0?36;/g, "$");
    return clean(html, 600_000);
  } catch { return null; }
}

/** "29 -10-2026", "29 October 2026" or "2026-10-29" to ISO. */
export function isoDate(text: string): string | null {
  const months = "january|february|march|april|may|june|july|august|september|october|november|december";
  const m = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\s+(20\\d{2})`, "i").exec(text);
  if (m) {
    const month = months.split("|").indexOf(m[2].toLowerCase()) + 1;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = /(20\d{2})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(20\d{2})/.exec(text);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
}

const FUEL_KEYS: [RegExp, string, string][] = [
  [/diesel/i, "fuel.diesel", "Diesel"],
  [/blend|petrol|unleaded/i, "fuel.petrol_blend", "Petrol blend"],
  [/lpg|gas/i, "fuel.lpg", "LPG"],
  [/paraffin|illuminating/i, "fuel.paraffin", "Paraffin"],
  [/electric|kwh/i, "power.tariff", "Electricity"],
];

/**
 * Reads ZERA's "Current Energy Prices" panel: "Petrol Blend (E20) $ 2.05 USD Per Litre".
 * The site shows no effective date there, so the date is the day Benita read it.
 */
export function parseZera(text: string, url: string, today: string): Fact[] {
  const at = text.search(/current energy prices/i);
  const panel = at >= 0 ? text.slice(at, at + 4000) : text;
  const facts = new Map<string, Fact>();
  for (const m of panel.matchAll(/([A-Za-z][A-Za-z ()\d]{2,40}?)\s*\$\s*(\d{1,2}[.,]\d{2,4})\s*(?:USD)?\s*(?:Per|\/)\s*(Litre|Liter|Kg|kWh)/gi)) {
    const label = m[1].trim();
    const kind = FUEL_KEYS.find(([rule]) => rule.test(label));
    const value = Number(m[2].replace(",", "."));
    if (!kind || facts.has(kind[1]) || !(value > 0 && value < 10)) continue;
    facts.set(kind[1], { fact_key: kind[1], label: `${kind[2]}${/\(([A-Z]\d{1,3})\)/.exec(label) ? ` (${/\(([A-Z]\d{1,3})\)/.exec(label)![1]})` : ""}, ZERA maximum`, value, unit: `per ${m[3].toLowerCase().replace("liter", "litre")}`, currency: "USD", effective_from: today, source_key: "zera", source_url: url });
  }
  return [...facts.values()];
}

/** Reads the RBZ interbank table: "USD/ZWG 25.9402 27.2704 26.6053" (bid, ask, average). */
export function parseRbz(text: string, url: string, today: string): Fact[] {
  // The menu says "Exchange Rates" long before the table, so anchor on the first currency pair.
  const at = text.search(/\b[A-Z]{3}\/ZWG\b/);
  if (at < 0) return [];
  const section = text.slice(Math.max(0, at - 400), at + 3000);
  const date = /(\d{1,2}\s*-\s*\d{1,2}\s*-\s*20\d{2})/.exec(section)?.[1];
  const effective = (date ? isoDate(date) : null) ?? today;
  const facts: Fact[] = [];
  for (const m of section.matchAll(/\b([A-Z]{3})\/ZWG\s+(\d{1,4}[.,]\d{2,6})\s+(\d{1,4}[.,]\d{2,6})\s+(\d{1,4}[.,]\d{2,6})/g)) {
    const average = Number(m[4].replace(",", "."));
    if (!(average > 0)) continue;
    facts.push({ fact_key: `fx.${m[1].toLowerCase()}_zwg`, label: `Official interbank rate, ZiG per ${m[1]} (average of bid ${m[2]} and ask ${m[3]})`, value: average, unit: `ZWG per ${m[1]}`, currency: "ZWG", effective_from: effective, source_key: "rbz", source_url: url });
  }
  return facts;
}

export async function runFacts(): Promise<{ seen: number; accepted: number; rejected: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const facts: Fact[] = [];
  let seen = 0, rejected = 0;
  for (const url of FACT_SOURCES.zera) { const text = await page(url); if (!text) { rejected++; continue; } seen++; facts.push(...parseZera(text, url, today)); if (facts.length) break; }
  const before = facts.length;
  for (const url of FACT_SOURCES.rbz) { const text = await page(url); if (!text) { rejected++; continue; } seen++; facts.push(...parseRbz(text, url, today)); if (facts.length > before) break; }
  if (facts.length) await rest("benita_facts?on_conflict=fact_key,region,effective_from", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(facts.map((f) => ({ ...f, region: "ZW", retrieved_at: new Date().toISOString() }))) });
  return { seen, accepted: facts.length, rejected };
}
