import type { BenitaFact, BenitaQuery, BenitaResult } from "../benita/index.ts";

/**
 * Storage seam for TrustHub Connect journeys. Journeys depend only on this
 * interface; production uses the Supabase implementation and tests use the
 * in-memory one. Every write carries the inbound WhatsApp message id so a
 * redelivered webhook can never create a second row.
 */

export interface DirectoryBusiness {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  area: string | null;
  phone: string | null;
  reviewsCount: number | null;
}

export interface ReviewCard {
  id: string;
  code: string;
  status: "active" | "paused" | "unassigned";
  business: DirectoryBusiness | null;
}

/** A review as shown to a person reading about a business. `checked` is true once TrustHub has published it. */
export interface ReviewItem {
  id: string;
  rating: number;
  text: string;
  verifiedVisit: boolean;
  checked: boolean;
  createdAt: string;
  business: DirectoryBusiness;
}

export interface ReviewQuery {
  /** Words from the question. A review matches when any word appears in the business name, category or review text. */
  terms: string[];
  city: string | null;
  limit: number;
}

/** Shared by both stores so the test and production behaviour cannot drift apart. */
export function reviewMatches(item: { business: DirectoryBusiness; text: string }, query: ReviewQuery): boolean {
  if (query.city && lower(item.business.city) !== lower(query.city)) return false;
  if (!query.terms.length) return true;
  const haystack = lower(`${item.business.name} ${item.business.category ?? ""} ${item.text}`);
  return query.terms.some((term) => haystack.includes(lower(term)));
}

export interface NewReview {
  businessId: string;
  identityId: string;
  rating: number;
  text: string;
  verifiedVisit: boolean;
  cardCode: string | null;
  sourceMessageId: string;
}

export type ListingIntent = "offering" | "seeking" | "recruiting" | "job_seeking";

export interface NewListing {
  intent: ListingIntent;
  category: string;
  title: string;
  description: string;
  priceText: string | null;
  priceMin: number | null;
  currency: string | null;
  city: string | null;
  area: string | null;
  phone: string;
  identityId: string;
  sourceText: string;
  sourceMessageId: string;
}

export interface Listing {
  id: string;
  intent: ListingIntent | "community_resource";
  category: string;
  title: string;
  priceText: string | null;
  city: string | null;
  area: string | null;
  phone: string | null;
  status: "pending" | "approved" | "rejected" | "needs_review" | "expired";
  createdAt: string;
  /** Set when Benita collected the listing from a public website rather than a WhatsApp post. */
  sourceUrl?: string | null;
}

export interface ListingQuery {
  intents: readonly ListingIntent[];
  words: readonly string[];
  category?: string | null;
  city?: string | null;
  limit: number;
}

export interface NewBusinessSubmission {
  name: string;
  category: string;
  city: string;
  area: string | null;
  phone: string | null;
  identityId: string;
  possibleDuplicateOf: string | null;
  sourceMessageId: string;
}

export interface SearchLogEntry {
  identityId: string | null;
  journey: string;
  category: string | null;
  city: string | null;
  area: string | null;
  queryText: string | null;
  resultCount: number;
  sourceMessageId: string | null;
}

export interface ScamSummary {
  reports: number;
  reasons: string[];
  lastReportedAt: string | null;
}

export interface AreaPulse {
  city: string;
  topSearches: { label: string; count: number }[];
  notFound: { label: string; count: number }[];
  newBusinesses: number;
  newListings: number;
  typicalPrices: { label: string; median: number; currency: string; samples: number }[];
}

export interface IdentityActivity {
  reviews: number;
  listings: number;
  businesses: number;
}

export type CreditReason = "welcome" | "review" | "add_business" | "listing" | "scam_report" | "deep_question" | "admin_adjustment";

