/**
 * Benita: the knowledge engine behind Wisdom. Everything the app knows about
 * places, providers, things for sale and public facts comes back through one
 * search, with an honest trust tier on every result.
 *
 * Data is collected by the `benita-ingest` Supabase edge function and served by
 * the `benita_search` and `benita_current_facts` database functions.
 */

export type BenitaTier = "verified" | "claimed" | "listed" | "discovered";

export interface BenitaResult {
  kind: "place" | "listing";
  id: string;
  businessId: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  city: string | null;
  area: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  address: string | null;
  priceText: string | null;
  intent: string | null;
  tier: BenitaTier;
  tierLabel: string;
  sourceKey: string | null;
  sourceUrl: string | null;
  score: number;
}

export interface BenitaQuery {
  text: string;
  city?: string | null;
  limit?: number;
  kinds?: ("place" | "listing")[];
  /** Extra words, such as taxonomy synonyms ("plumbing" for "plumber"). */
  extraTerms?: string[];
}

export interface BenitaFact {
  key: string;
  label: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  currency: string | null;
  effectiveFrom: string;
  sourceKey: string;
  sourceUrl: string | null;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => typeof value === "string" && value.length ? value : null;
const TIERS: readonly BenitaTier[] = ["verified", "claimed", "listed", "discovered"];

export function mapBenitaResult(row: Row): BenitaResult {
  const tier = TIERS.includes(row.tier as BenitaTier) ? row.tier as BenitaTier : "discovered";
  return {
    kind: row.kind === "listing" ? "listing" : "place", id: String(row.id), businessId: text(row.business_id), name: String(row.name ?? ""),
    category: text(row.category), subcategory: text(row.subcategory), city: text(row.city), area: text(row.area),
    phone: text(row.phone), whatsapp: text(row.whatsapp), website: text(row.website), address: text(row.address),
    priceText: text(row.price_text), intent: text(row.intent), tier, tierLabel: text(row.tier_label) ?? tierLabel(tier),
    sourceKey: text(row.source_key), sourceUrl: text(row.source_url), score: Number(row.score ?? 0),
  };
}

export function mapBenitaFact(row: Row): BenitaFact {
  return {
    key: String(row.fact_key), label: String(row.label ?? row.fact_key), value: row.value === null || row.value === undefined ? null : Number(row.value),
    valueText: text(row.value_text), unit: text(row.unit), currency: text(row.currency), effectiveFrom: String(row.effective_from ?? ""),
    sourceKey: String(row.source_key ?? ""), sourceUrl: text(row.source_url),
  };
}

export function tierLabel(tier: BenitaTier): string {
  switch (tier) {
    case "verified": return "TrustHub verified";
    case "claimed": return "Owner-managed, not yet verified";
    case "listed": return "Listed, not verified";
    default: return "Found online, check before paying";
  }
}

/** The subset of a Supabase client Benita needs. */
export interface BenitaRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function benitaSearch(client: BenitaRpcClient, query: BenitaQuery): Promise<BenitaResult[]> {
  if (!query.text.trim()) return [];
  const { data, error } = await client.rpc("benita_search", {
    p_query: query.text.slice(0, 200), p_city: query.city ?? null, p_limit: Math.min(Math.max(query.limit ?? 5, 1), 20),
    p_kinds: query.kinds ?? ["place", "listing"], p_extra_terms: (query.extraTerms ?? []).slice(0, 8),
  });
  if (error) throw new Error("Benita search failed.");
  return Array.isArray(data) ? (data as Row[]).map(mapBenitaResult) : [];
}

export async function benitaFacts(client: BenitaRpcClient, prefix: string | null = null): Promise<BenitaFact[]> {
  const { data, error } = await client.rpc("benita_current_facts", { p_prefix: prefix });
  if (error) throw new Error("Benita facts failed.");
  return Array.isArray(data) ? (data as Row[]).map(mapBenitaFact) : [];
}

// ------------------------------------------------------------------ WhatsApp text

/** A Zimbabwean mobile number as a WhatsApp link; landlines and run-together numbers are not links. */
function waLink(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const local = digits.startsWith("263") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^7[1378]\d{7}$/.test(local) ? `wa.me/263${local}` : null;
}

/** A single landline or mobile number to show as "Call", or null when the stored value is garbled. */
function callNumber(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 12) return null;
  const local = digits.startsWith("263") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return local.length >= 7 && local.length <= 9 ? `+263 ${local}` : null;
}

