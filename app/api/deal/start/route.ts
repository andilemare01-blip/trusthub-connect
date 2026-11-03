import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, serverDb } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: someone on the Digital Package page asks to talk. The database function limits floods and repeats. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = serverDb();
  if (!db) return NextResponse.json({ error: "Please try again soon." }, { status: 503, headers: noStore });
  if (typeof body?.website === "string" && body.website) return NextResponse.json({ error: "Please try again." }, { status: 400, headers: noStore }); // bots fill the hidden field
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  try {
    const deal = await call<{ token: string }>(db, "deal_start", { p_contact: text(body?.name, 80), p_business: text(body?.business, 120), p_phone: text(body?.phone, 30), p_package: "website", p_agent_code: text(body?.agent, 20) });
    return NextResponse.json({ url: `/deal/${deal.token}` }, { headers: noStore });
  } catch (error) { return failure(error); }
}
