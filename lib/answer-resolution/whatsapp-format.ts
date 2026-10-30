import type { EvidenceItem } from "./types.ts";

const MAX_RESULTS = 8;

/** Plain-language status wording; it only restates the recorded status and never upgrades it. */
export function describeVerification(item: Pick<EvidenceItem, "verificationStatus">): string {
  switch (item.verificationStatus) {
    case "verified": return "verified by TrustHub";
    case "observed": return "listed in TrustHub records, not independently verified";
    case "declared": return "shared by the community, not verified yet";
    case "inferred": return "inferred from other information, unconfirmed";
    case "potential": return "possible listing from public sources, not checked";
    default: return "verification status unknown";
  }
}

function place(details: EvidenceItem["businessDetails"]): string | null {
  const parts = [details?.area, details?.city].filter((value): value is string => !!value?.trim());
  return parts.length ? parts.join(", ") : null;
}

function hours(openingHours: Record<string, unknown> | null | undefined): string | null {
  if (!openingHours) return null;
  const entries = Object.entries(openingHours).filter(([, value]) => typeof value === "string" && value.trim()).slice(0, 3);
  return entries.length ? entries.map(([day, value]) => `${day.charAt(0).toUpperCase()}${day.slice(1, 3).toLowerCase()} ${String(value)}`).join(", ") : null;
}

/** One WhatsApp-ready card. Only fields that exist are shown; nothing is invented. */
/** A Zimbabwean mobile number as a tappable WhatsApp link, or null for landlines and anything malformed. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  const local = digits.startsWith("+263") ? digits.slice(4) : digits.startsWith("263") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : null;
  return local && /^7[1378]\d{7}$/.test(local) ? `wa.me/263${local}` : null;
}

/** A phone number that is one real number, or null (some sources run several numbers together). */
function cleanPhone(phone: string | null | undefined): string | null {
  const value = (phone ?? "").trim();
  const digits = value.replace(/\D/g, "");
  return value && digits.length >= 7 && digits.length <= 13 ? value : null;
}

export function formatListing(item: EvidenceItem, position?: number): string {
  const details = item.businessDetails;
  const heading = `${position ? `${position}. ` : ""}*${(item.name ?? "").trim() || "Unnamed listing"}*`;
  const where = place(details);
  const subtitle = [item.category?.trim(), where].filter(Boolean).join(" · ");
  const phone = cleanPhone(details?.phone);
  const chat = whatsappLink(details?.whatsapp) ?? whatsappLink(phone);
  const contact = [phone && `Phone: ${phone}`, chat && `WhatsApp: ${chat}`].filter(Boolean).join(" · ");
  // An address that only repeats the suburb and town adds nothing.
  const address = details?.address?.trim();
  const addsSomething = !!address && !(where && where.toLocaleLowerCase().includes(address.toLocaleLowerCase())) && address.toLocaleLowerCase() !== (details?.city ?? "").toLocaleLowerCase();
  const status = describeVerification(item);
  const lines = [
    heading,
    subtitle,
    addsSomething && `Address: ${address}`,
    contact,
    details?.website && `Website: ${details.website}`,
    hours(details?.openingHours) && `Hours: ${hours(details?.openingHours)}`,
    `_${status.charAt(0).toUpperCase()}${status.slice(1)}_`,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

export function formatListings(items: EvidenceItem[]): string {
  const shown = items.slice(0, MAX_RESULTS);
  const cards = shown.map((item, index) => formatListing(item, shown.length > 1 ? index + 1 : undefined));
  const more = items.length > shown.length ? `\n\nThere are ${items.length - shown.length} more; tell me an area and I'll narrow it down.` : "";
  return `${cards.join("\n\n")}${more}`;
}

/** Evidence that is a listing of a business (as opposed to a single requested fact or a community declaration). */
export function isListing(item: EvidenceItem): boolean { return item.kind === "listing" && !!item.name; }
