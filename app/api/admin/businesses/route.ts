import { NextRequest, NextResponse } from "next/server";
import { noStore, requireAdmin, searchBusinessesForAdmin } from "@/lib/admin/connect-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ businesses: await searchBusinessesForAdmin(admin.db, request.nextUrl.searchParams.get("q") ?? "") }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "The search failed." }, { status: 500, headers: noStore });
  }
}
