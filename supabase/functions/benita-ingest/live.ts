/**
 * Live lookup: when nothing stored answers "hotel in Beitbridge", Benita asks
 * right away and saves what it finds, so the next person gets it instantly.
 *
 *   1. OpenStreetMap around the town (free, no key)
 *   2. Tavily web search      (TAVILY_API_KEY, free 1,000 a month)
 *   3. Exa web search         (EXA_API_KEY, free monthly credit)
 *   4. OpenRouter web search  (OPENROUTER_API_KEY, the AI account's own credits)
 *
 * Web finds are stored as "Found online, check before paying": facts and links only.
 */
import { rest, rpc, source, upsert } from "./db.ts";
import { clean, searchText, zwPhone, zwPhonesIn } from "./normalise.ts";
import { classify, OVERPASS_AGENT, TOWNS } from "./osm.ts";

export interface LiveResult { saved: number; map: number; web: number; engine: string | null; town: string | null; error?: string }

const KIND_KEY = /^(shop|amenity|tourism|office|craft|healthcare|leisure)$/;
/** Pages that list many places, or that we do not take facts from, are not one business. */
const NOT_ONE_PLACE = /\b(best|top \d+|cheap(est)?|list of|directory|things to do|near me|search results?|vacanc|jobs?|for sale|to let|for rent|reviews of|compare|deals)\b|\b\d+\s+(hotels|lodges|places|properties)\b|^(hotels|lodges|accommodation)\s+in\b/i;
const SKIP_HOSTS = /(^|\.)(facebook|instagram|tiktok|x|twitter|linkedin|youtube|pinterest|wikipedia)\.(com|org)$/i;

const slug = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const safeWord = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9 &'-]/g, "").trim();
const titleCase = (text: string) => text.replace(/\b\p{L}/gu, (c) => c.toLocaleUpperCase());

async function townFor(city: string): Promise<{ name: string; lat: number; lon: number } | null> {
  const known = TOWNS.find((town) => town.name.toLocaleLowerCase() === city.toLocaleLowerCase());
  if (known) return known;
  const rows = await rest<{ name: string; lat: number; lon: number }[]>(`benita_places?name=ilike.${encodeURIComponent(city)}&select=name,lat,lon&limit=1`);
  return rows[0] ?? null;
}

async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const near = (aLat: number, aLon: number, bLat: number, bLon: number) => Math.abs(aLat - bLat) < 0.25 && Math.abs(aLon - bLon) < 0.25;

/**
 * Named places of the asked-for kind in the town, from OpenStreetMap's search service (Nominatim).
 * Overpass is too slow and often "at capacity" for a person waiting on WhatsApp; Nominatim answers in about a second.
 * Its usage policy allows one request a second with a descriptive agent, so at most three words are asked, a second apart.
 */
async function fromMap(town: { name: string; lat: number; lon: number }, words: string[], deadline: number): Promise<Record<string, unknown>[]> {
  const elements = new Map<string, Record<string, unknown>>();
  // The asked-for word first, then its plainest synonyms ("lodge", not "inns").
  const asked = [words[0], ...words.slice(1).filter((word) => word.length >= 4 && !word.endsWith("s"))].slice(0, 3);
  for (const [index, word] of asked.entries()) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 1_100));
    const left = deadline - Date.now();
    if (left < 1_500) break;
    try {
      const params = new URLSearchParams({ q: `${word} in ${town.name}`, countrycodes: "zw", format: "jsonv2", extratags: "1", addressdetails: "1", limit: "20" });
      const response = await fetchWithin(`${NOMINATIM}?${params}`, { headers: { "user-agent": OVERPASS_AGENT, accept: "application/json" } }, Math.min(left - 300, 5_000));
      if (!response.ok) continue;
      for (const hit of await response.json() as Record<string, unknown>[]) {
        const lat = Number(hit.lat), lon = Number(hit.lon);
        if (!hit.name || !near(lat, lon, town.lat, town.lon)) continue;
        const extra = (hit.extratags ?? {}) as Record<string, string>, address = (hit.address ?? {}) as Record<string, string>;
        const tags: Record<string, string> = { ...extra, name: String(hit.name), [String(hit.category)]: String(hit.type) };
        if (address.suburb ?? address.neighbourhood) tags["addr:suburb"] = address.suburb ?? address.neighbourhood;
        if (address.road) tags["addr:street"] = address.road;
        if (address.house_number) tags["addr:housenumber"] = address.house_number;
        elements.set(`${hit.osm_type}:${hit.osm_id}`, { type: hit.osm_type, id: hit.osm_id, lat, lon, tags });
      }
    } catch { /* the next word, or the web */ }
  }
  if (!elements.size) return [];
  const src = await source("osm");
  const now = new Date().toISOString();
  return [...elements.values()].flatMap((el) => {
    const t = (el.tags ?? {}) as Record<string, string>;
    const name = clean(t.name, 200);
    const lat = el.lat as number, lon = el.lon as number;
    if (!name || t.disused || !Object.keys(t).some((key) => KIND_KEY.test(key))) return []; // a road or a suburb is not a business
    const { recordType, category, sub } = classify(t);
    const area = clean(t["addr:suburb"], 80);
    const phone = zwPhone(t.phone ?? t["contact:phone"] ?? t["contact:mobile"]);
    return [{
      record_type: recordType, name, country_code: "ZW", city: town.name, area, category, subcategory: sub?.replace(/_/g, " ") ?? null,
      service_tags: [sub].filter(Boolean).map((tag) => String(tag).replace(/_/g, " ")),
      description: clean(t.description, 300), phone, whatsapp: zwPhone(t["contact:whatsapp"]),
      website: clean(t.website ?? t["contact:website"] ?? t.url, 300), address: [t["addr:housenumber"], t["addr:street"], area, town.name].filter(Boolean).join(", ") || null,
      latitude: lat, longitude: lon, opening_hours: t.opening_hours ? { osm: t.opening_hours } : null,
      provenance_state: "OBSERVED", confidence: phone ? 0.7 : 0.6, operating_status: "operating", provider_kind: "organization",
      source_id: src.id, source_record_id: `${el.type}:${el.id}`, source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      source_license: "ODbL 1.0 (© OpenStreetMap contributors)", source_retrieved_at: now, source_payload: { tags: t, live: true },
      search_text: searchText(name, category, sub, t.description, area, town.name, t["name:en"], t.alt_name),
    }];
  });
}

