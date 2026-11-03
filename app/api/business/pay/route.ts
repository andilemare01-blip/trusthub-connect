import { NextResponse, type NextRequest } from "next/server";
import { call, failure, noStore, requireOwner } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { isOwnerProduct } from "@/lib/business/catalog";

/** An owner reports a payment. The price comes from the server, and nothing activates until the CEO confirms it. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { business?: unknown; product?: unknown; method?: unknown; ref?: unknown } | null;
  const owner = await requireOwner(request, body?.business);
  if (owner instanceof NextResponse) return owner;
  if (!isOwnerProduct(body?.product)) return NextResponse.json({ error: "Choose a product first." }, { status: 400, headers: noStore });
  try {
    await call(owner.db, "biz_payment_submit", { p_business: owner.businessId, p_product: body.product, p_method: typeof body.method === "string" ? body.method : "", p_ref: typeof body.ref === "string" ? body.ref : "" });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) { return failure(error); }
}
