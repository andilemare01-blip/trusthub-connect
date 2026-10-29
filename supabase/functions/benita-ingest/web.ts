/**
 * Generic public-website connector. A source is described by data in
 * knowledge_sources.benita_config, so adding a site needs no new code:
 *
 *   { "seeds": ["https://site/listings"], "follow": ["/listings\\?page=\\d+$"],
 *     "detail": ["/listings/[a-z0-9-]+-\\d+$"], "record": "listing", "ttl_days": 30 }
 *
 * Benita obeys robots.txt and its crawl-delay, fetches a bounded number of
 * pages per run, and stores facts (name, price, place, phone, link) rather
 * than whole pages or photos.
 */
import { rest, source, upsert, type SourceRow } from "./db.ts";
import { allowed, robotsFor } from "./robots.ts";
import { clean, listingCategory, price, searchText, USER_AGENT, zwCity, zwPhone, zwPhonesIn } from "./normalise.ts";

export interface WebConfig {
  seeds: string[];
  follow?: string[];
  detail?: string[];
  skip?: string[];
  record?: "listing" | "business" | "auto";
  intent?: "offering" | "recruiting" | "seeking";
  category?: string;
  city?: string;
  ttl_days?: number;
  recrawl_hours?: number;
  pages_per_run?: number;
  use_sitemaps?: boolean;
}

interface QueueRow { id: string; url: string; kind: string; attempts: number }

const BUSINESS_TYPES = /^(LocalBusiness|Organization|Store|Restaurant|FoodEstablishment|Hotel|LodgingBusiness|AutomotiveBusiness|AutoDealer|AutoRepair|HealthAndBeautyBusiness|MedicalBusiness|Pharmacy|Dentist|Physician|ProfessionalService|LegalService|FinancialService|RealEstateAgent|HomeAndConstructionBusiness|Plumber|Electrician|GeneralContractor|EducationalOrganization|School|SportsActivityLocation|EntertainmentBusiness|TravelAgency|ShoppingCenter|GroceryStore|ClothingStore|ElectronicsStore|HardwareStore|FurnitureStore|BeautySalon|HairSalon|DaySpa|ChildCare|EmploymentAgency|InsuranceAgency|Bakery|CafeOrCoffeeShop|BarOrPub|FastFoodRestaurant|NGO|Corporation)$/;
const LISTING_TYPES = /^(Product|Offer|AggregateOffer|Vehicle|Car|Motorcycle|IndividualProduct|ProductModel|RealEstateListing|Residence|House|Apartment|SingleFamilyResidence|Accommodation|JobPosting|ClassifiedAd)$/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function types(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((v): v is string => typeof v === "string").map((v) => v.replace(/^https?:\/\/schema\.org\//, ""));
}

function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node["@type"]) out.push(node);
    // Listings are often nested: WebPage > ItemList > ListItem > RealEstateListing > Offer > seller.
    for (const [key, child] of Object.entries(node)) if (key !== "@context" && child && typeof child === "object") walk(child);
  };
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1].trim().replace(/^<!--|-->$/g, ""))); } catch { /* a broken block is skipped */ }
  }
  return out;
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? clean(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? null, 500) : null;
}

function links(html: string, base: URL): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base);
      if (url.host === base.host && /^https?:$/.test(url.protocol)) found.add(url.toString());
    } catch { /* not a URL */ }
  }
  return [...found];
}

const slug = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** "Townhouse for Sale in Arlington" -> "Arlington". */
function areaFromName(name: string): string | null {
  const m = /\b(?:in|at)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})\s*$/.exec(name);
  return m && !zwCity(m[1]) ? m[1].slice(0, 60) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return clean(value, 300);
  if (value && typeof value === "object" && "name" in (value as Record<string, unknown>)) return text((value as Record<string, unknown>).name);
  return null;
}

function address(node: Record<string, unknown>): { address: string | null; city: string | null; area: string | null } {
  const a = (Array.isArray(node.address) ? node.address[0] : node.address) as Record<string, unknown> | string | undefined;
  if (!a) return { address: null, city: null, area: null };
  if (typeof a === "string") return { address: clean(a, 200), city: zwCity(a), area: null };
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion].map(text).filter(Boolean) as string[];
  const locality = text(a.addressLocality);
  return { address: parts.join(", ") || null, city: zwCity(locality ?? parts.join(" ")) ?? (locality ? locality.slice(0, 60) : null), area: locality && !zwCity(locality) ? locality.slice(0, 60) : null };
}

