import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminServerClient } from "@/lib/admin/server-client";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { createServerTrustHubClient } from "@/lib/trusthub/server-client";
import { MetaCloudWhatsAppProvider } from "@/lib/whatsapp/meta-cloud-provider";
import { policyFromEnvironment } from "@/lib/notifications/community-missions";
import { createMissionDeps } from "@/lib/notifications/mission-data";
import { runCommunityMissions } from "@/lib/notifications/mission-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null): "ok" | "unconfigured" | "denied" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "unconfigured";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected) ? "ok" : "denied";
}

/**
 * Scheduled by Vercel cron. It does nothing for callers without the cron secret. Real sending additionally requires
 * COMMUNITY_MISSIONS_ENABLED=true; otherwise the run is a dry run that only reports what it would do.
 */
export async function GET(request: NextRequest) {
  const gate = authorized(request.headers.get("authorization"));
  if (gate === "unconfigured") return NextResponse.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (gate === "denied") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const reader = createAdminServerClient();
  if (!reader) return NextResponse.json({ error: "Data store unavailable." }, { status: 503 });
  const provider = new MetaCloudWhatsAppProvider();
  const enabled = process.env.COMMUNITY_MISSIONS_ENABLED === "true" && request.nextUrl.searchParams.get("dryRun") !== "1" && provider.isSendConfigured();
  try {
    const summary = await runCommunityMissions(createMissionDeps({
      reader, writer: createSupabaseServerClient(), trust: createServerTrustHubClient(),
      policy: policyFromEnvironment(process.env), enabled,
      send: async (phone, text, correlationId) => { await provider.sendMessage({ toPhoneNumber: phone, text, correlationId }); },
    }));
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error(JSON.stringify({ event: "missions.run_failed", failure: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    return NextResponse.json({ error: "The mission run failed." }, { status: 500 });
  }
}
