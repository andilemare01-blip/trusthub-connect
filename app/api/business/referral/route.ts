import { NextResponse, type NextRequest } from "next/server";
import { failure, noStore, serverDb, signedInUser, UUID } from "@/lib/business/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remembers which agent's link a claim came through. Only the person who made the claim can set it. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { claimId?: unknown; code?: unknown } | null;
  const db = serverDb(); const userId = await signedInUser(request);
  if (!db || !userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: noStore });
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 20) : "";
  if (typeof body?.claimId !== "string" || !UUID.test(body.claimId) || !/^[A-Za-z0-9]{3,20}$/.test(code)) return NextResponse.json({ ok: false }, { headers: noStore });
  try {
    const result = await db.from("business_claims").update({ agent_code: code }).eq("id", body.claimId).eq("user_id", userId);
    if (result.error) throw new Error("claim update failed");
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) { return failure(error); }
}
