import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, serverDb, UUID } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT = /^[0-9a-f]{36}$/;

/** The agent side of a deal chat. The database refuses any deal that isn't this agent's. */
export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent") ?? ""; const deal = request.nextUrl.searchParams.get("deal") ?? "";
  const db = serverDb();
  if (!db || !AGENT.test(agent) || !UUID.test(deal)) return NextResponse.json({ error: "This chat was not found." }, { status: 404, headers: noStore });
  try { return NextResponse.json(await call(db, "deal_read", { p_role: "agent", p_key: agent, p_deal: deal }), { headers: noStore }); } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { agent?: unknown; deal?: unknown; body?: unknown } | null;
  const db = serverDb();
  if (!db || typeof body?.agent !== "string" || !AGENT.test(body.agent) || typeof body.deal !== "string" || !UUID.test(body.deal)) return NextResponse.json({ error: "This chat was not found." }, { status: 404, headers: noStore });
  try { await call(db, "deal_post", { p_role: "agent", p_key: body.agent, p_deal: body.deal, p_body: typeof body.body === "string" ? body.body : "" }); return NextResponse.json({ ok: true }, { headers: noStore }); } catch (error) { return failure(error); }
}
