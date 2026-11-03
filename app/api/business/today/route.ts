import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today's free feed for one business. */
export async function GET(request: NextRequest) {
  const owner = await requireOwner(request, request.nextUrl.searchParams.get("business"));
  if (owner instanceof NextResponse) return owner;
  try { return NextResponse.json(await call(owner.db, "biz_today", { p_business: owner.businessId }), { headers: noStore }); } catch (error) { return failure(error); }
}
