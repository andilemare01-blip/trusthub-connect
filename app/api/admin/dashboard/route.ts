import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin/authorization";
import { createAdminServerClient } from "@/lib/admin/server-client";
import { loadDashboardInput } from "@/lib/admin/dashboard-data";
import { buildDashboard, METRIC_DEFINITIONS, parseRange, resolveRange } from "@/lib/admin/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Protected aggregation endpoint: a valid Supabase access token for an admin_users member is required on every request. */
export async function GET(request: NextRequest) {
  const client = createAdminServerClient();
  if (!client) return NextResponse.json({ error: "Dashboard data is unavailable." }, { status: 503, headers: noStore });
  const auth = await authorizeAdminRequest(request.headers.get("authorization"), client);
  if (!auth.ok) {
    const message = auth.reason === "not_admin" ? "This account is not an administrator." : auth.reason === "unavailable" ? "Authorization is temporarily unavailable." : "Sign-in required.";
    return NextResponse.json({ error: message }, { status: auth.status, headers: { ...noStore, ...(auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } });
  }
  try {
    const now = new Date();
    const key = parseRange(request.nextUrl.searchParams.get("range"));
    const range = resolveRange(key, now);
    const input = await loadDashboardInput(client, now, range.start.toISOString(), {
      missionsEnabled: process.env.COMMUNITY_MISSIONS_ENABLED === "true",
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      cronConfigured: true,
    });
    return NextResponse.json({ ...buildDashboard(input, key, now), definitions: METRIC_DEFINITIONS }, { headers: noStore });
  } catch (error) {
    console.error(JSON.stringify({ event: "admin.dashboard_failed", failure: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    return NextResponse.json({ error: "The dashboard could not be loaded." }, { status: 500, headers: noStore });
  }
}
