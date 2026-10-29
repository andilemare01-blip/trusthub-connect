/**
 * Supabase implementation of the Connect store. Server-only: it is built with
 * the service-role client, and every table it writes is closed to the public
 * by row-level security. Errors are thrown with the operation name only, never
 * with row contents or phone numbers.
 */
import type { AreaPulse, ConnectStore, CreditReason, DirectoryBusiness, IdentityActivity, Listing, ListingQuery, NewBusinessSubmission, NewListing, NewReview, ReviewCard, ReviewItem, ReviewQuery, ScamSummary, SearchLogEntry } from "./store.ts";
import { median, reviewMatches } from "./store.ts";

type Row = Record<string, unknown>;
interface Result { data: Row | Row[] | null; error: { message: string; code?: string } | null; count?: number | null }
/** The subset of the Supabase query builder this store uses. */
export interface ConnectQuery extends PromiseLike<Result> {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): ConnectQuery;
  insert(values: Row | Row[]): ConnectQuery;
  update(values: Row): ConnectQuery;
  eq(column: string, value: unknown): ConnectQuery;
  neq(column: string, value: unknown): ConnectQuery;
  in(column: string, values: readonly unknown[]): ConnectQuery;
  ilike(column: string, pattern: string): ConnectQuery;
  gte(column: string, value: string): ConnectQuery;
  not(column: string, operator: string, value: unknown): ConnectQuery;
  or(filters: string): ConnectQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): ConnectQuery;
  limit(count: number): ConnectQuery;
  maybeSingle(): PromiseLike<Result>;
  single(): PromiseLike<Result>;
}
export interface ConnectDbClient { from(table: string): ConnectQuery }

const BUSINESS_COLUMNS = "id,name,category,city,area,phone,reviews_count";
const LISTING_COLUMNS = "id,intent,category,title,price_text,city,area,phone,status,created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY = /^\d{1,18}$/;

