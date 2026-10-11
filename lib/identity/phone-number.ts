/**
 * Single canonical form for every WhatsApp sender number.
 *
 * Meta sends the national digits (`263771234567`); a person typing into the
 * simulator, a saved contact and the database all use different spellings of
 * the same subscriber. Identity resolution must map every accepted spelling to
 * one E.164 string, otherwise the same person can end up with two rows in
 * `whatsapp_identities` for one number.
 */

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("WhatsApp phone numbers must be E.164 formatted, for example +263771234567.");
    this.name = "InvalidPhoneNumberError";
  }
}

/** E.164: a `+`, a non-zero country digit, and 7 to 14 further digits. */
export function isE164PhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * Accepts the representations a real sender can produce and returns the one
 * stored string: `+263771234567`, `263771234567`, `00263771234567`,
 * `+263 77 123 4567` and `+263-77-123-4567` all normalize to `+263771234567`.
 * Anything else is rejected instead of being guessed at.
 */
export function normalizePhoneNumber(input: string): string {
  const trimmed = (input ?? "").trim();
  const digits = trimmed.replace(/[\s().\-‐-―]/g, "");
  if (!/^\+?\d+$/.test(digits)) throw new InvalidPhoneNumberError();
  const international = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : digits;
  const normalized = `+${international}`;
  if (!isE164PhoneNumber(normalized)) throw new InvalidPhoneNumberError();
  return normalized;
}

/** Normalizes without throwing. Used by transports that must skip, not fail, on an unusable sender. */
export function tryNormalizePhoneNumber(input: string): string | null {
  try { return normalizePhoneNumber(input); } catch { return null; }
}