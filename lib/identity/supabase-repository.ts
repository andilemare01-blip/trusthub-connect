import type { IdentityResolutionResult, TrustHubProfile, WhatsAppIdentity } from "@/types/identity";
import type { IdentityResolver } from "./resolver";
import { requireDatabaseBigintId } from "../conversation-coordinator/persistence-mapping.ts";
import { requireData, SupabasePersistenceError, type SupabaseDataClient, type SupabaseRow } from "../supabase/data-client.ts";
import { describeSupabaseFailure, supabaseFailureCode } from "../supabase/retry.ts";
import { normalizePhoneNumber } from "./phone-number.ts";

function mapProfile(row: SupabaseRow): TrustHubProfile {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: typeof row.name === "string" ? row.name : null,
    location: typeof row.location === "string" ? row.location : null,
    trustLevel: typeof row.trust_level === "string" ? row.trust_level : null,
    trustPoints: typeof row.trust_points === "number" ? row.trust_points : null,
    createdAt: typeof row.joined_at === "string" ? row.joined_at : null,
  };
}
function mapIdentity(row: SupabaseRow): WhatsAppIdentity {
  return {
    id: String(row.id),
    phoneNumber: String(row.phone_number),
    trustHubProfileId: row.profile_id == null ? null : String(row.profile_id),
    linkedAt: typeof row.linked_at === "string" ? row.linked_at : null,
    createdAt: String(row.created_at),
  };
}
function validatePhone(phoneNumber: string): string {
  return normalizePhoneNumber(phoneNumber);
}

/** Postgres names the violated constraint, which is the only reliable way to classify a 23505 here. */
function uniqueConstraint(error: { message?: string; details?: string } | null | undefined): string | null {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return /unique constraint "([a-z0-9_]+)"/i.exec(text)?.[1] ?? null;
}

/** Looks up established mappings and can link a phone to an already existing canonical TrustHub profile. */
export class SupabaseIdentityResolver implements IdentityResolver {
  private readonly client: SupabaseDataClient;

  constructor(client: SupabaseDataClient) { this.client = client; }

  async resolveByPhoneNumber(phoneNumber: string): Promise<IdentityResolutionResult> {
    const phone = validatePhone(phoneNumber);
    const { data, error } = await this.client.from("whatsapp_identities").select("id,phone_number,profile_id,linked_at,created_at")
      .eq("phone_number", phone).maybeSingle();
    if (error) throw new SupabasePersistenceError("Resolve WhatsApp identity: " + error.message, error.code);
    if (!data || Array.isArray(data)) return { status: "unresolved", profile: null, whatsAppIdentity: null };
    const identity = mapIdentity(data as SupabaseRow);
    if (!identity.trustHubProfileId) return { status: "unresolved", profile: null, whatsAppIdentity: identity };
    const { data: profileData, error: profileError } = await this.client.from("profiles")
      .select("id,user_id,name,location,trust_level,trust_points,joined_at").eq("id", identity.trustHubProfileId).maybeSingle();
    if (profileError) throw new SupabasePersistenceError("Load TrustHub profile: " + profileError.message, profileError.code);
    if (!profileData || Array.isArray(profileData)) return { status: "unresolved", profile: null, whatsAppIdentity: identity };
    return { status: "linked_existing_profile", profile: mapProfile(profileData as SupabaseRow), whatsAppIdentity: identity };
  }

  /**
   * Gives a sender with no stored identity a phone-only row (no profile, nothing verified) so their
   * conversations have a stable key. Basic searching never requires a TrustHub profile.
   */
  async ensureWhatsAppIdentity(phoneNumber: string): Promise<WhatsAppIdentity> {
    const phone = validatePhone(phoneNumber);
    const existing = await this.resolveByPhoneNumber(phone);
    if (existing.whatsAppIdentity) return existing.whatsAppIdentity;
    const { data, error } = await this.client.from("whatsapp_identities").insert({ phone_number: phone })
      .select("id,phone_number,profile_id,linked_at,created_at").single();
    if (error?.code === "23505") {
      const raced = await this.resolveByPhoneNumber(phone);
      if (raced.whatsAppIdentity) return raced.whatsAppIdentity;
    }
    return mapIdentity(requireData<SupabaseRow>({ data: data as SupabaseRow | null, error }, "Create phone-only WhatsApp identity"));
  }

async linkPhoneToExistingProfile(phoneNumber: string, profileId: string): Promise<WhatsAppIdentity> {
    const phone = validatePhone(phoneNumber);
    requireDatabaseBigintId(profileId, "profiles.id");
    const existing = await this.resolveByPhoneNumber(phone);
    if (existing.whatsAppIdentity?.trustHubProfileId === profileId) return existing.whatsAppIdentity;
    if (existing.whatsAppIdentity && !existing.whatsAppIdentity.trustHubProfileId) {
      // A guest's phone-only row is completed in place, so its conversation history stays attached.
      const { data, error } = await this.client.from("whatsapp_identities")
        .update({ profile_id: profileId, linked_at: new Date().toISOString() }).eq("id", existing.whatsAppIdentity.id)
        .select("id,phone_number,profile_id,linked_at,created_at").single();
      if (error?.code === "23505") throw new SupabasePersistenceError("That TrustHub profile is already linked to a different WhatsApp number.", "profile_identity_conflict");
      return mapIdentity(requireData<SupabaseRow>({ data: data as SupabaseRow | null, error }, "Link WhatsApp phone to profile"));
    }
    if (existing.whatsAppIdentity) throw new Error("This phone number is already linked to a different or unresolved identity.");
    const { data, error } = await this.client.from("whatsapp_identities")
      .insert({ phone_number: phone, profile_id: profileId, linked_at: new Date().toISOString() })
      .select("id,phone_number,profile_id,linked_at,created_at").single();
    // Two unique constraints guard this table and they mean different things.
    // Reporting one as the other would send the operator after the wrong row,
    // so the violated constraint decides the message.
    if (error?.code === "23505") {
      const constraint = uniqueConstraint(error);
      if (constraint === "whatsapp_identities_profile_id_key") {
        throw new SupabasePersistenceError("That TrustHub profile is already linked to a different WhatsApp number.", "profile_identity_conflict");
      }
      if (constraint === "whatsapp_identities_phone_number_key") {
        const raced = await this.resolveByPhoneNumber(phone);
        if (raced.whatsAppIdentity?.trustHubProfileId === profileId) return raced.whatsAppIdentity;
        if (raced.whatsAppIdentity) throw new Error("This phone number is already linked to a different or unresolved identity.");
        throw new SupabasePersistenceError("That phone number is already linked to a different WhatsApp identity row.", "phone_identity_conflict");
      }
      throw new SupabasePersistenceError(describeSupabaseFailure("Link WhatsApp phone to profile", error), supabaseFailureCode(error));
    }
    const row = requireData<SupabaseRow>({ data: data as SupabaseRow | null, error }, "Link WhatsApp phone to profile");
    return mapIdentity(row);
  }
}
