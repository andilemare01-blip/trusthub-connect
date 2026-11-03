import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, serverDb } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An agent opens a chat for a business they met, and gets the link to send them. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = serverDb();
  const agent = typeof body?.agent === "string" ? body.agent : "";
  if (!db || !/^[0-9a-f]{36}$/.test(agent)) return NextResponse.json({ error: "This agent link is not active." }, { status: 403, headers: noStore });
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  try {
    const deal = await call<{ token: string; id: string }>(db, "deal_start_by_agent", { p_agent_token: agent, p_contact: text(body?.name, 80), p_business: text(body?.business, 120), p_phone: text(body?.phone, 30) });
    return NextResponse.json({ customerLink: `${request.nextUrl.origin}/deal/${deal.token}`, room: `/agent/${agent}/deal/${deal.id}` }, { headers: noStore });
  } catch (error) { return failure(error); }
}
