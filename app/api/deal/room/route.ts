import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, serverDb } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = /^[0-9a-f]{48}$/;

/** The business side of a deal chat. The long private link is the key. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const db = serverDb();
  if (!db || !TOKEN.test(token)) return NextResponse.json({ error: "This chat was not found." }, { status: 404, headers: noStore });
  try { return NextResponse.json(await call(db, "deal_read", { p_role: "business", p_key: token, p_deal: null }), { headers: noStore }); } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: unknown; body?: unknown } | null;
  const db = serverDb();
  if (!db || typeof body?.token !== "string" || !TOKEN.test(body.token)) return NextResponse.json({ error: "This chat was not found." }, { status: 404, headers: noStore });
  try { await call(db, "deal_post", { p_role: "business", p_key: body.token, p_deal: null, p_body: typeof body.body === "string" ? body.body : "" }); return NextResponse.json({ ok: true }, { headers: noStore }); } catch (error) { return failure(error); }
}
