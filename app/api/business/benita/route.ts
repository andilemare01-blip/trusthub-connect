import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readAiConfig } from "@/lib/ai/config";
import { AiGateway } from "@/lib/ai/gateway";
import { RuntimeEventAiSpendLedger } from "@/lib/ai/spend-ledger";
import { parseReport, replyPrompt, reportPrompt, type BenitaContext } from "@/lib/business/benita";
import { TOKEN_COST } from "@/lib/business/catalog";
import type { SupabaseDataClient } from "@/lib/supabase/data-client";
import { randomUUID } from "node:crypto";

export const maxDuration = 45;

const SORRY = "Benita is busy right now. Your tokens were returned, so please try again in a minute.";

/** Tokens are taken first and returned on any failure, so an owner never pays for an answer they didn't get. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { business?: unknown; action?: unknown; reviewId?: unknown } | null;
  const owner = await requireOwner(request, body?.business);
  if (owner instanceof NextResponse) return owner;
  const action = body?.action === "reply" ? "reply" : body?.action === "report" ? "report" : null;
  if (!action) return NextResponse.json({ error: "Unknown request." }, { status: 400, headers: noStore });
  const status = readAiConfig();
  if (!status.enabled) return NextResponse.json({ error: "Benita isn't switched on yet." }, { status: 503, headers: noStore });
  const cost = TOKEN_COST[action];
  const ai = new AiGateway({ enabled: true, config: { ...status.config, maxOutputTokens: 1500, timeoutMs: 20000 } }, new RuntimeEventAiSpendLedger(owner.db as unknown as SupabaseDataClient));
  let charged = false;
  try {
    const context = await call<BenitaContext>(owner.db, "biz_benita_context", { p_business: owner.businessId });
    let prompt = reportPrompt(context);
    if (action === "reply") {
      const found = await owner.db.from("reviews").select("rating,comment").eq("id", String(body?.reviewId)).eq("business_id_uuid", owner.businessId).limit(1);
      const review = (Array.isArray(found.data) ? found.data[0] : null) as { rating: number; comment: string | null } | null;
      if (!review) return NextResponse.json({ error: "That review was not found." }, { status: 404, headers: noStore });
      prompt = replyPrompt(context.name, review.rating, review.comment ?? "");
    }
    const left = await call<number>(owner.db, "biz_tokens_spend", { p_business: owner.businessId, p_cost: cost, p_reason: action });
    charged = true;
    const result = await ai.complete({ key: `biz:${action}:${randomUUID()}`, purpose: `business_${action}`, system: prompt.system, user: prompt.user, json: action === "report" });
    if (!result.ok) throw new Error(`ai ${result.reason}`);
    if (action === "reply") return NextResponse.json({ draft: result.text.trim().replace(/^"|"$/g, "").slice(0, 600), tokens: left }, { headers: noStore });
    const report = parseReport(result.text, context.reviews.length);
    if (!report) throw new Error("ai unreadable report");
    const saved = await owner.db.from("biz_insights").insert({ business_id: owner.businessId, source: "ai", summary: report, review_count: context.reviews.length, created_by: owner.userId });
    if (saved.error) throw new Error("report not saved");
    return NextResponse.json({ report, tokens: left }, { headers: noStore });
  } catch (error) {
    if (charged) {
      await call(owner.db, "biz_tokens_refund", { p_business: owner.businessId, p_cost: cost, p_reason: action }).catch(() => undefined);
      console.error("benita", error instanceof Error ? error.message : "unknown");
      return NextResponse.json({ error: SORRY }, { status: 502, headers: noStore });
    }
    return failure(error);
  }
}