class ConnectStoreError extends Error {
  readonly code?: string;
  constructor(operation: string, error: { message: string; code?: string }) {
    super(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
    this.name = "ConnectStoreError";
    this.code = error.code;
  }
}

function rows(result: Result, operation: string): Row[] {
  if (result.error) throw new ConnectStoreError(operation, result.error);
  if (!result.data) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}
function count(result: Result, operation: string): number {
  if (result.error) throw new ConnectStoreError(operation, result.error);
  return typeof result.count === "number" ? result.count : 0;
}
const isDuplicate = (result: Result) => result.error?.code === "23505";
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
/** Escapes a user-typed term for an ilike pattern. */
const like = (value: string) => value.replace(/[\\%_]/g, "\\$&");
/** Terms placed inside a PostgREST or() filter may not contain its separators. */
const orTerm = (value: string) => value.replace(/[,()*:"\\%_]/g, " ").trim();
function identity(id: string): string {
  if (!IDENTITY.test(id)) throw new Error("Invalid WhatsApp identity id.");
  return id;
}
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function business(row: Row): DirectoryBusiness {
  return {
    id: String(row.id), name: String(row.name ?? ""), category: text(row.category), city: text(row.city), area: text(row.area),
    phone: text(row.phone), reviewsCount: typeof row.reviews_count === "number" ? row.reviews_count : null,
  };
}

function listing(row: Row): Listing {
  return {
    id: String(row.id), intent: String(row.intent) as Listing["intent"], category: String(row.category ?? "general"), title: String(row.title ?? ""),
    priceText: text(row.price_text), city: text(row.city), area: text(row.area), phone: text(row.phone),
    status: String(row.status) as Listing["status"], createdAt: String(row.created_at ?? ""),
  };
}

const PRICE_LABELS: Record<string, string> = { property: "Rent", phones: "Phones", electronics: "Electronics", vehicles: "Vehicles", furniture: "Furniture", jobs: "Wages offered", food: "Food", clothing: "Clothing" };

export class SupabaseConnectStore implements ConnectStore {
  private readonly db: ConnectDbClient;

  constructor(db: ConnectDbClient) { this.db = db; }

  async findCard(code: string): Promise<ReviewCard | null> {
    const found = rows(await this.db.from("connect_review_cards").select("id,code,status,business_id").eq("code", code.toUpperCase()).limit(1), "Read review card");
    if (!found[0]) return null;
    const card = found[0];
    const linked = typeof card.business_id === "string" ? await this.getBusiness(card.business_id) : null;
    return { id: String(card.id), code: String(card.code), status: String(card.status) as ReviewCard["status"], business: linked };
  }

  async searchDirectory(name: string, city: string | null, limit: number): Promise<DirectoryBusiness[]> {
    const run = async (term: string) => {
      let query = this.db.from("businesses").select(BUSINESS_COLUMNS).ilike("name", `%${like(term)}%`);
      if (city) query = query.ilike("city", like(city));
      return rows(await query.order("reviews_count", { ascending: false, nullsFirst: false }).limit(limit), "Search businesses").map(business);
    };
    const exact = await run(name.trim());
    if (exact.length) return exact;
    // "Sunny Bakery Chinhoyi" may be stored as "Sunny Bakeries"; try the longest word on its own.
    const longest = name.split(/\s+/).filter((word) => word.length >= 4).sort((a, b) => b.length - a.length)[0];
    return longest && longest !== name.trim() ? await run(longest) : [];
  }

  async getBusiness(id: string): Promise<DirectoryBusiness | null> {
    if (!UUID.test(id)) return null;
    const found = rows(await this.db.from("businesses").select(BUSINESS_COLUMNS).eq("id", id).limit(1), "Read business");
    return found[0] ? business(found[0]) : null;
  }

  async lastReviewAt(identityId: string, businessId: string): Promise<string | null> {
    if (!UUID.test(businessId)) return null;
    const found = rows(await this.db.from("trusthub_connect_reviews").select("created_at")
      .eq("whatsapp_identity_id", identity(identityId)).eq("directory_business_id", businessId)
      .order("created_at", { ascending: false }).limit(1), "Read previous review");
    return text(found[0]?.created_at);
  }

  async searchReviews(query: ReviewQuery): Promise<ReviewItem[]> {
    // Recent reviews first; the filter runs here because the set is small and the match rules must match the in-memory store.
    const reviews = rows(await this.db.from("trusthub_connect_reviews")
      .select("id,rating,review_text,status,verified_visit,created_at,directory_business_id")
      .in("status", ["published", "pending"]).order("created_at", { ascending: false }).limit(300), "Search reviews");
    const ids = [...new Set(reviews.map((row) => String(row.directory_business_id)).filter(Boolean))];
    if (!ids.length) return [];
    const businesses = new Map(rows(await this.db.from("businesses").select(BUSINESS_COLUMNS).in("id", ids).limit(300), "Read review businesses").map((row) => [String(row.id), business(row)]));
    const items: ReviewItem[] = [];
    for (const row of reviews) {
      const found = businesses.get(String(row.directory_business_id));
      if (!found) continue;
      const item: ReviewItem = { id: String(row.id), rating: Number(row.rating), text: String(row.review_text ?? ""), verifiedVisit: row.verified_visit === true, checked: row.status === "published", createdAt: String(row.created_at ?? ""), business: found };
      if (reviewMatches(item, query)) items.push(item);
      if (items.length >= query.limit) break;
    }
    return items;
  }

  async saveReview(review: NewReview): Promise<{ id: string; status: "published" | "pending" }> {
    const status = review.verifiedVisit ? "published" : "pending";
    const inserted = await this.db.from("trusthub_connect_reviews").insert({
      directory_business_id: review.businessId, whatsapp_identity_id: identity(review.identityId), rating: review.rating,
      review_text: review.text, is_anonymous: false, source_channel: "whatsapp", status, verified_visit: review.verifiedVisit,
      card_code: review.cardCode, source_message_id: review.sourceMessageId,
    }).select("id,status").single();
    if (isDuplicate(inserted)) {
      const existing = rows(await this.db.from("trusthub_connect_reviews").select("id,status").eq("source_message_id", review.sourceMessageId).limit(1), "Read saved review");
      if (existing[0]) return { id: String(existing[0].id), status: existing[0].status === "published" ? "published" : "pending" };
    }
    const saved = rows(inserted, "Save review")[0];
    if (!saved) throw new Error("Save review returned no row.");
    return { id: String(saved.id), status: saved.status === "published" ? "published" : "pending" };
  }

  async saveBusinessSubmission(submission: NewBusinessSubmission): Promise<{ id: string }> {
    const inserted = await this.db.from("trusthub_connect_businesses").insert({
      name: submission.name, category: submission.category, city: submission.city, area: submission.area, phone: submission.phone,
      country: "Zimbabwe", source_channel: "whatsapp", status: "pending",
      verification_notes: "Submitted through TrustHub Connect on WhatsApp; not yet verified.",
      submitted_by_whatsapp_identity_id: identity(submission.identityId), possible_duplicate_of: submission.possibleDuplicateOf,
      source_message_id: submission.sourceMessageId,
    }).select("id").single();
    if (isDuplicate(inserted)) {
      const existing = rows(await this.db.from("trusthub_connect_businesses").select("id").eq("source_message_id", submission.sourceMessageId).limit(1), "Read saved business");
      if (existing[0]) return { id: String(existing[0].id) };
    }
    const saved = rows(inserted, "Save business submission")[0];
    if (!saved) throw new Error("Save business submission returned no row.");
    return { id: String(saved.id) };
  }

  async saveListing(item: NewListing): Promise<{ id: string }> {
    const digits = item.phone.replace(/\D/g, "");
    const inserted = await this.db.from("trusthub_connect_listings").insert({
      title: item.title, description: item.description, category: item.category, intent: item.intent,
      price_text: item.priceText, currency: item.currency, price_min: item.priceMin, phone: item.phone || null,
      whatsapp_url: digits ? `https://wa.me/${digits}` : null, country: "Zimbabwe", city: item.city, area: item.area,
      source_channel: "whatsapp", source_text: item.sourceText, status: "pending",
      verification_notes: "Posted by the person themselves through TrustHub Connect on WhatsApp; not independently verified.",
      whatsapp_identity_id: identity(item.identityId), source_message_id: item.sourceMessageId,
    }).select("id").single();
    if (isDuplicate(inserted)) {
      const existing = rows(await this.db.from("trusthub_connect_listings").select("id").eq("source_message_id", item.sourceMessageId).limit(1), "Read saved listing");
      if (existing[0]) return { id: String(existing[0].id) };
    }
    const saved = rows(inserted, "Save listing")[0];
    if (!saved) throw new Error("Save listing returned no row.");
    return { id: String(saved.id) };
  }

  async searchListings(query: ListingQuery): Promise<Listing[]> {
    let builder = this.db.from("trusthub_connect_listings").select(LISTING_COLUMNS).in("intent", query.intents).in("status", ["approved", "pending"]);
    if (query.city) builder = builder.ilike("city", like(query.city));
    const terms = query.words.map(orTerm).filter((word) => word.length >= 3);
    const clauses = [...terms.map((word) => `title.ilike.*${word}*`), ...terms.map((word) => `description.ilike.*${word}*`), ...(query.category ? [`category.eq.${orTerm(query.category)}`] : [])];
    if (clauses.length) builder = builder.or(clauses.join(","));
    const found = rows(await builder.order("created_at", { ascending: false }).limit(Math.min(query.limit * 3, 30)), "Search listings").map(listing);
    // Checked listings first, then the newest.
    return found.sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved")).slice(0, query.limit);
  }

  async logSearch(entry: SearchLogEntry): Promise<void> {
    const result = await this.db.from("connect_search_log").insert({
      whatsapp_identity_id: entry.identityId && IDENTITY.test(entry.identityId) ? entry.identityId : null,
      journey: entry.journey, category: entry.category?.slice(0, 80) ?? null, city: entry.city?.slice(0, 80) ?? null, area: entry.area?.slice(0, 80) ?? null,
      query_text: entry.queryText?.slice(0, 200) ?? null, result_count: Math.max(0, entry.resultCount), source_message_id: entry.sourceMessageId,
    });
    if (result.error && !isDuplicate(result)) throw new ConnectStoreError("Log search", result.error);
  }

  async countSearches(city: string, category: string, days: number): Promise<number> {
    return count(await this.db.from("connect_search_log").select("id", { count: "exact", head: true })
      .ilike("city", like(city)).ilike("category", like(category)).gte("created_at", since(days)), "Count searches");
  }

  async lastCity(identityId: string): Promise<string | null> {
    const found = rows(await this.db.from("connect_search_log").select("city").eq("whatsapp_identity_id", identity(identityId))
      .not("city", "is", null).order("created_at", { ascending: false }).limit(1), "Read last city");
    return text(found[0]?.city);
  }

  async areaPulse(city: string, days: number): Promise<AreaPulse> {
    const from = since(days);
    const [searches, directoryNew, connectNew, listingsNew, priced] = await Promise.all([
      this.db.from("connect_search_log").select("category,result_count").ilike("city", like(city)).gte("created_at", from).not("category", "is", null).limit(2000),
      this.db.from("businesses").select("id", { count: "exact", head: true }).ilike("city", like(city)).gte("created_at", from),
      this.db.from("trusthub_connect_businesses").select("id", { count: "exact", head: true }).ilike("city", like(city)).eq("status", "approved").gte("created_at", from),
      this.db.from("trusthub_connect_listings").select("id", { count: "exact", head: true }).ilike("city", like(city)).in("status", ["approved", "pending"]).gte("created_at", from),
      this.db.from("trusthub_connect_listings").select("category,price_min,currency,intent").ilike("city", like(city)).in("status", ["approved", "pending"])
        .eq("currency", "USD").not("price_min", "is", null).gte("created_at", since(90)).limit(1000),
    ]);
    const tally = (entries: Row[]) => {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        const label = String(entry.category ?? "").trim().toLocaleLowerCase();
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return [...counts].map(([label, total]) => ({ label, count: total })).sort((a, b) => b.count - a.count).slice(0, 3);
    };
    const searchRows = rows(searches, "Read area searches");
    const prices = new Map<string, number[]>();
    for (const row of rows(priced, "Read area prices")) {
      const value = Number(row.price_min);
      if (!Number.isFinite(value) || value <= 0) continue;
      const key = String(row.category ?? "general");
      prices.set(key, [...(prices.get(key) ?? []), value]);
    }
    return {
      city,
      topSearches: tally(searchRows),
      notFound: tally(searchRows.filter((row) => Number(row.result_count) === 0)),
      newBusinesses: count(directoryNew, "Count new businesses") + count(connectNew, "Count new Connect businesses"),
      newListings: count(listingsNew, "Count new listings"),
      typicalPrices: [...prices].filter(([, values]) => values.length >= 3).map(([category, values]) => ({ label: PRICE_LABELS[category] ?? category, median: median(values), currency: "USD", samples: values.length }))
        .sort((a, b) => b.samples - a.samples).slice(0, 3),
    };
  }

  async scamSummary(phone: string, days: number): Promise<ScamSummary> {
    const found = rows(await this.db.from("connect_scam_reports").select("reason,created_at").eq("reported_phone", phone).neq("status", "dismissed")
      .gte("created_at", since(days)).order("created_at", { ascending: false }).limit(50), "Read scam reports");
    return { reports: found.length, reasons: found.slice(0, 2).map((row) => String(row.reason ?? "")).filter(Boolean), lastReportedAt: text(found[0]?.created_at) };
  }

  async saveScamReport(report: { phone: string; reason: string; identityId: string; sourceMessageId: string }): Promise<"saved" | "already_reported"> {
    const result = await this.db.from("connect_scam_reports").insert({ reported_phone: report.phone, reason: report.reason, reporter_identity_id: identity(report.identityId), source_message_id: report.sourceMessageId });
    if (isDuplicate(result)) return "already_reported";
    if (result.error) throw new ConnectStoreError("Save scam report", result.error);
    return "saved";
  }

  async saveFeedback(feedback: { message: string; identityId: string }): Promise<void> {
    // TrustHub's own feedback table, so the team sees app and WhatsApp feedback in one place.
    const result = await this.db.from("feedback").insert({ category: "connect_whatsapp", message: `[WhatsApp user #${identity(feedback.identityId)}] ${feedback.message}` });
    if (result.error) throw new ConnectStoreError("Save feedback", result.error);
  }

  async addCredits(identityId: string, delta: number, reason: CreditReason, reference: string): Promise<{ balance: number; added: boolean }> {
    const result = await this.db.from("connect_credit_ledger").insert({ whatsapp_identity_id: identity(identityId), delta, reason, reference: reference.slice(0, 200) });
    if (result.error && !isDuplicate(result)) throw new ConnectStoreError("Record credits", result.error);
    return { balance: await this.creditBalance(identityId), added: !result.error };
  }

  async creditBalance(identityId: string): Promise<number> {
    return rows(await this.db.from("connect_credit_ledger").select("delta").eq("whatsapp_identity_id", identity(identityId)).limit(5000), "Read credits")
      .reduce((sum, row) => sum + (Number(row.delta) || 0), 0);
  }

  async activity(identityId: string): Promise<IdentityActivity> {
    const id = identity(identityId);
    const [reviews, listings, businesses] = await Promise.all([
      this.db.from("trusthub_connect_reviews").select("id", { count: "exact", head: true }).eq("whatsapp_identity_id", id),
      this.db.from("trusthub_connect_listings").select("id", { count: "exact", head: true }).eq("whatsapp_identity_id", id),
      this.db.from("trusthub_connect_businesses").select("id", { count: "exact", head: true }).eq("submitted_by_whatsapp_identity_id", id),
    ]);
    return { reviews: count(reviews, "Count reviews"), listings: count(listings, "Count listings"), businesses: count(businesses, "Count businesses") };
  }
}