const cut = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);

function host(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

export function benitaLine(result: BenitaResult, index: number): string {
  const where = [result.area, result.city].filter(Boolean).join(", ");
  const facts = [result.priceText, result.kind === "place" ? result.category ?? result.subcategory : null, where || null].filter(Boolean).join(" · ");
  const chat = waLink(result.whatsapp) ?? waLink(result.phone);
  const contact = chat ? `WhatsApp: ${chat}` : callNumber(result.phone) ? `Call: ${callNumber(result.phone)}` : null;
  const from = result.tier === "discovered" && host(result.sourceUrl) ? ` (${host(result.sourceUrl)})` : "";
  return `${index + 1}. *${cut(result.name, 60)}*${facts ? ` · ${facts}` : ""}\n   ${contact ? `${contact} · ` : ""}${result.tierLabel}${from}`;
}

/** A complete reply for a list of Benita results. */
export function benitaReply(results: BenitaResult[], what: string, city: string | null): string {
  const lines = [`Here's what I found for *${cut(what, 40)}*${city ? ` in ${city}` : ""}:`, "", ...results.map(benitaLine)];
  if (results.some((result) => result.tier === "discovered")) lines.push("", "Results marked *Found online* come from public websites and directories. TrustHub hasn't checked them, so confirm before you pay anything.");
  return lines.join("\n");
}

// ------------------------------------------------------------------ public facts

const FUEL = /\b(fuel|petrol|diesel|blend|e20|lpg|gas price|zera)\b/i;
const RATE = /\b(exchange rate|zig rate|rate of the zig|zwg|zig to (?:the )?(?:usd|dollar)|usd to zig|interbank|rbz rate|official rate)\b/i;
const PRICE_WORD = /\b(price|prices|cost|how much|rate|today|now|current|latest)\b/i;

/** Which public fact a message asks about, if any. */
export function factIntent(message: string): "fuel" | "fx" | null {
  if (FUEL.test(message) && (PRICE_WORD.test(message) || message.trim().split(/\s+/).length <= 3)) return "fuel";
  if (RATE.test(message)) return "fx";
  return null;
}

function money(value: number, currency: string | null): string {
  if (currency === "USD") return `US$${value.toFixed(2)}`;
  if (currency === "ZWG") return `ZiG ${value.toFixed(2)}`;
  return `${value}${currency ? ` ${currency}` : ""}`;
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function factReply(kind: "fuel" | "fx", facts: BenitaFact[]): string | null {
  const wanted = facts.filter((fact) => fact.key.startsWith(kind === "fuel" ? "fuel." : "fx."));
  if (!wanted.length) return null;
  const since = wanted.map((fact) => fact.effectiveFrom).sort().at(-1)!;
  if (kind === "fuel") {
    return [
      `*Fuel prices in Zimbabwe* (ZERA maximum prices, checked ${longDate(since)})`, "",
      ...wanted.map((fact) => `• ${fact.label.replace(/,? ZERA maximum$| \(maximum.*\)$/, "")}: ${fact.value !== null ? money(fact.value, fact.currency) : fact.valueText} ${fact.unit ?? ""}`.trimEnd()),
      "", "Stations may sell below these prices, never above them.",
    ].join("\n");
  }
  // The US dollar rate leads; the others follow. Never present another currency's rate as the dollar's.
  const usd = wanted.find((fact) => fact.key === "fx.usd_zwg");
  if (!usd) return null;
  const names: Record<string, string> = { "fx.gbp_zwg": "British pound", "fx.eur_zwg": "Euro", "fx.zar_zwg": "SA rand", "fx.bwp_zwg": "Botswana pula" };
  const others = wanted.filter((fact) => fact.key !== usd.key && names[fact.key] && fact.value !== null).map((fact) => `1 ${names[fact.key]} = ${money(fact.value!, "ZWG")}`);
  return [`*Official exchange rate* (RBZ, ${longDate(usd.effectiveFrom)})`, "", `1 US dollar = ${usd.value !== null ? money(usd.value, "ZWG") : usd.valueText}`, ...(others.length ? ["", ...others] : []), "", "Banks and shops may use a slightly different rate."].join("\n");
}
