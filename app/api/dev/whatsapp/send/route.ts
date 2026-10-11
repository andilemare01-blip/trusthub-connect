import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { SupabaseIdentityResolver } from "@/lib/identity/supabase-repository";
import { createConversationUnderstandingProvider } from "@/lib/ai/understanding";
import { handlePersistentTrustHubTurn } from "@/lib/conversation-coordinator/server-entry";
import { requireRows, type SupabaseDataClient, type SupabaseRow } from "@/lib/supabase/data-client";
import { tryNormalizePhoneNumber } from "@/lib/identity/phone-number";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT-ONLY WhatsApp transport simulator.
 *
 * It replaces ONLY the external Meta transport: there is no signature check
 * and no outbound send, because there is no real WhatsApp peer. Everything
 * below `handlePersistentTrustHubTurn` is the real production pipeline, and
 * the reply returned here is the coordinator's own output, not a canned
 * answer. MetaCloudWhatsAppProvider and /api/whatsapp/webhook are untouched.
 */
function simulatorEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reuses an existing canonical TrustHub profile instead of creating one, so
 * production identity provisioning is never exercised from this path.
 *
 * `whatsapp_identities.profile_id` is UNIQUE — a profile can hold only one
 * WhatsApp number — so this must pick the first profile that is not already
 * linked. Always returning the lowest id would make every new test number
 * collide with the previously linked one.
 */
async function resolveTestProfileId(client: SupabaseDataClient, requested: string | null): Promise<string> {
  if (requested) return requested;

  const linkedQuery = client.from("whatsapp_identities").select("profile_id").limit(1000);
  const linkedRows = requireRows<SupabaseRow>(await linkedQuery, "Load linked WhatsApp identities");
  const alreadyLinked = new Set(linkedRows.map((row) => (row.profile_id == null ? null : String(row.profile_id))));

  const profilesQuery = client.from("profiles").select("id").order("id", { ascending: true }).limit(500);
  const profiles = requireRows<SupabaseRow>(await profilesQuery, "Load TrustHub profiles for the simulator");
  const unused = profiles.map((row) => String(row.id)).find((id) => !alreadyLinked.has(id));
  if (!unused) throw new Error("Every TrustHub profile is already linked to a WhatsApp number, so the simulator cannot create another test identity. Provide an unused profile id.");
  return unused;
}

export async function POST(request: NextRequest) {
  if (!simulatorEnabled()) return NextResponse.json({ error: "The WhatsApp simulator is a development-only tool." }, { status: 404 });

  let body: { phoneNumber?: unknown; text?: unknown; reset?: unknown; profileId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const phone = typeof body.phoneNumber === "string" ? tryNormalizePhoneNumber(body.phoneNumber) : null;
  if (!phone) return NextResponse.json({ error: "Enter a test sender number in E.164 format, for example +263771234567." }, { status: 400 });

  let client: SupabaseDataClient;
  try { client = createSupabaseServerClient(); } catch (error) { return NextResponse.json({ error: message(error) }, { status: 503 }); }

  const resolver = new SupabaseIdentityResolver(client);

  try {
    const existing = await resolver.resolveByPhoneNumber(phone);

    if (body.reset === true) {
      const identityId = existing.whatsAppIdentity?.id;
      if (!identityId) return NextResponse.json({ ok: true, cleared: 0 });
      const closed = await client.from("conversations").update({ status: "abandoned" }).eq("whatsapp_identity_id", identityId).eq("status", "open");
      if (closed.error) return NextResponse.json({ error: message(closed.error) }, { status: 500 });
      return NextResponse.json({ ok: true, conversationId: null });
    }

    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Enter a message." }, { status: 400 });

    // Dev-pathway test identity only: reuse an existing canonical profile and
    // link the test number through the existing resolver method.
    let identity = existing;
    let testIdentity = false;
    if (identity.status !== "linked_existing_profile") {
      const profileId = await resolveTestProfileId(client, typeof body.profileId === "string" ? body.profileId : null);
      try {
        await resolver.linkPhoneToExistingProfile(phone, profileId);
        testIdentity = true;
      } catch (error) {
        // A bare catch here reported "already linked" for every failure mode.
        // The underlying cause is what actually matters to the tester.
        return NextResponse.json({ error: message(error), profileId, phoneNumber: phone }, { status: 409 });
      }
      identity = await resolver.resolveByPhoneNumber(phone);
    }
    if (identity.status !== "linked_existing_profile" || !identity.whatsAppIdentity || !identity.profile) {
      return NextResponse.json({ error: "Could not establish a test identity for that number." }, { status: 409 });
    }

    // Identical to the production webhook from here down.
    const understanding = await createConversationUnderstandingProvider().understand(text);
    const correlationId = randomUUID();
    const result = await handlePersistentTrustHubTurn({
      text,
      request: understanding.request ?? undefined,
      providerMessageId: `dev-${correlationId}`,
      media: [],
      contributionCandidate: understanding.contribution,
      understanding,
      correlationId,
    }, {
      channel: "whatsapp",
      whatsappIdentityId: identity.whatsAppIdentity.id,
      profileId: identity.profile.id,
      communityId: null,
      area: null,
    });

    return NextResponse.json({
      reply: result.reply,
      state: result.state,
      action: result.action,
      conversationId: result.conversationId,
      profileId: identity.profile.id,
      whatsappIdentityId: identity.whatsAppIdentity.id,
      testIdentity,
      communityConsentGranted: result.communityConsentGranted,
      outcomeConfirmed: result.outcomeConfirmed,
      contributionId: result.contributionId ?? null,
      helpRequestId: result.helpRequestId ?? null,
      understanding: {
        answerability: understanding.answerability,
        urgency: understanding.urgency,
        escalation: understanding.escalation,
        aiProviderStatus: understanding.aiProviderStatus,
        category: understanding.request?.category ?? null,
        city: understanding.request?.location?.city ?? null,
      },
      resolution: result.resolution ? {
        status: result.resolution.status,
        confidence: result.resolution.confidence,
        uncertainty: result.resolution.uncertainty,
        nextAction: result.resolution.nextAction,
        evidence: result.resolution.evidence.map((item) => ({
          source: item.source,
          sourceLabel: item.sourceLabel,
          verificationStatus: item.verificationStatus,
          confidence: item.confidence,
          claim: item.claim,
        })),
        sourceAttempts: result.resolution.sourceAttempts,
      } : null,
      transitions: result.conversation.transitions,
    });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}
