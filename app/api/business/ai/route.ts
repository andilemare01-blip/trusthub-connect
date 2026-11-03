import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only the owner can switch auto-reply on or off. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { business?: unknown; autoReply?: unknown } | null;
  const owner = await requireOwner(request, body?.business);
  if (owner instanceof NextResponse) return owner;
  if (typeof body?.autoReply !== "boolean") return NextResponse.json({ error: "Unknown request." }, { status: 400, headers: noStore });
  try { await call(owner.db, "biz_ai_set", { p_business: owner.businessId, p_auto: body.autoReply }); return NextResponse.json({ ok: true }, { headers: noStore }); } catch (error) { return failure(error); }
}
