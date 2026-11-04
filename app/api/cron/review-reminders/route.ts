import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { call, serverDb } from "@/lib/business/server";
import { reminderMessage } from "@/lib/connect/journeys";
import { MetaCloudWhatsAppProvider } from "@/lib/whatsapp/meta-cloud-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Due = { id: string; card_code: string; business_name: string; phone_number: string };

function same(given: string | null, expected: unknown): boolean {
  if (!given || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(given); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Runs each minute when a "review later" reminder is due, called by the database's scheduler. */
export async function GET(request: NextRequest) {
  const db = serverDb();
  if (!db) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const found = await db.from("benita_settings").select("value").eq("key", "cron_secret").limit(1);
  const secret = Array.isArray(found.data) ? (found.data[0] as { value?: unknown } | undefined)?.value : undefined;
  if (!same(request.headers.get("x-benita-secret"), secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const provider = new MetaCloudWhatsAppProvider();
  const done = { sent: 0, failed: 0 };
  for (const item of await call<Due[]>(db, "connect_reminders_claim", { p_limit: 20 })) {
    try {
      const message = reminderMessage(item.card_code, item.business_name);
      await provider.sendMessage({ toPhoneNumber: item.phone_number, text: message.text, interactive: message.interactive });
      done.sent += 1;
    } catch (error) {
      console.error("review reminder", error instanceof Error ? error.message : "unknown");
      await db.from("connect_review_reminders").update({ status: "failed" }).eq("id", item.id);
      done.failed += 1;
    }
  }
  return NextResponse.json(done);
}
