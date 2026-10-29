import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRequest } from "./authorization";
import { createAdminServerClient } from "./server-client";
import type { ConnectDbClient } from "../connect/supabase-store";
import { assignAssistantName, ASSISTANT_NAMES } from "../conversation-coordinator/wisdom-library";

export const noStore = { "Cache-Control": "no-store" };

type Row = Record<string, unknown>;
type Result = { data: Row | Row[] | null; error: { message: string; code?: string } | null; count?: number | null };

/** Resolves the privileged client and confirms the caller is in admin_users, or returns the error response. */
export async function requireAdmin(request: NextRequest): Promise<{ db: ConnectDbClient; userId: string } | NextResponse> {
  const client = createAdminServerClient();
  if (!client) return NextResponse.json({ error: "Admin data is unavailable: the server is missing its Supabase configuration." }, { status: 503, headers: noStore });
  const auth = await authorizeAdminRequest(request.headers.get("authorization"), client);
  if (!auth.ok) {
    const message = auth.reason === "not_admin" ? "This account is not an administrator." : auth.reason === "unavailable" ? "Authorization is temporarily unavailable." : "Please sign in again.";
    return NextResponse.json({ error: message }, { status: auth.status, headers: noStore });
  }
  return { db: client as unknown as ConnectDbClient, userId: auth.userId };
}

function rows(result: Result, operation: string): Row[] {
  if (result.error) throw new Error(`${operation} failed${result.error.code ? ` (${result.error.code})` : ""}.`);
  return !result.data ? [] : Array.isArray(result.data) ? result.data : [result.data];
}
function count(result: Result, operation: string): number {
  if (result.error) throw new Error(`${operation} failed${result.error.code ? ` (${result.error.code})` : ""}.`);
  return typeof result.count === "number" ? result.count : 0;
}
const head = { count: "exact" as const, head: true };

/**
 * Signs in with TrustHub's own Supabase Auth (email and password) and only
 * hands back a session when the account is in admin_users.
 */
export async function adminPasswordLogin(email: string, password: string): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; status: number; error: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 503, error: "Sign-in is unavailable: the server is missing its Supabase configuration." };
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), cache: "no-store",
    });
  } catch {
    return { ok: false, status: 503, error: "Sign-in is temporarily unavailable." };
  }
  const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!response.ok || typeof body?.access_token !== "string") return { ok: false, status: 401, error: "That email and password don't match a TrustHub account." };
  const client = createAdminServerClient();
  if (!client) return { ok: false, status: 503, error: "Sign-in is unavailable." };
  const auth = await authorizeAdminRequest(`Bearer ${body.access_token}`, client);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.reason === "not_admin" ? "This account is not a TrustHub administrator." : "Sign-in is temporarily unavailable." };
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { ok: true, token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
}

