/** Shared clean-up rules, so every connector writes data the same way. */

/** Returns the first Zimbabwean number in a string as +263XXXXXXXXX, or null. */
export function zwPhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  for (const part of String(raw).split(/[;,/|]| or /i)) {
    let digits = part.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    if (!digits) continue;
    if (digits.startsWith("+")) digits = digits.slice(1);
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("263")) digits = digits.slice(3).replace(/^0(?=\d{9}$)/, ""); // "+263 0785…" is written with a stray 0
    else if (digits.startsWith("0")) digits = digits.slice(1);
    else if (digits.length > 10) continue; // a foreign number
    if (digits.length >= 7 && digits.length <= 10) return `+263${digits}`;
  }
  return null;
}

/** Every Zimbabwean number in a block of text, normalised and de-duplicated. */
export function zwPhonesIn(text: string): string[] {
  const found = text.match(/(?:\+?263|0)[\s-]?(?:7[1378]|8[0-9]|2\d|3\d|5\d|6\d|9)\d?(?:[\s-]?\d){5,7}/g) ?? [];
  return [...new Set(found.map(zwPhone).filter((value): value is string => !!value))];
}

const CITY_ALIASES: Record<string, string> = {
  harare: "Harare", "harare cbd": "Harare", chitungwiza: "Chitungwiza", bulawayo: "Bulawayo", byo: "Bulawayo", mutare: "Mutare", gweru: "Gweru",
  kwekwe: "Kwekwe", "que que": "Kwekwe", kadoma: "Kadoma", masvingo: "Masvingo", chinhoyi: "Chinhoyi", marondera: "Marondera", norton: "Norton",
  ruwa: "Ruwa", bindura: "Bindura", "victoria falls": "Victoria Falls", "vic falls": "Victoria Falls", hwange: "Hwange", beitbridge: "Beitbridge",
  zvishavane: "Zvishavane", chegutu: "Chegutu", kariba: "Kariba", karoi: "Karoi", rusape: "Rusape", chiredzi: "Chiredzi", gokwe: "Gokwe",
  redcliff: "Redcliff", shurugwi: "Shurugwi", chipinge: "Chipinge", nyanga: "Nyanga", plumtree: "Plumtree", gwanda: "Gwanda", lupane: "Lupane",
  mvurwi: "Mvurwi", "mount darwin": "Mount Darwin", murehwa: "Murehwa", mazowe: "Mazowe", banket: "Banket", goromonzi: "Goromonzi", epworth: "Epworth",
};

/** Maps a free-text place to a canonical Zimbabwean town, or null when it is not one. */
export function zwCity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.toLocaleLowerCase();
  for (const [alias, city] of Object.entries(CITY_ALIASES)) if (new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(text)) return city;
  return null;
}

export function clean(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** Turns "$250", "US$ 1,200", "ZWG 50.37" into a number and currency. */
export function price(raw: unknown): { amount: number | null; currency: string | null; text: string | null } {
  if (raw === null || raw === undefined) return { amount: null, currency: null, text: null };
  const text = String(raw).trim();
  const amount = Number((text.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
  const currency = /zw[gl]|zig/i.test(text) ? "ZWG" : /r\s?\d|zar|rand/i.test(text) ? "ZAR" : /\$|usd|us\$/i.test(text) || /^\d/.test(text) ? "USD" : null;
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : null, currency, text: text.slice(0, 60) || null };
}

/** Builds the text the search index reads. */
export function searchText(...parts: unknown[]): string {
  return parts.flat().filter((part) => typeof part === "string" && part.trim()).join(" ").replace(/[_;]/g, " ").replace(/\s+/g, " ").slice(0, 1000);
}

/** Simple keyword categoriser for listings without a category. */
export function listingCategory(text: string): string {
  const t = text.toLocaleLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(house|flat|cottage|stand|room|rent|townhouse|cluster|apartment|bedroom|plot|land|property)\b/, "Property"],
    [/\b(toyota|honda|nissan|mazda|vw|bmw|mercedes|car|vehicle|truck|bakkie|suv|sedan|hatchback|kombi|motorbike|tyres?)\b/, "Vehicles"],
    [/\b(phone|iphone|samsung|laptop|tv|television|computer|tablet|ps5|xbox|speaker|camera)\b/, "Electronics"],
    [/\b(solar|inverter|battery|panel|generator)\b/, "Solar & Electrical"],
    [/\b(fridge|stove|sofa|bed|table|chair|furniture|wardrobe|microwave|washing machine)\b/, "Home & Furniture"],
    [/\b(job|vacancy|hiring|recruit|position|internship)\b/, "Jobs"],
    [/\b(cement|brick|roof|tiles|plumb|electric|builder|construction|borehole)\b/, "Building & Trades"],
    [/\b(clothes|dress|shoes|wig|hair|salon|fashion)\b/, "Fashion & Beauty"],
    [/\b(chicken|beef|maize|vegetable|fruit|grocer|food|bakery|catering)\b/, "Food & Farming"],
  ];
  return rules.find(([rule]) => rule.test(t))?.[1] ?? "General";
}

export const USER_AGENT = "BenitaBot/1.0 (TrustHub Connect public directory crawler; respects robots.txt)";
