/**
 * Review cards (NFC + QR). A card stores only its link, /r/TH-####; this
 * module maps the code to a business, counts taps and backs the admin card
 * manager. Server-only: it uses the service-role client.
 */
import type { ConnectDbClient } from "./supabase-store.ts";

export interface CardSummary {
  id: string;
  code: string;
  status: "active" | "paused" | "unassigned";
  businessId: string | null;
  businessName: string | null;
  businessPlace: string | null;
  note: string | null;
  createdAt: string;
  taps: number;
  reviews: number;
  newUsers: number;
}

export interface LandingCard {
  code: string;
  status: CardSummary["status"];
  business: { id: string; name: string; category: string | null; area: string | null; city: string | null; reviewsCount: number } | null;
}

type Row = Record<string, unknown>;
const CODE = /^TH-\d{4,6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(result: { data: Row | Row[] | null; error: { message: string; code?: string } | null }, operation: string): Row[] {
  if (result.error) throw new Error(`${operation} failed${result.error.code ? ` (${result.error.code})` : ""}.`);
  return !result.data ? [] : Array.isArray(result.data) ? result.data : [result.data];
}
const str = (value: unknown) => (typeof value === "string" ? value : null);

export function normalizeCardCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/^TH-?/, "TH-");
  return CODE.test(code) ? code : null;
}

export async function getLandingCard(db: ConnectDbClient, raw: string): Promise<LandingCard | null> {
  const code = normalizeCardCode(raw);
  if (!code) return null;
  const card = list(await db.from("connect_review_cards").select("code,status,business_id").eq("code", code).limit(1), "Read card")[0];
  if (!card) return null;
  const businessId = str(card.business_id);
  const business = businessId ? list(await db.from("businesses").select("id,name,category,area,city,reviews_count").eq("id", businessId).limit(1), "Read card business")[0] : null;
  return {
    code,
    status: String(card.status) as LandingCard["status"],
    business: business ? { id: String(business.id), name: String(business.name ?? ""), category: str(business.category), area: str(business.area), city: str(business.city), reviewsCount: Number(business.reviews_count) || 0 } : null,
  };
}

/** Counts one opening of the card link. Link-preview robots are not people, so they are skipped. */
export async function recordCardTap(db: ConnectDbClient, code: string, channel: "nfc" | "qr" | "link", userAgent: string | null): Promise<void> {
  if (userAgent && /bot|crawler|spider|preview|facebookexternalhit|whatsapp\/|telegrambot|slackbot|discordbot/i.test(userAgent)) return;
  const card = list(await db.from("connect_review_cards").select("id").eq("code", code).limit(1), "Find card")[0];
  if (!card) return;
  const result = await db.from("connect_card_taps").insert({ card_id: String(card.id), channel });
  if (result.error) throw new Error("Record card tap failed.");
}

/** Every card with its taps, reviews and the number of people whose first-ever review came through it. */
export async function listCards(db: ConnectDbClient): Promise<CardSummary[]> {
  const cards = list(await db.from("connect_review_cards").select("id,code,status,business_id,note,created_at").order("card_number", { ascending: false }).limit(500), "List cards");
  if (!cards.length) return [];
  const businessIds = [...new Set(cards.map((card) => str(card.business_id)).filter((id): id is string => !!id))];
  const codes = cards.map((card) => String(card.code));
  const [businesses, taps, reviews] = await Promise.all([
    businessIds.length ? db.from("businesses").select("id,name,area,city").in("id", businessIds).limit(500) : Promise.resolve({ data: [], error: null }),
    db.from("connect_card_taps").select("card_id").in("card_id", cards.map((card) => String(card.id))).limit(50000),
    db.from("trusthub_connect_reviews").select("card_code,whatsapp_identity_id,created_at").in("card_code", codes).limit(50000),
  ]);
  const byBusiness = new Map(list(businesses, "Read card businesses").map((row) => [String(row.id), row]));
  const tapCount = new Map<string, number>();
  for (const tap of list(taps, "Count card taps")) tapCount.set(String(tap.card_id), (tapCount.get(String(tap.card_id)) ?? 0) + 1);
  const reviewRows = list(reviews, "Count card reviews");
  // A "new user" is someone whose first Connect review of all came from this card.
  const identities = [...new Set(reviewRows.map((row) => row.whatsapp_identity_id).filter((id) => id !== null && id !== undefined).map(String))];
  const firstReview = new Map<string, string>();
  if (identities.length) {
    const all = list(await db.from("trusthub_connect_reviews").select("whatsapp_identity_id,card_code,created_at").in("whatsapp_identity_id", identities).order("created_at", { ascending: true }).limit(50000), "Read first reviews");
    for (const row of all) {
      const id = String(row.whatsapp_identity_id);
      if (!firstReview.has(id)) firstReview.set(id, String(row.card_code ?? ""));
    }
  }
  return cards.map((card) => {
    const code = String(card.code);
    const business = byBusiness.get(String(card.business_id ?? ""));
    const own = reviewRows.filter((row) => row.card_code === code);
    return {
      id: String(card.id), code, status: String(card.status) as CardSummary["status"],
      businessId: str(card.business_id), businessName: business ? String(business.name ?? "") : null,
      businessPlace: business ? [str(business.area), str(business.city)].filter(Boolean).join(", ") || null : null,
      note: str(card.note), createdAt: String(card.created_at ?? ""),
      taps: tapCount.get(String(card.id)) ?? 0,
      reviews: own.length,
      newUsers: [...firstReview.values()].filter((value) => value === code).length,
    };
  });
}

export async function createCard(db: ConnectDbClient, businessId: string, createdBy: string | null, note: string | null): Promise<{ id: string; code: string }> {
  if (!UUID.test(businessId)) throw new Error("Choose a business from the search.");
  const exists = list(await db.from("businesses").select("id").eq("id", businessId).limit(1), "Check business");
  if (!exists.length) throw new Error("That business no longer exists.");
  const created = list(await db.from("connect_review_cards").insert({ business_id: businessId, status: "active", created_by: createdBy && UUID.test(createdBy) ? createdBy : null, note: note?.slice(0, 200) || null }).select("id,code").single(), "Create card")[0];
  if (!created) throw new Error("Create card returned no row.");
  return { id: String(created.id), code: String(created.code) };
}

export async function updateCard(db: ConnectDbClient, cardId: string, change: { status?: CardSummary["status"]; businessId?: string | null }): Promise<void> {
  if (!UUID.test(cardId)) throw new Error("Unknown card.");
  const values: Row = { updated_at: new Date().toISOString() };
  if (change.status) {
    if (!["active", "paused", "unassigned"].includes(change.status)) throw new Error("Unknown card status.");
    values.status = change.status;
  }
  if (change.businessId !== undefined) {
    if (change.businessId !== null && !UUID.test(change.businessId)) throw new Error("Choose a business from the search.");
    values.business_id = change.businessId;
    if (change.businessId === null) values.status = "unassigned";
  }
  const result = await db.from("connect_review_cards").update(values).eq("id", cardId);
  if (result.error) throw new Error("Update card failed.");
}

export function cardLinks(baseUrl: string, code: string): { nfc: string; qr: string } {
  const base = baseUrl.replace(/\/+$/, "");
  return { nfc: `${base}/r/${code}?s=nfc`, qr: `${base}/r/${code}?s=qr` };
}
