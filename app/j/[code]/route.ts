import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { connectWhatsappNumber, referralMessage } from "@/lib/connect/agents";

export const dynamic = "force-dynamic";

/**
 * An agent's link (/j/TINO42): counts the tap, then opens WhatsApp with "Hi (ref TINO42)" so the person who
 * joins is credited to that agent. A failed count never stops anyone from reaching WhatsApp.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const number = connectWhatsappNumber();
  try {
    const db = createSupabaseServerClient();
    const found = await db.from("connect_agents").select("id").eq("code", code).eq("active", true).limit(1);
    const agentId = Array.isArray(found.data) ? (found.data[0] as { id?: unknown } | undefined)?.id : undefined;
    const source = request.nextUrl.searchParams.get("s")?.slice(0, 30) ?? null;
    if (agentId) await db.from("connect_agent_clicks").insert({ agent_id: agentId, source });
  } catch { /* counting is best effort */ }
  if (!number) return NextResponse.json({ error: "TrustHub Connect's WhatsApp number is not set yet." }, { status: 503 });
  return NextResponse.redirect(`https://wa.me/${number}?text=${encodeURIComponent(referralMessage(code))}`, 302);
}
