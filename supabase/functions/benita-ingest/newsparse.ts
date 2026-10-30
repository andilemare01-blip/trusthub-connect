/** Reading news feeds: which headlines matter to people's daily lives. Pure, so it is tested without the edge runtime. */
import { clean } from "./normalise.ts";

/** What a headline is about. A headline that matches none of these is not kept. */
export const TOPICS: [string, RegExp][] = [
  ["prices", /\b(prices?|cost of|costs?|cheaper|expensive|hike|hikes|tariffs?|fares?|fees|bread|mealie[- ]?meal|maize|cooking oil|sugar|groceries|basket|inflation|price war)\b/i],
  ["fuel", /\b(fuel|petrol|diesel|zera|lpg|paraffin)\b/i],
  ["money", /\b(zig|zwg|exchange rate|us\$|usd|forex|rbz|reserve bank|interest rates?|currency|bank charges?|ecocash|mobile money|imtt|loans?)\b/i],
  ["power_water", /\b(zesa|zetdc|load[- ]?shedding|power cuts?|electricity|blackouts?|water (?:cuts?|shortages?|rationing))\b/i],
  ["jobs", /\b(jobs?|vacanc(?:y|ies)|salar(?:y|ies)|wages?|civil servants|employment|unemployment|retrench\w*|hiring|recruit\w*|graduates)\b/i],
  ["housing", /\b(rent|rentals?|landlords?|tenants?|housing|stands?|property|evictions?|demolitions?|mortgages?)\b/i],
  ["transport", /\b(zupco|kombis?|commuter|tolls?|roads?|potholes|transport|buses|vehicle licen[cs]es?|zinara)\b/i],
  ["scams", /\b(scams?|scammers?|fraud\w*|fake|con[- ]?artists?|swindl\w*|counterfeit|stolen phones?|imei)\b/i],
  ["business", /\b(business(?:es)?|smes?|vendors?|market|economy|economic|budget|tax(?:es)?|zimra|investment|imports?|exports?|mining|tobacco|farmers?|harvest|retail|supermarkets?|trade)\b/i],
  ["council", /\b(council|rates bill|municipal|city of (?:harare|bulawayo)|refuse|sewer)\b/i],
];
/** Sport, celebrity and crime stories are left out unless they are about a scam. */
const NOT_FOR_US = /\b(goals?|match|league|fc|soccer|football|cricket|rugby|coach|striker|warriors|celebrity|socialite|actress|musician|album|wedding|murder\w*|killed|stabbed|raped?|sets? her on fire|dies|died|funeral|court hears)\b/i;

const TOWN_WORDS: [RegExp, string][] = ([
  "Harare", "Bulawayo", "Chitungwiza", "Mutare", "Gweru", "Kwekwe", "Kadoma", "Masvingo", "Chinhoyi", "Marondera", "Norton", "Chegutu", "Bindura",
  "Beitbridge", "Victoria Falls", "Hwange", "Kariba", "Rusape", "Zvishavane", "Chiredzi", "Ruwa", "Epworth", "Karoi", "Gokwe", "Shurugwi", "Plumtree",
  "Chipinge", "Gwanda", "Nyanga", "Lupane",
] as string[]).map((town) => [new RegExp(`\\b${town}\\b`, "i"), town]);

const decode = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16))).replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"')
  .replace(/&ndash;|&mdash;/g, "-").replace(/&hellip;/g, "...");
const tag = (item: string, name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(item)?.[1] ?? null;

export interface NewsItem { url: string; title: string; summary: string | null; publishedAt: string | null; topics: string[]; towns: string[] }

/** Reads an RSS feed and keeps the items that matter to people's daily lives. Pure, so it is tested without the network. */
export function parseFeed(xml: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const item of xml.split(/<item[\s>]/i).slice(1)) {
    const title = clean(decode(tag(item, "title") ?? ""), 220);
    const url = clean(decode(tag(item, "link") ?? ""), 500);
    if (!title || !url || !/^https?:\/\//.test(url)) continue;
    const summaryText = clean(decode(tag(item, "description") ?? ""), 2000)?.replace(/\s*The post .* appeared first on .*$/i, "").replace(/\s*\[(?:&#8230;|…|\.\.\.)\]\s*$/, "...") ?? null;
    const summary = summaryText ? (summaryText.length > 240 ? `${summaryText.slice(0, 237).replace(/\s+\S*$/, "")}...` : summaryText) : null;
    const text = `${title} ${summary ?? ""}`;
    const topics = TOPICS.filter(([, rule]) => rule.test(text)).map(([name]) => name);
    if (!topics.length || (NOT_FOR_US.test(title) && !topics.includes("scams"))) continue;
    const date = tag(item, "pubDate") ?? tag(item, "dc:date");
    const published = date ? new Date(decode(date).trim()) : null;
    out.push({ url, title, summary, publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null, topics, towns: TOWN_WORDS.filter(([rule]) => rule.test(text)).map(([, town]) => town) });
  }
  return out;
}

