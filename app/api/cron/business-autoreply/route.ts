import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readAiConfig } from "@/lib/ai/config";
import { AiGateway } from "@/lib/ai/gateway";
import { RuntimeEventAiSpendLedger } from "@/lib/ai/spend-ledger";
import { replyPrompt } from "@/lib/business/benita";
import { autoMode } from "@/lib/business/catalog";
import { call, serverDb } from "@/lib/business/server";
import type { SupabaseDataClient } from "@/lib/supabase/data-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Item = { business_id: string; business: string; review_id: string; rating: number; comment: string };

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`); const received = Buffer.from(header ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Once a day: Benita answers new reviews for owners who switched auto-reply on. A token is spent only for a reply she actually wrote. */
export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = serverDb(); const status = readAiConfig();
  if (!db || !status.enabled) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const ai = new AiGateway(status, new RuntimeEventAiSpendLedger(db as unknown as SupabaseDataClient));
  const started = Date.now(); const done = { posted: 0, drafted: 0, flagged: 0, failed: 0 };
  for (const item of await call<Item[]>(db, "biz_auto_queue", { p_limit: 20 })) {
    if (Date.now() - started > 45000) break;
    const mode = autoMode(item.rating, item.comment);
    try {
      if (mode === "flag") { await call(db, "biz_auto_save", { p_business: item.business_id, p_review: item.review_id, p_mode: "flag", p_body: "" }); done.flagged += 1; continue; }
      const prompt = replyPrompt(item.business, item.rating, item.comment);
      const result = await ai.complete({ key: `biz:auto:${item.review_id}`, purpose: "business_auto_reply", system: prompt.system, user: prompt.user });
      if (!result.ok) { done.failed += 1; continue; }
      await call(db, "biz_auto_save", { p_business: item.business_id, p_review: item.review_id, p_mode: mode, p_body: result.text.trim().replace(/^"|"$/g, "") });
      done[mode === "post" ? "posted" : "drafted"] += 1;
    } catch { done.failed += 1; }
  }
  return NextResponse.json(done);
}
