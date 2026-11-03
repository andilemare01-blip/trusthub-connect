import { NextResponse, type NextRequest } from "next/server";
import { noStore, requireAdmin } from "@/lib/admin/connect-admin";
import { call, failure, UUID } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : null);
const uuids = (value: unknown) => (Array.isArray(value) ? value.map(uuid).filter((id): id is string => !!id) : []);
const money = (value: unknown) => { const number = Number(value); return value !== null && value !== "" && Number.isFinite(number) && number > 0 ? number : null; };
const agentId = (value: unknown) => { const number = Number(value); return value !== null && value !== "" && Number.isSafeInteger(number) && number > 0 ? number : null; };
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const when = (value: string | null) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

/** The CEO's desk. Every call here passes the admin check first; agents and owners never reach this route. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const query = request.nextUrl.searchParams;
  try {
    if (query.get("view") === "revenue") {
      const data = await call(admin.db, "ceo_revenue", { p_from: when(query.get("from")), p_to: when(query.get("to")), p_agent: agentId(query.get("agent")), p_product: query.get("product") || null, p_city: query.get("city") || null });
      return NextResponse.json(data, { headers: noStore });
    }
    if (query.get("view") === "room") return NextResponse.json(await call(admin.db, "deal_read", { p_role: "ceo", p_key: "", p_deal: uuid(query.get("deal")) }), { headers: noStore });
    return NextResponse.json(await call(admin.db, "ceo_desk"), { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  const actor = admin.userId;
  try {
    switch (body.action) {
      case "claims-approve": { const ids = body.ids === "all" ? null : uuids(body.ids); return NextResponse.json(await call(admin.db, "ceo_claims_approve", { p_ids: ids, p_actor: actor }), { headers: noStore }); }
      case "claim-reject": await call(admin.db, "ceo_claim_reject", { p_id: uuid(body.id), p_actor: actor }); break;
      case "payment": return NextResponse.json(await call(admin.db, "ceo_payment_decide", { p_id: uuid(body.id), p_decision: text(body.decision, 10), p_amount: money(body.amount), p_actor: actor }), { headers: noStore });
      case "payment-record": return NextResponse.json(await call(admin.db, "ceo_payment_record", { p_business: uuid(body.businessId), p_business_name: text(body.business, 120), p_deal: uuid(body.deal), p_agent: agentId(body.agent), p_product: text(body.product, 20) || "website", p_amount: money(body.amount), p_method: text(body.method, 40), p_ref: text(body.ref, 120), p_note: text(body.note, 300), p_actor: actor }), { headers: noStore });
      case "commissions-pay": return NextResponse.json(await call(admin.db, "ceo_commissions_pay", { p_ids: uuids(body.ids), p_ref: text(body.ref, 120) }), { headers: noStore });
      case "deal": await call(admin.db, "ceo_deal_update", { p_deal: uuid(body.id), p_stage: ["new", "talking", "quoted", "won", "lost"].includes(String(body.stage)) ? body.stage : null, p_quoted: money(body.quoted), p_agent: agentId(body.agent) }); break;
      case "deal-post": await call(admin.db, "deal_post", { p_role: "ceo", p_key: "", p_deal: uuid(body.deal), p_body: text(body.body, 2000) }); break;
      case "card-agent": await call(admin.db, "ceo_card_agent", { p_card: uuid(body.card), p_agent: agentId(body.agent) }); break;
      case "setting": await call(admin.db, "ceo_setting_set", { p_key: text(body.key, 40), p_value: text(body.value, 40) }); break;
      default: return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: noStore });
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) { return failure(error); }
}