export interface ConnectStore {
  findCard(code: string): Promise<ReviewCard | null>;
  searchDirectory(name: string, city: string | null, limit: number): Promise<DirectoryBusiness[]>;
  getBusiness(id: string): Promise<DirectoryBusiness | null>;
  /** The newest review this identity left for this business, if any. */
  lastReviewAt(identityId: string, businessId: string): Promise<string | null>;
  saveReview(review: NewReview): Promise<{ id: string; status: "published" | "pending" }>;
  /** Reviews left through TrustHub Connect, newest first. Rejected reviews are never returned. */
  searchReviews(query: ReviewQuery): Promise<ReviewItem[]>;
  saveBusinessSubmission(submission: NewBusinessSubmission): Promise<{ id: string }>;
  saveListing(listing: NewListing): Promise<{ id: string }>;
  searchListings(query: ListingQuery): Promise<Listing[]>;
  logSearch(entry: SearchLogEntry): Promise<void>;
  /** Searches for this category in this city during the last `days` days. */
  countSearches(city: string, category: string, days: number): Promise<number>;
  lastCity(identityId: string): Promise<string | null>;
  areaPulse(city: string, days: number): Promise<AreaPulse>;
  scamSummary(phone: string, days: number): Promise<ScamSummary>;
  saveScamReport(report: { phone: string; reason: string; identityId: string; sourceMessageId: string }): Promise<"saved" | "already_reported">;
  saveFeedback(feedback: { message: string; identityId: string }): Promise<void>;
  /** Records a credit change once per (identity, reason, reference); `added` is false when it already existed. */
  addCredits(identityId: string, delta: number, reason: CreditReason, reference: string): Promise<{ balance: number; added: boolean }>;
  creditBalance(identityId: string): Promise<number>;
  activity(identityId: string): Promise<IdentityActivity>;
  /** Benita: one ranked search over every place, provider and listing, each with its trust tier. */
  benitaSearch(query: BenitaQuery): Promise<BenitaResult[]>;
  /** Benita: the latest public facts (fuel ceilings, exchange rates), optionally by key prefix. */
  currentFacts(prefix?: string | null): Promise<BenitaFact[]>;
  /** Benita: look something up live (open map, then the web), save what is found, and return how many were saved. */
  benitaLive?(request: { text: string; city: string; terms: string[] }): Promise<number>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const lower = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();

/** Test and local-harness implementation. Behaviour mirrors the Supabase store. */
export class InMemoryConnectStore implements ConnectStore {
  businesses: DirectoryBusiness[] = [];
  cards: ReviewCard[] = [];
  reviews: (NewReview & { id: string; status: "published" | "pending"; createdAt: string })[] = [];
  submissions: (NewBusinessSubmission & { id: string })[] = [];
  listings: (Listing & { identityId?: string; sourceMessageId?: string })[] = [];
  searches: (SearchLogEntry & { createdAt: string })[] = [];
  scamReports: { phone: string; reason: string; identityId: string; createdAt: string }[] = [];
  feedback: { message: string; identityId: string }[] = [];
  credits: { identityId: string; delta: number; reason: CreditReason; reference: string }[] = [];
  private readonly now: () => string;
  private sequence = 0;

  constructor(now: () => string = () => new Date().toISOString()) { this.now = now; }
  private nextId(prefix: string) { this.sequence += 1; return `${prefix}-${this.sequence}`; }

