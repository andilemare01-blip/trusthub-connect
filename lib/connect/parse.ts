/**
 * Small deterministic parsers used by the Connect journeys. Nothing here
 * calls an AI model: a price, a town or a phone number is either read from
 * the text or left empty, never guessed.
 */
import { tryNormalizePhoneNumber } from "../identity/phone-number.ts";

/** "REVIEW TH-1042", "th1042" or a bare "TH-1042" -> "TH-1042". */
export function parseCardCode(text: string): string | null {
  const match = /\bTH-?(\d{4,6})\b/i.exec(text);
  return match ? `TH-${match[1]}` : null;
}

export interface ParsedPrice { priceText: string; amount: number; currency: string }

const CURRENCY_WORDS: Record<string, string> = { "$": "USD", usd: "USD", us$: "USD", zig: "ZiG", zwg: "ZiG", r: "ZAR", rand: "ZAR", zar: "ZAR" };

/** Reads one price such as "$120", "120 USD", "US$ 1,200", "ZiG 500" or "R350". */
export function parsePrice(text: string): ParsedPrice | null {
  const amount = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
  const before = new RegExp(`(us\\$|\\$|usd|zig|zwg|rand|zar|\\br)\\s?(${amount})\\s?(k)?\\b`, "i").exec(text);
  const after = new RegExp(`\\b(${amount})\\s?(k)?\\s?(usd|zig|zwg|rand|zar|dollars?)\\b`, "i").exec(text);
  const match = before ? { raw: before[0], symbol: before[1], number: before[2], thousands: before[4] } : after ? { raw: after[0], symbol: after[4], number: after[1], thousands: after[3] } : null;
  if (!match) return null;
  const value = Number.parseFloat(match.number.replace(/,/g, "")) * (match.thousands ? 1000 : 1);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  const symbol = match.symbol.toLowerCase().replace(/^dollars?$/, "usd");
  return { priceText: match.raw.trim(), amount: value, currency: CURRENCY_WORDS[symbol] ?? "USD" };
}

/** Towns Connect recognises without asking. Others still work when written as "in <town>". */
export const ZIMBABWE_TOWNS = [
  "Harare", "Bulawayo", "Chitungwiza", "Mutare", "Gweru", "Kwekwe", "Kadoma", "Masvingo", "Chinhoyi", "Marondera",
  "Norton", "Chegutu", "Bindura", "Beitbridge", "Victoria Falls", "Hwange", "Kariba", "Rusape", "Zvishavane", "Chiredzi",
  "Ruwa", "Epworth", "Karoi", "Gokwe", "Shurugwi", "Redcliff", "Plumtree", "Chipinge", "Mazowe", "Banket", "Gwanda", "Mvurwi",
] as const;

/** Suburbs that unambiguously belong to one town, so "Avondale" alone means Harare. */
const SUBURB_TOWN: Record<string, string> = {
  avondale: "Harare", borrowdale: "Harare", "mt pleasant": "Harare", "mount pleasant": "Harare", belgravia: "Harare", mabelreign: "Harare",
  greendale: "Harare", highlands: "Harare", waterfalls: "Harare", mbare: "Harare", budiriro: "Harare", "glen view": "Harare", glenview: "Harare",
  kuwadzana: "Harare", "warren park": "Harare", hatfield: "Harare", eastlea: "Harare", "milton park": "Harare", marlborough: "Harare",
  westgate: "Harare", chisipite: "Harare", msasa: "Harare", "harare cbd": "Harare", mabvuku: "Harare", tafara: "Harare", dzivarasekwa: "Harare",
  "bulawayo cbd": "Bulawayo", nkulumane: "Bulawayo", entumbane: "Bulawayo", suburbs: "Bulawayo", hillside: "Bulawayo", pumula: "Bulawayo",
  sakubva: "Mutare", dangamvura: "Mutare", mkoba: "Gweru", senga: "Gweru",
};

function titleCase(value: string): string {
  return value.toLocaleLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase());
}

export interface ParsedPlace { city: string | null; area: string | null }

/** Finds a town (and suburb, if named) anywhere in the text. */
export function parsePlace(text: string): ParsedPlace {
  const lowered = ` ${text.toLocaleLowerCase().replace(/[.,;:!?()]/g, " ").replace(/\s+/g, " ")} `;
  const town = [...ZIMBABWE_TOWNS].sort((a, b) => b.length - a.length).find((candidate) => lowered.includes(` ${candidate.toLocaleLowerCase()} `)) ?? null;
  const suburb = Object.keys(SUBURB_TOWN).sort((a, b) => b.length - a.length).find((candidate) => lowered.includes(` ${candidate} `)) ?? null;
  if (suburb && (!town || SUBURB_TOWN[suburb] === town)) return { city: SUBURB_TOWN[suburb], area: titleCase(suburb.replace(/ cbd$/, " CBD")) };
  if (town) return { city: town, area: null };
  const named = /\b(?:in|at|around|near|from)\s+([\p{L}][\p{L}\s'-]{1,30}?)(?:\s*,\s*([\p{L}][\p{L}\s'-]{1,30}?))?\s*(?:$|[.,;!?]|\s(?:for|under|below|with|and|at|budget)\b)/iu.exec(text);
  if (!named) return { city: null, area: null };
  return named[2] ? { city: titleCase(named[2].trim()), area: titleCase(named[1].trim()) } : { city: titleCase(named[1].trim()), area: null };
}

