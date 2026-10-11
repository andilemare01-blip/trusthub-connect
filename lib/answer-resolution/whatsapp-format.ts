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
export function formatListing(item: EvidenceItem, position?: number): string {
  const details = item.businessDetails;
  const heading = `${position ? `${position}. ` : ""}*${(item.name ?? "").trim() || "Unnamed listing"}*`;
  const subtitle = [item.category?.trim(), place(details)].filter(Boolean).join(" · ");
  const contact = [details?.phone && `Phone: ${details.phone}`, details?.whatsapp && `WhatsApp: ${details.whatsapp}`].filter(Boolean).join("  ");
  const lines = [
    heading,
    subtitle,
    details?.address && `Address: ${details.address}`,
    contact,
    details?.website && `Website: ${details.website}`,
    hours(details?.openingHours) && `Hours: ${hours(details?.openingHours)}`,
    `Source: ${item.sourceLabel}; ${describeVerification(item)}`,
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