/** Sends TrustHub's normal password-reset email. Always reports success so the form never reveals which emails exist. */
export async function adminPasswordReset(email: string): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url.replace(/\/+$/, "")}/auth/v1/recover`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email }), cache: "no-store" }).catch(() => undefined);
}

const LABEL: Record<string, string> = { find: "Find a business", review: "Rate or review", buy_sell: "Buy or sell", jobs: "Jobs", houses: "Houses & rentals" };

/** Everything the Connect overview shows, for activity since `since`. */
export async function connectMetrics(db: ConnectDbClient, since: string) {
  const [
    identities, newIdentities, conversations, messages, inbound,
    businesses, reviewsAll, reviewsPending, reviewsInRange, listingsAll, listingsPending, listingsInRange,
    submissionsPending, submissionsInRange, scamsOpen, cards, taps,
    searches, credits, aiEvents, identityIds,
  ] = await Promise.all([
    db.from("whatsapp_identities").select("id", head),
    db.from("whatsapp_identities").select("id", head).gte("created_at", since),
    db.from("conversations").select("id", head),
    db.from("conversation_messages").select("id", head),
    db.from("conversation_messages").select("created_at").eq("direction", "inbound").gte("created_at", since).limit(20000),
    db.from("businesses").select("id", head),
    db.from("trusthub_connect_reviews").select("id", head),
    db.from("trusthub_connect_reviews").select("id", head).eq("status", "pending"),
    db.from("trusthub_connect_reviews").select("id,verified_visit").gte("created_at", since).limit(20000),
    db.from("trusthub_connect_listings").select("id", head),
    db.from("trusthub_connect_listings").select("id", head).eq("status", "pending"),
    db.from("trusthub_connect_listings").select("id").gte("created_at", since).limit(20000),
    db.from("trusthub_connect_businesses").select("id", head).eq("status", "pending"),
    db.from("trusthub_connect_businesses").select("id").gte("created_at", since).limit(20000),
    db.from("connect_scam_reports").select("id", head).eq("status", "open"),
    db.from("connect_review_cards").select("id", head),
    db.from("connect_card_taps").select("id").gte("tapped_at", since).limit(50000),
    db.from("connect_search_log").select("journey,category,city,result_count").gte("created_at", since).limit(50000),
    db.from("connect_credit_ledger").select("delta,reason,created_at").limit(100000),
    db.from("connect_runtime_events").select("occurred_at,attributes").eq("name", "request_understood").gte("occurred_at", since).limit(50000),
    db.from("whatsapp_identities").select("id").limit(100000),
  ]);

  // Benita's own counters; a missing function never breaks the rest of the overview.
  const benitaRaw = db.rpc ? await db.rpc("benita_stats", {}).then((result) => (result.error ? null : result.data as Row | null), () => null) : null;
  const searchRows = rows(searches, "Read searches");
  const journeys = new Map<string, number>();
  const categories = new Map<string, number>();
  const gaps = new Map<string, number>();
  for (const row of searchRows) {
    const journey = String(row.journey ?? "find");
    journeys.set(journey, (journeys.get(journey) ?? 0) + 1);
    const category = String(row.category ?? "").trim().toLocaleLowerCase();
    if (!category) continue;
    categories.set(category, (categories.get(category) ?? 0) + 1);
    if (Number(row.result_count) === 0) {
      const key = `${category}|${String(row.city ?? "").trim() || "No town given"}`;
      gaps.set(key, (gaps.get(key) ?? 0) + 1);
    }
  }
  const sorted = (map: Map<string, number>, limit: number) => [...map].sort((a, b) => b[1] - a[1]).slice(0, limit);

  const ledger = rows(credits, "Read credits");
  const sum = (filter: (row: Row) => boolean) => ledger.filter(filter).reduce((total, row) => total + (Number(row.delta) || 0), 0);
  const inRange = (row: Row) => typeof row.created_at === "string" && row.created_at >= since;
  const aiRows = rows(aiEvents, "Read AI spend").filter((row) => (row.attributes as Row | null)?.kind === "ai_call");
  const aiCostMicro = aiRows.reduce((total, row) => total + (Number((row.attributes as Row).costMicroUsd) || 0), 0);
  const deepCalls = aiRows.filter((row) => (row.attributes as Row).purpose === "deep_question").length;

  const names = new Map<string, number>(ASSISTANT_NAMES.map((name) => [name, 0]));
  for (const row of rows(identityIds, "Read identities")) {
    const name = assignAssistantName(`identity:${String(row.id)}`);
    names.set(name, (names.get(name) ?? 0) + 1);
  }

  const days = new Map<string, number>();
  for (const row of rows(inbound, "Read inbound messages")) {
    // Calendar days in Harare (UTC+2).
    const day = new Date(Date.parse(String(row.created_at)) + 2 * 3_600_000).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const reviewRows = rows(reviewsInRange, "Read recent reviews");

  return {
    totals: {
      whatsappUsers: count(identities, "Count identities"), newWhatsappUsers: count(newIdentities, "Count new identities"),
      conversations: count(conversations, "Count conversations"), messages: count(messages, "Count messages"),
      businesses: count(businesses, "Count businesses"), connectReviews: count(reviewsAll, "Count reviews"), listings: count(listingsAll, "Count listings"),
      cards: count(cards, "Count cards"),
    },
    toCheck: {
      reviews: count(reviewsPending, "Count pending reviews"), listings: count(listingsPending, "Count pending listings"),
      businesses: count(submissionsPending, "Count pending businesses"), scamReports: count(scamsOpen, "Count open scam reports"),
    },
    activity: {
      inboundMessages: rows(inbound, "Read inbound messages").length,
      messagesPerDay: [...days].sort((a, b) => a[0].localeCompare(b[0])).map(([day, total]) => ({ day, total })),
      reviews: reviewRows.length, verifiedVisitReviews: reviewRows.filter((row) => row.verified_visit === true).length,
      listings: rows(listingsInRange, "Read recent listings").length, businessesAdded: rows(submissionsInRange, "Read recent businesses").length,
      cardTaps: rows(taps, "Read card taps").length,
      searches: searchRows.length,
      journeys: sorted(journeys, 10).map(([journey, total]) => ({ label: LABEL[journey] ?? journey, total })),
      topSearches: sorted(categories, 8).map(([label, total]) => ({ label, total })),
      notFound: sorted(gaps, 10).map(([key, total]) => { const [category, city] = key.split("|"); return { category, city, total }; }),
    },
    credits: {
      welcomeGranted: sum((row) => row.reason === "welcome"),
      earned: sum((row) => ["review", "add_business", "listing", "scam_report"].includes(String(row.reason))),
      spentOnDeepQuestions: -sum((row) => row.reason === "deep_question"),
      refundsAndAdjustments: sum((row) => row.reason === "admin_adjustment"),
      unused: sum(() => true),
      spentInRange: -sum((row) => row.reason === "deep_question" && inRange(row)),
    },
    ai: {
      callsInRange: aiRows.length, deepQuestionsInRange: deepCalls,
      costUsdInRange: Math.round(aiCostMicro / 10_000) / 100,
      costPerDeepQuestionUsd: deepCalls ? Math.round(aiRows.filter((row) => (row.attributes as Row).purpose === "deep_question").reduce((total, row) => total + (Number((row.attributes as Row).costMicroUsd) || 0), 0) / deepCalls / 10_000) / 100 : null,
    },
    assistantNames: [...names].map(([name, users]) => ({ name, users })).sort((a, b) => b.users - a.users),
    benita: benitaSummary(benitaRaw),
  };
}

/** Benita's knowledge pile in the shape the overview draws: biggest first, with the latest collection runs. */
function benitaSummary(raw: Row | null) {
  if (!raw) return null;
  const pairs = (value: unknown) => Object.entries((value ?? {}) as Record<string, number>).map(([label, total]) => ({ label, total: Number(total) || 0 })).sort((a, b) => b.total - a.total);
  const jobs = Array.isArray(raw.last_jobs) ? raw.last_jobs as Row[] : [];
  return {
    recordsBySource: pairs(raw.records_by_source),
    recordsByCity: pairs(raw.records_by_city).slice(0, 10),
    webListings: Number(raw.web_listings) || 0,
    whatsappListings: Number(raw.whatsapp_listings) || 0,
    facts: Number(raw.facts) || 0,
    queue: pairs(raw.queue),
    lastJobs: jobs.map((job) => ({ source: String(job.source_key ?? ""), status: String(job.status ?? ""), accepted: Number(job.records_accepted) || 0, at: String(job.created_at ?? ""), error: typeof job.error_message === "string" ? job.error_message.slice(0, 120) : null })),
  };
}

export type QueueKind = "reviews" | "listings" | "businesses" | "scams";

/** Items waiting for a person to check them, newest first. Phone numbers are masked except listing contacts the poster chose to share. */
export async function readQueue(db: ConnectDbClient, kind: QueueKind) {
  if (kind === "reviews") {
    const found = rows(await db.from("trusthub_connect_reviews").select("id,directory_business_id,rating,review_text,verified_visit,card_code,status,created_at").in("status", ["pending", "published"]).order("created_at", { ascending: false }).limit(100), "Read reviews");
    const ids = [...new Set(found.map((row) => row.directory_business_id).filter(Boolean).map(String))];
    const names = ids.length ? new Map(rows(await db.from("businesses").select("id,name,city").in("id", ids).limit(200), "Read reviewed businesses").map((row) => [String(row.id), `${row.name}${row.city ? `, ${row.city}` : ""}`])) : new Map<string, string>();
    return found.map((row) => ({ id: String(row.id), title: names.get(String(row.directory_business_id)) ?? "Unknown business", detail: `${row.rating} of 5${row.review_text ? ` · "${String(row.review_text).slice(0, 200)}"` : ""}`, tags: [row.verified_visit ? "Verified visit" : "", row.card_code ? String(row.card_code) : ""].filter(Boolean), status: String(row.status), createdAt: String(row.created_at) }));
  }
  if (kind === "listings") {
    const found = rows(await db.from("trusthub_connect_listings").select("id,title,intent,category,price_text,city,area,status,created_at,source_channel").eq("status", "pending").order("created_at", { ascending: false }).limit(100), "Read listings");
    return found.map((row) => ({ id: String(row.id), title: String(row.title), detail: [row.price_text, [row.area, row.city].filter(Boolean).join(", ")].filter(Boolean).join(" · "), tags: [String(row.intent), String(row.category), String(row.source_channel ?? "")].filter(Boolean), status: String(row.status), createdAt: String(row.created_at) }));
  }
  if (kind === "businesses") {
    const found = rows(await db.from("trusthub_connect_businesses").select("id,name,category,city,area,phone,possible_duplicate_of,status,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(100), "Read submitted businesses");
    return found.map((row) => ({ id: String(row.id), title: String(row.name), detail: [row.category, [row.area, row.city].filter(Boolean).join(", "), row.phone].filter(Boolean).join(" · "), tags: row.possible_duplicate_of ? ["Possible duplicate"] : [], status: String(row.status), createdAt: String(row.created_at) }));
  }
  const found = rows(await db.from("connect_scam_reports").select("id,reported_phone,reason,status,created_at").eq("status", "open").order("created_at", { ascending: false }).limit(100), "Read scam reports");
  return found.map((row) => ({ id: String(row.id), title: String(row.reported_phone), detail: String(row.reason), tags: [], status: String(row.status), createdAt: String(row.created_at) }));
}

/**
 * Applies a moderation decision. Approving a submitted business also adds it
 * to TrustHub's directory (public.businesses, source "trusthub_connect"), so it
 * appears in searches; the (source, source_id) key stops it being added twice.
 */
export async function decide(db: ConnectDbClient, kind: QueueKind, id: string, approve: boolean): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Unknown item.");
  const now = new Date().toISOString();
  const update = async (table: string, values: Row) => {
    const result = await db.from(table).update(values).eq("id", id);
    if (result.error) throw new Error(`Update ${table} failed.`);
  };
  if (kind === "reviews") return update("trusthub_connect_reviews", { status: approve ? "published" : "rejected", updated_at: now });
  if (kind === "listings") return update("trusthub_connect_listings", { status: approve ? "approved" : "rejected", updated_at: now });
  if (kind === "scams") return update("connect_scam_reports", { status: approve ? "confirmed" : "dismissed" });
  if (!approve) return update("trusthub_connect_businesses", { status: "rejected", updated_at: now });
  const submission = rows(await db.from("trusthub_connect_businesses").select("name,category,city,area,phone,country").eq("id", id).limit(1), "Read submission")[0];
  if (!submission) throw new Error("Unknown item.");
  const added = await db.from("businesses").insert({ name: submission.name, category: submission.category, city: submission.city, area: submission.area, phone: submission.phone, country: submission.country ?? "Zimbabwe", source: "trusthub_connect", source_id: id });
  if (added.error && added.error.code !== "23505") throw new Error("Add to directory failed.");
  await update("trusthub_connect_businesses", { status: "approved", updated_at: now, verification_notes: "Approved by a TrustHub admin and added to the directory." });
}

/** Business search for the card manager's picker. */
export async function searchBusinessesForAdmin(db: ConnectDbClient, query: string) {
  const term = query.trim().replace(/[\\%_]/g, "\\$&").slice(0, 80);
  if (term.length < 2) return [];
  return rows(await db.from("businesses").select("id,name,category,area,city").ilike("name", `%${term}%`).order("reviews_count", { ascending: false, nullsFirst: false }).limit(10), "Search businesses")
    .map((row) => ({ id: String(row.id), name: String(row.name), place: [row.category, [row.area, row.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") }));
}
