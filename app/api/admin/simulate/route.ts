import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { SupabaseIdentityResolver } from "@/lib/identity/supabase-repository";
import { createConversationUnderstandingProvider } from "@/lib/ai/understanding";
import { handlePersistentTrustHubTurn } from "@/lib/conversation-coordinator/server-entry";
import { tryNormalizePhoneNumber } from "@/lib/identity/phone-number";
import { requireAdmin, noStore } from "@/lib/admin/connect-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Test numbers live in a range no real Zimbabwean phone uses, so test chats never touch a real person. */
const TEST_NUMBER = /^\+2637000\d{5}$/;

/** The test key is kept in benita_settings (service role only), so it can be rotated without a deploy. */
async function testKeyMatches(request: NextRequest): Promise<boolean> {
  const given = request.headers.get("x-trusthub-test-key");
  if (!given || given.length < 24) return false;
  const client = createSupabaseServerClient();
  const found = await client.from("benita_settings").select("value").eq("key", "simulator_key").limit(1);
  const value = Array.isArray(found.data) ? (found.data[0] as { value?: unknown } | undefined)?.value : undefined;
  return typeof value === "string" && value.length === given.length && value === given;
}

/**
 * "Try Wisdom": runs one message through exactly the same pipeline as a real WhatsApp message
 * (understanding, guest identity, coordinator, Benita) and returns the reply instead of sending it.
 * Only for administrators or the test key, and only for test numbers (+263 7000 xxxxx).
 */
export async function POST(request: NextRequest) {
  const viaKey = await testKeyMatches(request).catch(() => false);
  if (!viaKey) {
    const admin = await requireAdmin(request);
    if (admin instanceof NextResponse) return admin;
  }
  let body: { phoneNumber?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: noStore }); }
  const phone = typeof body.phoneNumber === "string" ? tryNormalizePhoneNumber(body.phoneNumber) : null;
  if (!phone || !TEST_NUMBER.test(phone)) return NextResponse.json({ error: "Use a test number from +263 7000 00000 to +263 7000 99999." }, { status: 400, headers: noStore });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) return NextResponse.json({ error: "Enter a message." }, { status: 400, headers: noStore });

  try {
    const client = createSupabaseServerClient();
    const correlationId = randomUUID();
    const providerMessageId = `sim-${correlationId}`;
    const understanding = await createConversationUnderstandingProvider(client).understand(text, { idempotencyKey: providerMessageId });
    const resolver = new SupabaseIdentityResolver(client);
    let identity = await resolver.resolveByPhoneNumber(phone);
    if (!identity.whatsAppIdentity) identity = { ...identity, whatsAppIdentity: await resolver.ensureWhatsAppIdentity(phone) };
    const started = Date.now();
    const result = await handlePersistentTrustHubTurn({
      text, request: understanding.request ?? undefined, providerMessageId, media: [], contributionCandidate: understanding.contribution, understanding,
      correlationId, identityId: identity.whatsAppIdentity?.id ?? null, senderPhoneNumber: phone, profileName: identity.profile?.name ?? null,
    }, { channel: "whatsapp", whatsappIdentityId: identity.whatsAppIdentity?.id ?? null, profileId: identity.profile?.id ?? null, communityId: null, area: null });
    return NextResponse.json({
      reply: result.reply,
      buttons: result.interactive?.type === "button" ? result.interactive.buttons?.map((button) => button.title) ?? [] : [],
      list: result.interactive?.type === "list" ? result.interactive.sections?.flatMap((section) => section.rows.map((row) => row.title)) ?? [] : [],
      state: result.state, action: result.action, ms: Date.now() - started,
      understanding: { source: understanding.source, aiProviderStatus: understanding.aiProviderStatus, category: understanding.request?.category ?? null, city: understanding.request?.location?.city ?? null },
    }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }, { status: 500, headers: noStore });
  }
}