/** The first PostalAddress anywhere inside a node (listings often nest it under about, itemOffered or a seller). */
function nestedAddress(node: Record<string, unknown>, depth = 0): Record<string, unknown> | null {
  if (depth > 4) return null;
  for (const [key, child] of Object.entries(node)) {
    if (!child || typeof child !== "object" || key === "seller" || key === "offeredBy" || key === "provider") continue;
    const items = Array.isArray(child) ? child : [child];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (key === "address" && (typeof record.addressLocality === "string" || typeof record.streetAddress === "string")) return { address: record };
      const found = nestedAddress(record, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function offerOf(node: Record<string, unknown>): { amount: number | null; currency: string | null; text: string | null } {
  const offers = (Array.isArray(node.offers) ? node.offers[0] : node.offers) as Record<string, unknown> | undefined;
  const source = offers ?? node;
  const raw = source.price ?? source.lowPrice ?? (source.priceSpecification as Record<string, unknown> | undefined)?.price ?? (node.baseSalary as Record<string, unknown> | undefined)?.value;
  const amount = typeof raw === "number" ? raw : raw && typeof raw === "object" ? Number((raw as Record<string, unknown>).value ?? (raw as Record<string, unknown>).minValue) : Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  const currency = text(source.priceCurrency ?? (node.baseSalary as Record<string, unknown> | undefined)?.currency);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: null, currency: null, text: null };
  const cur = currency?.toUpperCase() ?? "USD";
  return { amount, currency: cur, text: `${cur === "USD" ? "$" : cur + " "}${amount.toLocaleString("en-US")}` };
}

interface Extracted { listings: Record<string, unknown>[]; businesses: Record<string, unknown>[] }

export function extract(html: string, url: string, cfg: WebConfig, src: SourceRow, isDetail: boolean): Extracted {
  const now = new Date();
  const host = new URL(url).host;
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] ?? url;
  const nodes = jsonLd(html);
  const title = meta(html, "og:title") ?? clean(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? null, 200) ?? clean(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null, 200);
  const description = meta(html, "og:description") ?? meta(html, "description");
  const tels = [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => zwPhone(decodeURIComponent(m[1]))).filter(Boolean) as string[];
  const wa = /href=["'](https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"']+)["']/i.exec(html)?.[1] ?? null;
  const pagePhone = tels[0] ?? (wa ? zwPhone(/(\d{9,15})/.exec(wa)?.[1]) : null) ?? (isDetail ? zwPhonesIn(clean(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "), 200_000) ?? "")[0] ?? null : null);
  const out: Extracted = { listings: [], businesses: [] };
  const expires = new Date(now.getTime() + (cfg.ttl_days ?? 30) * 86_400_000).toISOString();

  const pushListing = (fields: { title: string; description: string | null; offer: ReturnType<typeof offerOf>; city: string | null; area: string | null; phone: string | null; intent: string; id: string; link: string; category?: string | null }) => {
    const category = fields.category ?? cfg.category ?? listingCategory(`${fields.title} ${fields.description ?? ""} ${fields.link}`);
    out.listings.push({
      title: fields.title.slice(0, 200), description: fields.description ?? "", category, intent: fields.intent,
      price_text: fields.offer.text, currency: fields.offer.currency, price_min: fields.offer.amount, price_max: fields.offer.amount,
      phone: fields.phone, whatsapp_url: fields.phone ? `https://wa.me/${fields.phone.replace("+", "")}` : null,
      country: "Zimbabwe", city: fields.city ?? cfg.city ?? null, area: fields.area,
      source_channel: "web", source_text: (fields.description ?? fields.title).slice(0, 500), status: "pending",
      verification_notes: `Collected by Benita from ${host} on ${now.toISOString().slice(0, 10)}. Not checked by TrustHub.`,
      source_key: src.source_key, source_url: fields.link, external_id: fields.id, expires_at: expires, last_seen_at: now.toISOString(),
    });
  };

  for (const node of nodes) {
    const kinds = types(node);
    const name = text(node.name ?? node.title ?? node.headline);
    if (!name) continue;
    const where = address(node.address ? node : nestedAddress(node) ?? node);
    const ownUrl = text(node.url) && /^https?:/.test(String(node.url)) ? String(node.url) : null;
    const link = ownUrl ?? canonical;
    // A page-level phone belongs to a detail page's own item, never to every item on an index page.
    const offer0 = (Array.isArray(node.offers) ? node.offers[0] : node.offers) as Record<string, unknown> | undefined;
    const seller = (offer0?.seller ?? offer0?.offeredBy ?? node.seller ?? node.hiringOrganization ?? node.provider) as Record<string, unknown> | undefined;
    const phone = zwPhone(node.telephone ?? (node.contactPoint as Record<string, unknown> | undefined)?.telephone ?? seller?.telephone) ?? (isDetail ? pagePhone : null);
    // The site describing itself (an Organization at its own home page) is not a business we list.
    const siteItself = kinds.every((k) => k === "Organization" || k === "Corporation") && (!ownUrl || new URL(ownUrl).pathname === "/");
    if (kinds.some((k) => BUSINESS_TYPES.test(k)) && cfg.record !== "listing" && !siteItself) {
      out.businesses.push({
        record_type: "business", name: name.slice(0, 200), country_code: "ZW", city: where.city ?? zwCity(`${title} ${description}`) ?? cfg.city ?? null, area: where.area,
        category: cfg.category ?? kinds.find((k) => k !== "LocalBusiness" && k !== "Organization")?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? null,
        description: clean(node.description, 300), phone, website: text(node.url), address: where.address,
        latitude: Number((node.geo as Record<string, unknown> | undefined)?.latitude) || null, longitude: Number((node.geo as Record<string, unknown> | undefined)?.longitude) || null,
        provenance_state: "POTENTIAL", confidence: phone ? 0.45 : 0.35, provider_kind: "organization",
        source_id: src.id, source_record_id: ownUrl ?? `${host}#${slug(name)}`, source_url: ownUrl ?? canonical, source_license: src.license, source_retrieved_at: now.toISOString(),
        source_payload: { types: kinds, host }, search_text: searchText(name, cfg.category, kinds, node.description, where.area, where.city),
      });
    } else if (kinds.some((k) => LISTING_TYPES.test(k)) && cfg.record !== "business") {
      const jobs = kinds.includes("JobPosting");
      if (!ownUrl && !isDetail) continue; // an item with no page of its own on a list page cannot be linked to
      pushListing({
        title: name, description: clean(node.description, 300) ?? (isDetail ? description : null), offer: offerOf(node),
        city: where.city ?? zwCity(`${link} ${name}`) ?? zwCity(description) ?? cfg.city ?? null, area: where.area ?? areaFromName(name),
        phone, intent: jobs ? "recruiting" : /rent|to-let|to-rent|lease/i.test(`${link} ${name}`) ? "offering" : cfg.intent ?? "offering",
        id: ownUrl ?? `${canonical}#${slug(name)}`, link, category: jobs ? "Jobs" : null,
      });
    }
  }

  // Pages without structured data still carry a title, a price and a phone in their meta tags.
  if (isDetail && !out.listings.length && !out.businesses.length && title) {
    const offer = (() => {
      const amount = meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? meta(html, "price");
      const parsed = price(amount ?? /(?:US\$|\$|USD)\s?\d[\d,]*(?:\.\d{2})?/.exec(clean(html, 200_000) ?? "")?.[0] ?? null);
      return { amount: parsed.amount, currency: meta(html, "product:price:currency") ?? parsed.currency, text: parsed.amount ? `${parsed.currency === "USD" || !parsed.currency ? "$" : parsed.currency + " "}${parsed.amount.toLocaleString("en-US")}` : null };
    })();
    if (cfg.record === "business") {
      out.businesses.push({
        record_type: "business", name: title.slice(0, 200), country_code: "ZW", city: zwCity(`${title} ${description} ${url}`) ?? cfg.city ?? null, area: null, category: cfg.category ?? null,
        description, phone: pagePhone, website: null, address: null, latitude: null, longitude: null, provenance_state: "POTENTIAL", confidence: pagePhone ? 0.4 : 0.3, provider_kind: "organization",
        source_id: src.id, source_record_id: canonical, source_url: canonical, source_license: src.license, source_retrieved_at: now.toISOString(),
        source_payload: { host, from: "meta" }, search_text: searchText(title, cfg.category, description),
      });
    } else {
      pushListing({ title, description, offer, city: zwCity(`${title} ${description} ${url}`), area: null, phone: pagePhone, intent: cfg.intent ?? "offering", id: canonical, link: canonical });
    }
  }
  return out;
}

/** One row per conflict key, so a page that repeats an item cannot fail the whole batch. */
function unique(rows: Record<string, unknown>[], key: string): Record<string, unknown>[] {
  return [...new Map(rows.map((row) => [String(row[key]), row])).values()];
}

const matchesAny = (url: string, patterns: string[] | undefined) => !!patterns?.some((p) => new RegExp(p, "i").test(url));

async function enqueue(sourceKey: string, urls: string[], kind: string): Promise<number> {
  if (!urls.length) return 0;
  const rows = [...new Set(urls)].slice(0, 500).map((url) => ({ source_key: sourceKey, url, kind }));
  await rest("benita_crawl_queue?on_conflict=url", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: JSON.stringify(rows) });
  return rows.length;
}

export async function runWeb(sourceKey: string, budgetMs = 110_000): Promise<{ seen: number; accepted: number; rejected: number; queued: number }> {
  const started = Date.now();
  const src = await source(sourceKey);
  if (!src.benita_enabled) throw new Error(`${sourceKey} is not enabled for Benita`);
  const cfg = src.benita_config as unknown as WebConfig;
  if (!cfg.seeds?.length) throw new Error(`${sourceKey} has no seeds`);

  // Claim the source first, so a second scheduler tick picks a different site instead of doubling up on this one.
  await rest(`knowledge_sources?id=eq.${src.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ benita_last_run_at: new Date().toISOString() }) });
  const existing = await rest<{ id: string }[]>(`benita_crawl_queue?source_key=eq.${sourceKey}&select=id&limit=1`);
  let queued = 0;
  if (!existing.length) {
    queued += await enqueue(sourceKey, cfg.seeds.filter((u) => !/\.xml(\.gz)?$/i.test(u)), "index");
    queued += await enqueue(sourceKey, cfg.seeds.filter((u) => /\.xml(\.gz)?$/i.test(u)), "sitemap");
    if (cfg.use_sitemaps) {
      const rules = await robotsFor(cfg.seeds[0]);
      queued += await enqueue(sourceKey, rules.sitemaps, "sitemap");
    }
  }

  let seen = 0, accepted = 0, rejected = 0, fetched = 0;
  const limit = cfg.pages_per_run ?? 30;
  // Keep pulling due work until the page limit or the time budget runs out: links found on one page are crawled in the same run.
  while (fetched < limit && Date.now() - started < budgetMs) {
  const due = await rest<QueueRow[]>(`benita_crawl_queue?source_key=eq.${sourceKey}&status=eq.pending&next_fetch_at=lte.${new Date().toISOString()}&select=id,url,kind,attempts&order=kind.desc,next_fetch_at.asc&limit=${Math.min(10, limit - fetched)}`);
  if (!due.length) break;
  for (const item of due) {
    if (Date.now() - started > budgetMs) break;
    fetched++;
    const rules = await robotsFor(item.url);
    if (!allowed(item.url, rules) || matchesAny(item.url, cfg.skip)) {
      await rest(`benita_crawl_queue?id=eq.${item.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ status: "skipped", error: "robots.txt or skip rule", fetched_at: new Date().toISOString() }) });
      continue;
    }
    let status = 0, found = 0, error: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(item.url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: controller.signal });
      clearTimeout(timer);
      status = response.status;
      if (!response.ok) throw new Error(`HTTP ${status}`);
      const body = (await response.text()).slice(0, 3_000_000);
      const base = new URL(response.url || item.url);
      seen++;
      if (item.kind === "sitemap" || /^\s*<\?xml|<urlset|<sitemapindex/i.test(body.slice(0, 500))) {
        const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
        const childMaps = /<sitemapindex/i.test(body) ? locs : locs.filter((u) => /\.xml(\.gz)?$/i.test(u));
        await enqueue(sourceKey, childMaps.filter((u) => !cfg.follow?.length || matchesAny(u, cfg.follow) || /sitemap/i.test(u)), "sitemap");
        found = await enqueue(sourceKey, locs.filter((u) => matchesAny(u, cfg.detail) && !matchesAny(u, cfg.skip)), "page");
        found += await enqueue(sourceKey, locs.filter((u) => matchesAny(u, cfg.follow) && !matchesAny(u, cfg.skip) && !/\.xml(\.gz)?$/i.test(u)), "index");
        queued += found;
      } else {
        const isDetail = item.kind === "page" || matchesAny(item.url, cfg.detail);
        const result = extract(body, base.toString(), cfg, src, isDetail);
        const listings = unique(result.listings, "external_id"), businesses = unique(result.businesses, "source_record_id");
        if (listings.length) accepted += await upsert("trusthub_connect_listings", listings, "source_key,external_id", 200);
        if (businesses.length) accepted += await upsert("knowledge_records", businesses, "source_id,source_record_id", 200);
        found = result.listings.length + result.businesses.length;
        if (!isDetail && !found) rejected++;
        const all = links(body, base);
        queued += await enqueue(sourceKey, all.filter((u) => matchesAny(u, cfg.detail) && !matchesAny(u, cfg.skip)), "page");
        queued += await enqueue(sourceKey, all.filter((u) => matchesAny(u, cfg.follow) && !matchesAny(u, cfg.skip)), "index");
      }
    } catch (err) { error = String(err).slice(0, 200); rejected++; }
    const revisitHours = item.kind === "page" ? (cfg.ttl_days ?? 30) * 24 : cfg.recrawl_hours ?? 24;
    const failed = error !== null;
    await rest(`benita_crawl_queue?id=eq.${item.id}`, {
      method: "PATCH", prefer: "return=minimal",
      body: JSON.stringify({
        status: failed ? (item.attempts >= 2 ? "failed" : "pending") : item.kind === "page" ? "done" : "pending",
        attempts: item.attempts + 1, http_status: status || null, error, found, fetched_at: new Date().toISOString(),
        next_fetch_at: new Date(Date.now() + (failed ? 6 : revisitHours) * 3_600_000).toISOString(),
      }),
    });
    await sleep(rules.delayMs);
  }
  }
  return { seen, accepted, rejected, queued };
}

