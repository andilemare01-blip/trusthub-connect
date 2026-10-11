/**
 * Provenance/verification types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Generalizes the evidence/provenance
 * pattern already proven by TrustHub's existing `business_information_updates`
 * table (source + evidence_notes + status) so it can attach to any kind of
 * knowledge (a contribution, a service request outcome, a knowledge claim),
 * not just a business-field correction.
 */

/**
 * How confident TrustHub can be in a piece of knowledge. AI may help
 * classify these states but must never itself decide something is
 * VERIFIED — verification requires evidence/review.
 */
export type VerificationStatus =
  | "verified"
  | "observed"
  | "declared"
  | "inferred"
  | "potential"
  | "unknown";

export interface Provenance {
  /** Who supplied this piece of knowledge. */
  suppliedByProfileId: string;
  /** How it was supplied (e.g. "whatsapp", "web", "admin"). */
  source: string;
  /** Relationship of the supplier to the subject, if relevant (e.g. "customer", "self", "referral"). */
  relationship: string | null;
  suppliedAt: string;
}

export interface Evidence {
  id: string;
  description: string;
  /** Free-form supporting notes — mirrors the existing `evidence_notes` pattern. */
  notes: string | null;
  provenance: Provenance;
  createdAt: string;
}
