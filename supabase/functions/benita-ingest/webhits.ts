/** Turns web search results into one business per page. Pure, so it is tested without the edge runtime. */
import { clean, zwPhonesIn } from "./normalise.ts";

/** Pages that list many places, or that we do not take facts from, are not one business. */
const NOT_ONE_PLACE = /\b(best|top \d+|cheap(est)?|list of|directory|things to do|near me|search results?|vacanc|jobs?|for sale|to let|for rent|reviews of|compare|deals)\b|\b\d+\s+(hotels|lodges|places|properties)\b|^(hotels|lodges|accommodation)\s+in\b/i;
const SKIP_HOSTS = /(^|\.)(facebook|instagram|tiktok|x|twitter|linkedin|youtube|pinterest|wikipedia)\.(com|org)$/i;

export const slug = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export interface WebHit { title: string; url: string; content: string }

export interface Found { name: string; phone: string | null; area: string | null; url: string; website: string | null }

/** A title that is only a description of the service, with no business name in it. */
export function genericName(name: string, town: string, words: string[]): boolean {
  const lower = name.toLocaleLowerCase();
  if (new RegExp(`\\bin (zimbabwe|${town.toLocaleLowerCase()})\\b`).test(lower)) return true;
  // Every word is the service itself or filler ("Plumbing Services & Repairs"); "Hotel Victoria" has a name in it.
  const filler = /^(services?|installations?|repairs?|maintenance|company|companies|contractors?|solutions?|experts?|professional|affordable|reliable|and|&|the|of|for|residential|commercial|emergency|24\/7|local)$/;
  return lower.split(/\s+/).every((part) => filler.test(part) || words.some((word) => part.startsWith(word.slice(0, 5))));
}

/** "www.coreconstruction.co.zw" becomes "coreconstruction.co.zw", which is honest and easy to look up. */
export function siteName(host: string): string {
  return host.replace(/^www\./, "");
}

/** One business per search result, or nothing when the page is a list, a social site, or about another town. */
export function fromHits(hits: WebHit[], town: string, words: string[]): Found[] {
  const out = new Map<string, Found>();
  for (const hit of hits) {
    let host: string;
    try { host = new URL(hit.url).host.replace(/^www\./, ""); } catch { continue; }
    if (SKIP_HOSTS.test(host)) continue;
    const title = clean(hit.title, 200) ?? "";
    if (!title || NOT_ONE_PLACE.test(title)) continue;
    const all = `${title} ${hit.content}`.toLocaleLowerCase();
    if (!all.includes(town.toLocaleLowerCase())) continue;
    if (!words.some((word) => all.includes(word))) continue;
    let name = title.replace(/^(booking\.com|tripadvisor|expedia|hotels\.com)\s*[:|-]\s*/i, "").split(/\s+[|–—-]\s+|\s*,\s+(?=[A-Z])|\s*\(/)[0].replace(/\s*updated \d{4}.*$/i, "").trim();
    if (name.length < 4 || name.length > 80 || NOT_ONE_PLACE.test(name)) continue;
    // "Plumbing Installations & Repairs In Zimbabwe" describes a service, not who offers it: name it after the website instead.
    if (genericName(name, town, words)) {
      if (/(booking|tripadvisor|expedia|hotels|agoda|trip|kayak|google|yellow|zimplaza|zimbabweyp|cylex)\./i.test(host)) continue;
      name = siteName(host);
    }
    const aggregator = /(booking|tripadvisor|expedia|hotels|agoda|trip|kayak|google|yellow|zimplaza|zimbabweyp|cylex)\./i.test(host);
    out.set(slug(name), { name, phone: zwPhonesIn(hit.content)[0] ?? null, area: null, url: hit.url, website: aggregator ? null : `https://${host}` });
  }
  return [...out.values()].slice(0, 6);
}
