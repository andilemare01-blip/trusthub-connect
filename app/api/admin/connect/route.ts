import { NextRequest, NextResponse } from "next/server";
import { connectMetrics, noStore, requireAdmin } from "@/lib/admin/connect-admin";
import { parseRange, resolveRange } from "@/lib/admin/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    const range = resolveRange(parseRange(request.nextUrl.searchParams.get("range")), new Date());
    return NextResponse.json({ range: { key: range.key, start: range.start.toISOString() }, ...(await connectMetrics(admin.db, range.start.toISOString())) }, { headers: noStore });
  } catch (error) {
    console.error(JSON.stringify({ event: "admin.connect_metrics_failed", failure: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    return NextResponse.json({ error: "The overview could not be loaded." }, { status: 500, headers: noStore });
  }
}
