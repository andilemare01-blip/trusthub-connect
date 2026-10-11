/**
 * Deterministic recognition of "I'd like to create my TrustHub profile."
 *
 * This module recognises intent only. It never creates a profile, an
 * `auth.users` row, or a WhatsApp identity — the existing
 * `IdentityProvisioner` does that, and it is currently not connected, which
 * throws `IdentityProvisionerNotConnectedError` instead of silently doing
 * nothing. A profile is created only through that seam, never guessed from an
 * unlinked phone number.
 */

export interface ProfileCreationRequest {
  text: string;
  displayName: string | null;
}

const PROFILE_PHRASES = [
  /\bcreate(?:\s+my)?\s+(?:a\s+)?trusthub\s+profile\b/i,
  /\bmake(?:\s+my)?\s+(?:a\s+)?trusthub\s+profile\b/i,
  /\bset\s+up\s+(?:my\s+)?trusthub\s+profile\b/i,
  /\bi'?d\s+like\s+to\s+create\s+(?:my\s+)?trusthub\s+profile\b/i,
  /\bi\s+want\s+(?:a\s+)?trusthub\s+profile\b/i,
  /\bjoin\s+trusthub\b/i,
  /\bsign\s+up\s+(?:for\s+)?trusthub\b/i,
  /\bregister\s+(?:a\s+)?trusthub\s+(?:account|profile)\b/i,
  /\baccount\b.*\b(set up|create|make|register)\b/i,
];

/** True when the message is an explicit request to start the profile flow. */
export function isProfileCreationIntent(text: string): boolean {
  return PROFILE_PHRASES.some((pattern) => pattern.test(text.trim()));
}

/** The display name the user offered, if any. "I'm John, I'd like to create my TrustHub profile." */
export function parseProfileCreationRequest(text: string): ProfileCreationRequest | null {
  if (!isProfileCreationIntent(text)) return null;
  const trimmed = text.trim();
  const nameMatch = /\b(?:i'?m|i am|my name is|call me)\s+([\p{L}][\p{L}\s'.-]{1,40})\b/iu.exec(trimmed);
  return { text: trimmed, displayName: nameMatch ? nameMatch[1].trim().replace(/[.,!?]+$/g, "") : null };
}