/**
 * Reads a phone number someone wants to check: Zimbabwe local numbers
 * ("0771 234 567") become +263771234567; international numbers are kept.
 */
export function parseCheckedPhone(text: string): string | null {
  const candidate = /(\+?\d[\d\s().-]{7,18}\d)/.exec(text)?.[1];
  if (!candidate) return null;
  const digits = candidate.replace(/[^\d+]/g, "");
  if (/^0[1-9]\d{8}$/.test(digits)) return tryNormalizePhoneNumber(`+263${digits.slice(1)}`);
  if (/^0\d+$/.test(digits)) return null;
  if (/^7\d{8}$/.test(digits)) return tryNormalizePhoneNumber(`+263${digits}`);
  return tryNormalizePhoneNumber(digits);
}

/** Masks a number for display: +263 77X XXX 567. Full numbers are never echoed back. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "number";
  return `+${digits.slice(0, digits.length - 9)} ${digits.slice(-9, -7)}X XXX ${digits.slice(-3)}`;
}

const CATEGORY_WORDS: [string, RegExp][] = [
  ["phones", /\b(phone|iphone|samsung|tecno|itel|infinix|redmi|xiaomi|huawei|nokia|smartphone)\b/i],
  ["electronics", /\b(laptop|computer|tv|television|fridge|freezer|stove|microwave|speaker|radio|tablet|ipad|solar|inverter|battery|batteries|panel|generator)\b/i],
  ["vehicles", /\b(car|cars|vehicle|honda|toyota|nissan|mazda|bmw|mercedes|truck|kombi|motorbike|bike|tyres?|tires?)\b/i],
  ["property", /\b(house|houses|room|rooms|cottage|flat|apartment|stand|plot|land|rent|rental|lodge|boarding)\b/i],
  ["furniture", /\b(sofa|couch|bed|beds|table|chairs?|wardrobe|furniture|mattress)\b/i],
  ["clothing", /\b(clothes|clothing|shoes|dress|dresses|wig|wigs|hair|weave|jacket|sneakers)\b/i],
  ["food", /\b(chicken|chickens|eggs|maize|beef|vegetables|tomatoes|potatoes|fruit|groceries|cooking oil|sugar|mealie)\b/i],
  ["services", /\b(repair|repairs|plumbing|electrician|transport|delivery|cleaning|tutor|tutoring|lessons|catering|photography)\b/i],
];

export function categorise(text: string): string {
  return CATEGORY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "general";
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "want", "need", "looking", "selling", "sell", "buy", "buying", "good", "condition", "price", "cheap", "please", "any", "some", "who", "has", "have", "under", "below", "budget", "near", "around", "from", "that", "this", "one", "new", "used", "urgent", "urgently"]);

/** Search words from a free-text item description, without towns, prices or filler. */
export function keywords(text: string): string[] {
  const place = parsePlace(text);
  const placeWords = new Set([place.city, place.area].filter(Boolean).flatMap((value) => value!.toLocaleLowerCase().split(/\s+/)));
  return [...new Set(text.toLocaleLowerCase().replace(/[$€£]?\d[\d,.]*\w*/g, " ").split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !placeWords.has(word) && !/^(usd|zig|zwg|rand|zar|dollars?)$/.test(word)))].slice(0, 6);
}

/** A short listing title: the item description without price and town words. */
export function listingTitle(text: string): string {
  const price = parsePrice(text);
  let title = price ? text.replace(price.priceText, " ") : text;
  const place = parsePlace(text);
  for (const value of [place.area, place.city]) if (value) title = title.replace(new RegExp(`\\b(?:in|at|around|near)?\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  // Openers people type before the item: "It's an", "I have a", "I'm selling".
  title = title.replace(/^\s*(?:(?:it'?s|its|it is|i have|i've got|we have)\s+(?:an?|the|some)?\s*)/i, "")
    .replace(/\b(?:a|an|per|each|every)\s+(?:month|week|day|year)\b/gi, " ")
    .replace(/\bi\s*(phone|pad|mac)\b/gi, (_, word: string) => `i${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .replace(/\bfor sale\b/gi, " ")
    .replace(/\b(\w+(?:\s+\w+)?)\s+\1\b/gi, "$1")
    .replace(/(?:\s+(?:and|its|it's|it is|that|which|is|the|a|an))+\s*$/i, "");
  title = title.replace(/^\s*(?:i(?:'m| am)?\s+)?(?:selling|sell|for sale|looking for|need|want|buying)\s*:?\s*/i, "")
    .replace(/\b(?:under|below|budget|max|maximum|for|around|about|at)\s*(?=[,;]|$)/gi, " ")
    .replace(/^\s*(?:a|an|the|some)\s+/i, "")
    .replace(/\s*[,;]\s*(?=[,;]|$)/g, "").replace(/\s+/g, " ").replace(/^[,;\s-]+|[,;\s-]+$/g, "").trim();
  // Filler left behind by punctuation, e.g. "Iphone 12 and its, , ".
  title = title.replace(/(?:[\s,;-]+(?:and|its|it's|it is|that|which|is|the|a|an))+[\s,;-]*$/i, "").replace(/[\s,;-]+$/g, "");
  if (!title.length) return "Item";
  // Apple names keep their own capitals: iPhone, iPad, iMac.
  const cased = title.charAt(0).toUpperCase() + title.slice(1, 80);
  return cased.replace(/^I(Phone|Pad|Mac)\b/, "i$1");
}
