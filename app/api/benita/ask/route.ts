import { randomUUID } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { AiGateway } from "@/lib/ai/gateway";
import { readAiConfig } from "@/lib/ai/config";
import { RuntimeEventAiSpendLedger } from "@/lib/ai/spend-ledger";
import { askAdvisor, type AdvisorGateway } from "@/lib/benita/advisor";
import { noStore, serverDb, signedInUser } from "@/lib/business/server";
import { parsePlace } from "@/lib/connect/parse";
import { SupabaseConnectStore } from "@/lib/connect/supabase-store";
import type { SupabaseDataClient } from "@/lib/supabase/data-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FREE_QUESTIONS_A_DAY = 5;
const APP_ORIGIN = (process.env.TRUSTHUB_APP_URL ?? "https://trusthub-five.vercel.app").replace(/\/+$/, "");
const SORRY = "Benita is busy right now. Please try again in a minute.";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...noStore, "Access-Control-Allow-Origin": APP_ORIGIN, Vary: "Origin" },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

type Row = Record<string, unknown>;
const rowsOf = (result: { data: unknown }) => (Array.isArray(result.data) ? result.data as Row[] : []);

async function who(request: NextRequest) {
  const db = serverDb();
  if (!db) return null;
  const userId = await signedInUser(request);
  if (!userId) return null;
  const admin = rowsOf(await db.from("admin_users").select("user_id").eq("user_id", userId).limit(1));
  return { db, userId, isAdmin: admin.length > 0 };
}

export async function POST(request: NextRequest) {
  const person = await who(request);
  if (!person) return reply({ error: "Please log in to ask Benita." }, 401);
  const body = await request.json().catch(() => null) as { question?: unknown; city?: unknown; history?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 800) : "";
  if (question.length < 3) return reply({ error: "Type your question first." }, 400);
  const status = readAiConfig();
  if (!status.enabled) return reply({ error: "Benita isn't switched on yet." }, 503);
  const { db, userId, isAdmin } = person;

  if (!isAdmin) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const used = rowsOf(await db.from("benita_questions").select("id").eq("user_id", userId).gte("created_at", today.toISOString()).limit(FREE_QUESTIONS_A_DAY));
    if (used.length >= FREE_QUESTIONS_A_DAY) return reply({ error: `You've used your ${FREE_QUESTIONS_A_DAY} free questions today. Come back tomorrow.` }, 429);
  }

  const city = parsePlace(question).city ?? (typeof body?.city === "string" && body.city.trim() ? body.city.trim().slice(0, 60) : "Harare");
  const history = Array.isArray(body?.history)
    ? (body.history as { role?: unknown; body?: unknown }[]).filter((line) => typeof line?.body === "string").map((line) => ({ role: String(line.role), body: String(line.body) }))
    : [];
  const created = await db.from("benita_questions").insert({ user_id: userId, surface: isAdmin ? "admin" : "app", question, city }).select("id").single();
  const id = rowsOf({ data: created.data ? [created.data] : [] })[0]?.id;
  if (created.error || typeof id !== "string") return reply({ error: SORRY }, 500);

  // The answer keeps going after this response, so a dropped phone connection loses nothing.
  after(async () => {
    const finish = (answer: string | null) => db.from("benita_questions").update({ answer, status: answer ? "done" : "failed", answered_at: new Date().toISOString() }).eq("id", id);
    try {
      const gateway = new AiGateway(
        { enabled: true, config: { ...status.config, maxOutputTokens: 1200, timeoutMs: 25000 } },
        new RuntimeEventAiSpendLedger(db as unknown as SupabaseDataClient),
      );
      const store = new SupabaseConnectStore(db);
      await finish(await askAdvisor({ db, store, gateway: gateway as unknown as AdvisorGateway, question, city, history, key: randomUUID() }));
    } catch (error) {
      console.error("benita ask", error instanceof Error ? error.message : "unknown");
      await finish(null);
    }
  });

  return reply({ id });
}

export async function GET(request: NextRequest) {
  const person = await who(request);
  if (!person) return reply({ error: "Please log in to ask Benita." }, 401);
  const { db, userId, isAdmin } = person;
  const query = request.nextUrl.searchParams;
  if (query.get("recent")) {
    if (!isAdmin) return reply({ error: "Not allowed." }, 403);
    return reply({ recent: rowsOf(await db.from("benita_questions").select("question,city,surface,created_at").order("created_at", { ascending: false }).limit(30)) });
  }
  const id = query.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "Unknown question." }, 400);
  const row = rowsOf(await db.from("benita_questions").select("status,answer").eq("id", id).eq("user_id", userId).limit(1))[0];
  return row ? reply({ status: row.status, answer: row.answer }) : reply({ error: "Unknown question." }, 404);
}
