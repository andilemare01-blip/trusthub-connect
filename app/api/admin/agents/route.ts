import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, noStore } from "@/lib/admin/connect-admin";
import { makeAgentCode } from "@/lib/connect/agents";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/** Every agent with their numbers: taps on their link, people who joined, who is active, and what they did. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const rpc = admin.db.rpc;
  if (!rpc) return NextResponse.json({ error: "Agent stats are unavailable." }, { status: 503, headers: noStore });
  const result = await rpc.call(admin.db, "connect_agent_stats", { p_agent_id: null });
  if (result.error) return NextResponse.json({ error: "Agent stats could not be loaded." }, { status: 500, headers: noStore });
  const origin = request.nextUrl.origin;
  const agents = ((result.data ?? []) as Row[]).map((row) => ({
    id: Number(row.agent_id), code: String(row.code), name: String(row.name), phone: row.phone ? String(row.phone) : null, active: row.active === true,
    link: `${origin}/j/${row.code}`, dashboard: `${origin}/agent/${row.dashboard_token}`,
    clicks: Number(row.clicks ?? 0), clicksWeek: Number(row.clicks_week ?? 0), joined: Number(row.joined ?? 0), joinedWeek: Number(row.joined_week ?? 0),
    activeWeek: Number(row.active_week ?? 0), searches: Number(row.searches ?? 0), reviews: Number(row.reviews ?? 0), listings: Number(row.listings ?? 0),
  }));
  return NextResponse.json({ agents }, { headers: noStore });
}

/** Adds an agent and gives back their link and private dashboard. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  let body: { name?: unknown; phone?: unknown; active?: unknown; id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: noStore }); }
  if (typeof body.id === "number" && typeof body.active === "boolean") {
    const changed = await admin.db.from("connect_agents").update({ active: body.active }).eq("id", body.id);
    if (changed.error) return NextResponse.json({ error: "The agent could not be updated." }, { status: 500, headers: noStore });
    return NextResponse.json({ ok: true }, { headers: noStore });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (name.length < 2) return NextResponse.json({ error: "Enter the agent's name." }, { status: 400, headers: noStore });
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim().slice(0, 20) : null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeAgentCode(name);
    const created = await admin.db.from("connect_agents").insert({ code, name, phone }).select("id,code,dashboard_token");
    if (!created.error) {
      const row = (Array.isArray(created.data) ? created.data[0] : created.data) as Row;
      const origin = request.nextUrl.origin;
      return NextResponse.json({ code: row.code, link: `${origin}/j/${row.code}`, dashboard: `${origin}/agent/${row.dashboard_token}` }, { headers: noStore });
    }
    if (created.error.code !== "23505") return NextResponse.json({ error: "The agent could not be added." }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ error: "Could not make a unique code. Try again." }, { status: 500, headers: noStore });
}
