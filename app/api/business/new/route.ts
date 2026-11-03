import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, serverDb, signedInUser } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function who(request: NextRequest) {
  const db = serverDb(); const userId = await signedInUser(request);
  return db && userId ? { db, userId } : null;
}

/** The signed-in person's own requests to add a business. */
export async function GET(request: NextRequest) {
  const me = await who(request);
  if (!me) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: noStore });
  try { return NextResponse.json({ requests: await call(me.db, "biz_new_mine", { p_user: me.userId }) }, { headers: noStore }); } catch (error) { return failure(error); }
}

/** Any signed-in person can ask to add a business. It stays private until the CEO confirms it by phone. */
export async function POST(request: NextRequest) {
  const me = await who(request);
  if (!me) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  try {
    return NextResponse.json(await call(me.db, "biz_new_submit", { p_user: me.userId, p_name: text(body?.name, 120), p_category: text(body?.category, 80), p_city: text(body?.city, 80), p_area: text(body?.area, 80), p_address: text(body?.address, 200), p_phone: text(body?.phone, 30), p_applicant: text(body?.applicant, 120), p_role: text(body?.role, 60), p_agent_code: text(body?.agent, 20) }), { headers: noStore });
  } catch (error) { return failure(error); }
}