/** Looks at a page the way Benita would, without saving anything. Used to write a new source's config. */
export async function probe(url: string): Promise<Record<string, unknown>> {
  const rules = await robotsFor(url);
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  const body = await response.text();
  const base = new URL(response.url || url);
  const nodes = jsonLd(body);
  const all = links(body, base);
  return {
    url: response.url, status: response.status, allowed: allowed(url, rules), crawlDelayMs: rules.delayMs, sitemaps: rules.sitemaps.slice(0, 10),
    disallow: rules.disallow.slice(0, 30), bytes: body.length, title: clean(/<title>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? null, 150),
    jsonLdTypes: [...new Set(nodes.map((n) => types(n).join("/")))].slice(0, 30),
    jsonLdSample: [...new Map(nodes.filter((n) => types(n).some((k) => LISTING_TYPES.test(k) || BUSINESS_TYPES.test(k))).map((n) => [types(n).join("/"), n])).values()].slice(0, 3).map((n) => JSON.stringify(n).slice(0, 900)),
    wouldExtract: (() => { const r = extract(body, base.toString(), { seeds: [url], record: "auto" }, { id: "probe", source_key: "probe", name: "probe", license: null, reuse_status: "review", benita_enabled: true, benita_config: {} }, false); return { listings: r.listings.length, businesses: r.businesses.length, sample: [...r.listings.slice(0, 2), ...r.businesses.slice(0, 1)].map((x) => ({ title: x.title ?? x.name, price: x.price_text, city: x.city, area: x.area, phone: x.phone, url: x.source_url })) }; })(),
    og: { title: meta(body, "og:title"), description: meta(body, "og:description")?.slice(0, 150), price: meta(body, "product:price:amount") },
    tel: [...body.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]).slice(0, 5),
    phonesInText: zwPhonesIn(clean(body, 200_000) ?? "").slice(0, 5),
    linkCount: all.length, linkSample: all.filter((u) => !/\.(css|js|png|jpg|svg|ico|woff2?)(\?|$)/i.test(u)).slice(0, 80),
    textSample: clean(body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "), 1500),
  };
}