interface WebHit { title: string; url: string; content: string }

async function tavily(query: string, ms: number): Promise<WebHit[] | null> {
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key) return null;
  const response = await fetchWithin("https://api.tavily.com/search", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 8, search_depth: "basic", include_answer: false }),
  }, ms);
  if (!response.ok) throw new Error(`tavily ${response.status}`);
  const body = await response.json() as { results?: { title?: string; url?: string; content?: string }[] };
  return (body.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
}

async function exa(query: string, ms: number): Promise<WebHit[] | null> {
  const key = Deno.env.get("EXA_API_KEY");
  if (!key) return null;
  const response = await fetchWithin("https://api.exa.ai/search", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, numResults: 8, type: "auto", contents: { text: { maxCharacters: 1200 } } }),
  }, ms);
  if (!response.ok) throw new Error(`exa ${response.status}`);
  const body = await response.json() as { results?: { title?: string; url?: string; text?: string }[] };
  return (body.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.text ?? "" }));
}

interface Found { name: string; phone: string | null; area: string | null; url: string; website: string | null }

/** The AI account's web search, asked for named businesses as JSON. */
async function openrouter(what: string, town: string, ms: number): Promise<Found[] | null> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";
  const response = await fetchWithin("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, plugins: [{ id: "web", max_results: 5 }], temperature: 0,
      messages: [{ role: "user", content: `List up to 6 real ${what} businesses in ${town}, Zimbabwe, from the web results only. Reply with JSON only: [{"name":"","phone":"","area":"","url":""}]. url is the page you read it on. Leave a field empty when unknown. Never invent anything.` }],
    }),
  }, ms);
  if (!response.ok) throw new Error(`openrouter ${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (!json) return [];
  return (JSON.parse(json) as Record<string, string>[]).flatMap((row) => {
    const name = clean(row.name, 120), url = clean(row.url, 500);
    if (!name || !url || !/^https?:\/\//.test(url)) return [];
    return [{ name, phone: zwPhone(row.phone), area: clean(row.area, 80), url, website: null }];
  });
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
    const name = title.replace(/^(booking\.com|tripadvisor|expedia|hotels\.com)\s*[:|-]\s*/i, "").split(/\s+[|–—-]\s+|\s*,\s+(?=[A-Z])|\s*\(/)[0].replace(/\s*updated \d{4}.*$/i, "").trim();
    if (name.length < 4 || name.length > 80 || NOT_ONE_PLACE.test(name)) continue;
    const aggregator = /(booking|tripadvisor|expedia|hotels|agoda|trip|kayak|google|yellow|zimplaza|zimbabweyp|cylex)\./i.test(host);
    out.set(slug(name), { name, phone: zwPhonesIn(hit.content)[0] ?? null, area: null, url: hit.url, website: aggregator ? null : `https://${host}` });
  }
  return [...out.values()].slice(0, 6);
}

