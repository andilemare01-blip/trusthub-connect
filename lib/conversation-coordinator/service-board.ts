/**
 * TrustHub Connect Service Board.
 *
 * Single source of truth for the approved ten-option menu: numbering, section
 * headings, descriptions, journey identifiers and the honest status of every
 * journey. Nothing here is rendered directly; the coordinator formats and
 * routes through it, so the same definition serves WhatsApp text, the dev
 * simulator and tests.
 *
 * A journey is a *status*, not a promise. `implemented` means a real handler
 * exists in the coordinator. `placeholder` means the option is shown but its
 * selection leads to an honest coming-soon or available-next-step reply; it
 * must never fabricate a result or claim a success that did not happen.
 */

export const SERVICE_BOARD_SECTION_DISCOVER = "DISCOVER";
export const SERVICE_BOARD_SECTION_OPPORTUNITY = "OPPORTUNITY";
export const SERVICE_BOARD_SECTION_COMMUNITY = "COMMUNITY INTELLIGENCE";

export type ServiceBoardJourneyStatus = "implemented" | "placeholder";

export interface ServiceBoardOption {
  readonly number: number;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  readonly journey: string;
  readonly status: ServiceBoardJourneyStatus;
  readonly placeholderReply: string;
}

export const SERVICE_BOARD_OPTIONS: readonly ServiceBoardOption[] = [
  {
    number: 1,
    section: SERVICE_BOARD_SECTION_DISCOVER,
    label: "🔎 Find a Business or Service",
    description: "Find barbers, plumbers, shops, restaurants and other services by location.",
    journey: "business_discovery",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 2,
    section: SERVICE_BOARD_SECTION_DISCOVER,
    label: "🏪 Add a Business",
    description: "Put a local business on the map so more people can discover it.",
    journey: "business_contribution",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 3,
    section: SERVICE_BOARD_SECTION_DISCOVER,
    label: "⭐ Write a Review",
    description: "Share your real experience to help other people make informed choices.",
    journey: "review_submission",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 4,
    section: SERVICE_BOARD_SECTION_DISCOVER,
    label: "🌟 Rate a Business",
    description: "Give a business a rating through the supported TrustHub process.",
    journey: "business_rating",
    status: "placeholder",
    placeholderReply: "Rating a business is not available yet. You can write a review instead (option 3), which is the supported way to share how a business did.",
  },
  {
    number: 5,
    section: SERVICE_BOARD_SECTION_OPPORTUNITY,
    label: "🛍️ Buy & Sell",
    description: "Get help with buying, selling or finding relevant opportunities.",
    journey: "buy_sell",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 6,
    section: SERVICE_BOARD_SECTION_OPPORTUNITY,
    label: "💼 Jobs & Recruitment",
    description: "Explore job opportunities or share a recruitment need.",
    journey: "jobs_recruitment",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 7,
    section: SERVICE_BOARD_SECTION_OPPORTUNITY,
    label: "🏠 Houses & Rentals",
    description: "Find or advertise accommodation using the information available.",
    journey: "housing_rentals",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 8,
    section: SERVICE_BOARD_SECTION_COMMUNITY,
    label: "🧠 Community Intelligence",
    description: "Discover local knowledge, surface missing information and help your community share useful, validated information.",
    journey: "community_intelligence",
    status: "implemented",
    placeholderReply: "",
  },
  {
    number: 9,
    section: SERVICE_BOARD_SECTION_COMMUNITY,
    label: "💡 Improve TrustHub",
    description: "Suggest improvements and tell us what would make your experience better.",
    journey: "product_feedback",
    status: "placeholder",
    placeholderReply: "Product feedback is not available yet, but your suggestion is welcome. Tell me what would make your experience better and I will record it for the team.",
  },
  {
    number: 10,
    section: SERVICE_BOARD_SECTION_COMMUNITY,
    label: "📈 Business Growth",
    description: "A space for business insights and growth support as these capabilities become available.",
    journey: "business_growth",
    status: "placeholder",
    placeholderReply: "Business Growth is planned, not available yet. You can add or improve a business listing now (option 2), which is the supported way to help your business get discovered.",
  },
] as const;

export const SERVICE_BOARD_CLOSING =
  "You don't have to choose a number. Just tell me what you need in your own words. You can also type MENU at any time to see these options again.";

export const SERVICE_BOARD_MENU_COMMAND = "MENU";
/**
 * Format the approved Service Board for WhatsApp text. The provider supports
 * only `text` messages, so the board is deliberately plain, numbered and
 * mobile-readable. It is built from SERVICE_BOARD_OPTIONS so numbering,
 * sections and descriptions cannot drift from the routing table.
 */
export function formatServiceBoard(): string {
  const sections = new Map<string, ServiceBoardOption[]>();
  for (const option of SERVICE_BOARD_OPTIONS) {
    const list = sections.get(option.section) ?? [];
    list.push(option);
    sections.set(option.section, list);
  }
  const blocks: string[] = [];
  let intro = "Here is the TrustHub Connect Service Board.";
  for (const [section, options] of sections) {
    blocks.push(`*0${section === SERVICE_BOARD_SECTION_DISCOVER ? "1" : section === SERVICE_BOARD_SECTION_OPPORTUNITY ? "2" : "3"} / ${section.toUpperCase()}*`);
    for (const option of options) {
      blocks.push(`${option.number}. ${option.label}`);
      if (option.description) blocks.push(option.description);
    }
  }
  return [intro, ...blocks, "", SERVICE_BOARD_CLOSING].join("\n");
}

/** True when the message is the MENU command, case-insensitive and trimmed. */
export function isMenuCommand(text: string): boolean {
  return text.trim().toUpperCase() === SERVICE_BOARD_MENU_COMMAND;
}

/**
 * Resolve a bare menu number ("1".."10") to its journey identifier.
 * Returns null for anything that is not an exact board selection, including
 * multi-digit numbers outside the board range, trailing punctuation and
 * spelled-out numbers. A bare "10" is a valid selection; "11" is not.
 */
export function resolveMenuNumber(text: string): ServiceBoardOption | null {
  const trimmed = text.trim();
  if (!/^(?:10|[1-9])$/.test(trimmed)) return null;
  const number = Number.parseInt(trimmed, 10);
  return SERVICE_BOARD_OPTIONS.find((option) => option.number === number) ?? null;
}

/** Journey identifier -> coordinator intent / questionType used to enter it. */
export interface MenuJourneyEntry {
  readonly journey: string;
  readonly status: ServiceBoardJourneyStatus;
  readonly placeholderReply: string;
  readonly starterText: string;
}

export const MENU_JOURNEY_MAP: Record<string, MenuJourneyEntry> = Object.fromEntries(
  SERVICE_BOARD_OPTIONS.map((option) => [
    option.journey,
    {
      journey: option.journey,
      status: option.status,
      placeholderReply: option.placeholderReply,
      starterText: option.label,
    },
  ]),
) as Record<string, MenuJourneyEntry>;

export function menuJourneyEntry(journey: string): MenuJourneyEntry | null {
  return MENU_JOURNEY_MAP[journey] ?? null;
}
