import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readAiConfig } from "@/lib/ai/config";
import { AiGateway } from "@/lib/ai/gateway";
import { RuntimeEventAiSpendLedger } from "@/lib/ai/spend-ledger";
import { askPrompt, marketPrompt, parsePost, parseReport, postPrompt, replyPrompt, reportPrompt, type BenitaContext } from "@/lib/business/benita";
import { TOKEN_COST } from "@/lib/business/catalog";
import { gatherAdvisorData, quickReply } from "@/lib/benita/advisor";
import { parsePlace } from "@/lib/connect/parse";
import { SupabaseConnectStore } from "@/lib/connect/supabase-store";
import type { SupabaseDataClient } from "@/lib/supabase/data-client";
import { randomUUID } from "node:crypto";

export const maxDuration = 45;

const SORRY = "Benita is busy right now. Your tokens were returned, so please try again in a minute.";

/** Tokens are taken first and returned on any failure, so an owner never pays for an answer they didn't get. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { business?: unknown; action?: unknown; reviewId?: unknown; text?: unknown } | null;
  const owner = await requireOwner(request, body?.business);
  if (owner instanceof NextResponse) return owner;
  const action = (["reply", "report", "ask", "post", "market"] as const).find((name) => name === body?.action);
  const input = typeof body?.text === "string" ? body.text.trim().slice(0, 800) : "";
  if (!action || ((action === "ask" || action === "post") && input.length < 2)) return NextResponse.json({ error: "Unknown request." }, { status: 400, headers: noStore });
  const status = readAiConfig();
  if (!status.enabled) return NextResponse.json({ error: "Benita isn't switched on yet." }, { status: 503, headers: noStore });
  // A greeting doesn't cost a credit or wait for the AI.
  if (action === "ask") {
    const quick = quickReply(input);
    if (quick) {
      await call(owner.db, "biz_ask_add", { p_business: owner.businessId, p_role: "owner", p_body: input });
      await call(owner.db, "biz_ask_add", { p_business: owner.businessId, p_role: "benita", p_body: quick });
      return NextResponse.json({ answer: quick, tokens: await call<number>(owner.db, "biz_tokens", { p_business: owner.businessId }) }, { headers: noStore });
    }
  }
  const cost = TOKEN_COST[action];
  const ai = new AiGateway({ enabled: true, config: { ...status.config, maxOutputTokens: 3000, timeoutMs: 20000 } }, new RuntimeEventAiSpendLedger(owner.db as unknown as SupabaseDataClient));
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
    if (action === "market") prompt = marketPrompt(context);
    if (action === "post") prompt = postPrompt(context, input);
    if (action === "ask") {
      const saved = await call<{ ask: { role: string; body: string }[] }>(owner.db, "biz_ai_get", { p_business: owner.businessId });
      // The same market knowledge the app and admin use, for this business's town.
      const store = new SupabaseConnectStore(owner.db);
      const market = await gatherAdvisorData(owner.db, store, input, parsePlace(input).city ?? context.city ?? null).catch(() => null);
      prompt = askPrompt(context, saved.ask, input, market);
    }
    const left = await call<number>(owner.db, "biz_tokens_spend", { p_business: owner.businessId, p_cost: cost, p_reason: action });
    charged = true;
    const result = await ai.complete({ key: `biz:${action}:${randomUUID()}`, purpose: `business_${action}`, system: prompt.system, user: prompt.user, json: action === "report" || action === "post" });
    if (!result.ok) throw new Error(`ai ${result.reason}`);
    if (action === "reply") return NextResponse.json({ draft: result.text.trim().replace(/^"|"$/g, "").slice(0, 600), tokens: left }, { headers: noStore });
    if (action === "market") return NextResponse.json({ answer: result.text.trim().slice(0, 1800), tokens: left }, { headers: noStore });
    if (action === "ask") {
      const answer = result.text.trim().slice(0, 1800);
      await call(owner.db, "biz_ask_add", { p_business: owner.businessId, p_role: "owner", p_body: input });
      await call(owner.db, "biz_ask_add", { p_business: owner.businessId, p_role: "benita", p_body: answer });
      return NextResponse.json({ answer, tokens: left }, { headers: noStore });
    }
    if (action === "post") {
      const post = parsePost(result.text);
      if (!post) throw new Error("ai unreadable post");
      return NextResponse.json({ post, tokens: left }, { headers: noStore });
    }
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