async function liveSource(): Promise<{ id: string; license: string | null }> {
  try { return await source("benita_live_web"); } catch { /* first use: create it */ }
  await rest("knowledge_sources?on_conflict=source_key", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ source_key: "benita_live_web", name: "Benita live web lookup", source_type: "directory", base_url: null, license: "Facts and links only", reuse_status: "review", attribution_required: true, notes: "Business names, numbers and links found by live web search when nothing stored answered. Shown as Found online, check before paying." }),
  });
  return await source("benita_live_web");
}

export async function live(text: string, city: string, terms: string[], budgetMs = 12_000): Promise<LiveResult> {
  const deadline = Date.now() + budgetMs;
  const town = await townFor(city);
  if (!town) return { saved: 0, map: 0, web: 0, engine: null, town: null, error: "unknown town" };
  const words = [...new Set([text, ...terms].map(safeWord).filter((word) => word.length >= 3))].slice(0, 10);
  if (!words.length) return { saved: 0, map: 0, web: 0, engine: null, town: town.name, error: "nothing to look for" };

  // The map answers first; it is free and its places are real.
  const mapRows = await fromMap(town, words, Math.min(deadline, Date.now() + 7_000)).catch(() => []);
  let saved = mapRows.length ? await upsert("knowledge_records", mapRows, "source_id,source_record_id") : 0;
  if (saved >= 3) return { saved, map: saved, web: 0, engine: "openstreetmap", town: town.name };

  // Then the web, cheapest first, each one only when the one before had nothing or is not set up.
  const query = `${text} in ${town.name} Zimbabwe contact phone`;
  let found: Found[] = [], engine: string | null = null;
  for (const [name, run] of [
    ["tavily", (ms: number) => tavily(query, ms).then((hits) => hits && fromHits(hits, town.name, words))],
    ["exa", (ms: number) => exa(query, ms).then((hits) => hits && fromHits(hits, town.name, words))],
    ["openrouter", (ms: number) => openrouter(text, town.name, ms)],
  ] as [string, (ms: number) => Promise<Found[] | null>][]) {
    const left = deadline - Date.now();
    if (left < 2_000) break;
    try {
      const result = await run(left - 500);
      if (result === null) continue; // not set up
      if (result.length) { found = result; engine = name; break; }
    } catch (error) { console.warn(JSON.stringify({ event: "benita.live_web_failed", engine: name, error: String(error).slice(0, 120) })); }
  }
  if (found.length) {
    const src = await liveSource();
    const now = new Date().toISOString();
    const category = titleCase(text);
    const rows = found.map((item) => ({
      record_type: "business", name: item.name, country_code: "ZW", city: town.name, area: item.area, category, subcategory: text,
      service_tags: [text], description: null, phone: item.phone, whatsapp: null, website: item.website, address: null, latitude: null, longitude: null,
      provenance_state: "POTENTIAL", confidence: item.phone ? 0.4 : 0.3, provider_kind: "organization",
      source_id: src.id, source_record_id: `${new URL(item.url).host.replace(/^www\./, "")}#${slug(item.name)}#${slug(town.name)}`, source_url: item.url,
      source_license: src.license, source_retrieved_at: now, source_payload: { engine, query },
      search_text: searchText(item.name, category, words, item.area, town.name),
    }));
    saved += await upsert("knowledge_records", rows, "source_id,source_record_id");
  }
  return { saved, map: mapRows.length, web: found.length, engine: engine ?? (mapRows.length ? "openstreetmap" : null), town: town.name };
}

/** Every search that found nothing in the last day is looked up again, most-asked first. */
export async function gaps(limit = 15): Promise<{ seen: number; accepted: number; rejected: number }> {
  const since = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const rows = await rest<{ category: string | null; city: string | null }[]>(`connect_search_log?result_count=eq.0&created_at=gte.${since}&category=not.is.null&city=not.is.null&select=category,city&limit=500`);
  const counts = new Map<string, { category: string; city: string; n: number }>();
  for (const row of rows) {
    const key = `${row.category!.toLocaleLowerCase()}|${row.city!.toLocaleLowerCase()}`;
    counts.set(key, { category: row.category!, city: row.city!, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  const todo = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit);
  let accepted = 0, rejected = 0;
  for (const gap of todo) {
    const town = await rpc<string | null>("benita_resolve_town", { p_city: gap.city }).catch(() => null);
    const result = await live(gap.category, town ?? gap.city, [], 20_000).catch(() => null);
    if (result?.saved) accepted += result.saved; else rejected++;
  }
  return { seen: todo.length, accepted, rejected };
}
