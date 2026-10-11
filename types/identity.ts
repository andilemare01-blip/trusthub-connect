/**
 * Conceptual, application-layer identity types for TrustHub Connect.
 *
 * These are NOT a confirmed database schema. They describe the shape the
 * app expects to work with, inferred from TRUSTHUB_CONNECT_RECON.md
 * (section C). Actual table/column definitions must be confirmed against
 * the real Supabase project before any migration is written.
 */

// Mirrors the existing TrustHub `profiles` row, as observed in recon section C.
export interface TrustHubProfile {
  /** `profiles.id` is bigint in the documented schema; keep it as a decimal string. */
  id: string;
  userId: string;
  name: string | null;
  location: string | null;
  trustLevel: string | null;
  trustPoints: number | null;
  createdAt: string | null;
}

/**
 * Links a WhatsApp phone number to a single TrustHub profile so the same
 * person is recognized on WhatsApp and on the web/app.
 *
 * Does not exist yet anywhere (recon section I). This type exists only so
 * the WhatsApp/identity interfaces below have something concrete to
 * reference — it must not be treated as an approved schema.
 */
export interface WhatsAppIdentity {
  id: string;
  /** E.164 formatted phone number. */
  phoneNumber: string;
  trustHubProfileId: string | null;
  /** Set once the WhatsApp user has been linked to a resolved profile. */
  linkedAt: string | null;
  createdAt: string;
}

export type IdentityResolutionStatus =
  | "unresolved"
  | "linked_existing_profile"
  | "linked_new_profile";

export interface IdentityResolutionResult {
  status: IdentityResolutionStatus;
  profile: TrustHubProfile | null;
  whatsAppIdentity: WhatsAppIdentity | null;
}

/** Alias matching the naming used in the foundation architecture — same shape as `WhatsAppIdentity`. */
export type WhatsAppIdentityLink = WhatsAppIdentity;

/** Input to provisioning a brand-new profile for a WhatsApp-first user who has no existing TrustHub account. */
export interface IdentityProvisionRequest {
  phoneNumber: string;
  displayName: string | null;
  communityKey: string | null;
}
