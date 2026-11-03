import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/** Opens (or reopens) the owner's chat with their agent and the Marketing Executive. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { business?: unknown; source?: unknown; package?: unknown } | null;
  const owner = await requireOwner(request, body?.business);
  if (owner instanceof NextResponse) return owner;
  try {
    const deal = await call<{ token: string }>(owner.db, "deal_open_for_owner", { p_business: owner.businessId, p_package: typeof body?.package === "string" && body.package.trim() ? body.package.trim().slice(0, 60) : "website", p_source: typeof body?.source === "string" ? body.source.slice(0, 30) : "dashboard" });
    return NextResponse.json({ url: `/deal/${deal.token}` }, { headers: noStore });
  } catch (error) { return failure(error); }
}