  async findCard(code: string) { return this.cards.find((card) => card.code.toUpperCase() === code.toUpperCase()) ?? null; }
  async searchDirectory(name: string, city: string | null, limit: number) {
    const wanted = lower(name);
    return this.businesses.filter((business) => lower(business.name).includes(wanted) && (!city || lower(business.city) === lower(city))).slice(0, limit);
  }
  async getBusiness(id: string) { return this.businesses.find((business) => business.id === id) ?? null; }
  async lastReviewAt(identityId: string, businessId: string) {
    return this.reviews.filter((review) => review.identityId === identityId && review.businessId === businessId).map((review) => review.createdAt).sort().at(-1) ?? null;
  }
  async saveReview(review: NewReview) {
    const existing = this.reviews.find((stored) => stored.sourceMessageId === review.sourceMessageId);
    if (existing) return { id: existing.id, status: existing.status };
    const stored = { ...review, id: this.nextId("review"), status: review.verifiedVisit ? "published" as const : "pending" as const, createdAt: this.now() };
    this.reviews.push(stored);
    return { id: stored.id, status: stored.status };
  }
  async searchReviews(query: ReviewQuery): Promise<ReviewItem[]> {
    const items: ReviewItem[] = [];
    for (const review of this.reviews) {
      const business = this.businesses.find((candidate) => candidate.id === review.businessId);
      if (!business) continue;
      const item: ReviewItem = { id: review.id, rating: review.rating, text: review.text, verifiedVisit: review.verifiedVisit, checked: review.status === "published", createdAt: review.createdAt, business };
      if (reviewMatches(item, query)) items.push(item);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, query.limit);
  }
  async saveBusinessSubmission(submission: NewBusinessSubmission) {
    const existing = this.submissions.find((stored) => stored.sourceMessageId === submission.sourceMessageId);
    if (existing) return { id: existing.id };
    const stored = { ...submission, id: this.nextId("submission") };
    this.submissions.push(stored);
    return { id: stored.id };
  }
  async saveListing(listing: NewListing) {
    const existing = this.listings.find((stored) => stored.sourceMessageId === listing.sourceMessageId);
    if (existing) return { id: existing.id };
    const id = this.nextId("listing");
    this.listings.push({ id, intent: listing.intent, category: listing.category, title: listing.title, priceText: listing.priceText, city: listing.city, area: listing.area, phone: listing.phone, status: "pending", createdAt: this.now(), identityId: listing.identityId, sourceMessageId: listing.sourceMessageId });
    return { id };
  }
  async searchListings(query: ListingQuery) {
    return this.listings.filter((listing) => {
      if (!query.intents.includes(listing.intent as ListingIntent)) return false;
      if (listing.status === "rejected" || listing.status === "expired") return false;
      if (query.city && lower(listing.city) !== lower(query.city)) return false;
      if (query.category && listing.category === query.category) return true;
      return !query.words.length || query.words.some((word) => lower(listing.title).includes(lower(word)));
    }).slice(0, query.limit);
  }
  async logSearch(entry: SearchLogEntry) {
    if (entry.sourceMessageId && this.searches.some((stored) => stored.sourceMessageId === entry.sourceMessageId)) return;
    this.searches.push({ ...entry, createdAt: this.now() });
  }
  async countSearches(city: string, category: string) {
    return this.searches.filter((entry) => lower(entry.city) === lower(city) && lower(entry.category) === lower(category)).length;
  }
  async lastCity(identityId: string) {
    return [...this.searches].reverse().find((entry) => entry.identityId === identityId && entry.city)?.city ?? null;
  }
  async areaPulse(city: string): Promise<AreaPulse> {
    const inCity = this.searches.filter((entry) => lower(entry.city) === lower(city) && entry.category);
    const tally = (entries: typeof inCity) => {
      const counts = new Map<string, number>();
      for (const entry of entries) counts.set(lower(entry.category), (counts.get(lower(entry.category)) ?? 0) + 1);
      return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 3);
    };
    const inCityListings = this.listings.filter((listing) => lower(listing.city) === lower(city));
    return { city, topSearches: tally(inCity), notFound: tally(inCity.filter((entry) => entry.resultCount === 0)), newBusinesses: 0, newListings: inCityListings.length, typicalPrices: [] };
  }
  async scamSummary(phone: string) {
    const reports = this.scamReports.filter((report) => report.phone === phone);
    return { reports: reports.length, reasons: reports.slice(-2).map((report) => report.reason), lastReportedAt: reports.at(-1)?.createdAt ?? null };
  }
  async saveScamReport(report: { phone: string; reason: string; identityId: string; sourceMessageId: string }) {
    if (this.scamReports.some((stored) => stored.phone === report.phone && stored.identityId === report.identityId)) return "already_reported" as const;
    this.scamReports.push({ phone: report.phone, reason: report.reason, identityId: report.identityId, createdAt: this.now() });
    return "saved" as const;
  }
  async saveFeedback(feedback: { message: string; identityId: string }) { this.feedback.push(feedback); }
  async addCredits(identityId: string, delta: number, reason: CreditReason, reference: string) {
    const added = !this.credits.some((entry) => entry.identityId === identityId && entry.reason === reason && entry.reference === reference);
    if (added) this.credits.push({ identityId, delta, reason, reference });
    return { balance: await this.creditBalance(identityId), added };
  }
  async creditBalance(identityId: string) {
    return this.credits.filter((entry) => entry.identityId === identityId).reduce((sum, entry) => sum + entry.delta, 0);
  }
  benitaResults: BenitaResult[] = [];
  facts: BenitaFact[] = [];
  async benitaSearch(query: BenitaQuery) {
    const words = query.text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
    return this.benitaResults.filter((result) => {
      if (query.city && lower(result.city) !== lower(query.city) && lower(result.area) !== lower(query.city)) return false;
      if (query.kinds && !query.kinds.includes(result.kind)) return false;
      const haystack = lower(`${result.name} ${result.category ?? ""} ${result.subcategory ?? ""}`);
      return words.some((word) => haystack.includes(word));
    }).slice(0, query.limit ?? 5);
  }
  async currentFacts(prefix: string | null = null) { return this.facts.filter((fact) => !prefix || fact.key.startsWith(prefix)); }
  /** What a live lookup would find; tests fill it to stand in for the map and the web. */
  liveFinds: BenitaResult[] = [];
  liveRequests: { text: string; city: string; terms: string[] }[] = [];
  async benitaLive(request: { text: string; city: string; terms: string[] }) {
    this.liveRequests.push(request);
    const found = this.liveFinds.splice(0);
    this.benitaResults.push(...found);
    return found.length;
  }
  async activity(identityId: string) {
    return {
      reviews: this.reviews.filter((review) => review.identityId === identityId).length,
      listings: this.listings.filter((listing) => listing.identityId === identityId).length,
      businesses: this.submissions.filter((submission) => submission.identityId === identityId).length,
    };
  }
}

export { median };
