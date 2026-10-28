/**
 * TrustHub Connect main menu.
 *
 * One definition drives the WhatsApp interactive list, the numbered text
 * fallback (dev simulator, logs, clients that cannot render lists) and the
 * routing table. Rows are selected by a stable id ("menu.find"), never by the
 * visible wording, so renaming a row can never break routing.
 *
 * WhatsApp limits enforced here: at most 10 rows in a list, row title <= 24
 * characters, row description <= 72, section title <= 24, button label <= 20.
 */
import type { WhatsAppInteractiveMessage } from "../whatsapp/provider.ts";

export type MenuId =
  | "menu.find" | "menu.review" | "menu.add_business"
  | "menu.buy_sell" | "menu.jobs" | "menu.houses"
  | "menu.area" | "menu.scam"
  | "menu.ask" | "menu.profile";

export interface MenuRow {
  readonly number: number;
  readonly id: MenuId;
  readonly section: string;
  readonly title: string;
  readonly description: string;
}

export const MENU_ROWS: readonly MenuRow[] = [
  { number: 1, id: "menu.find", section: "Find & review", title: "Find a business", description: "Plumbers, salons, mechanics, food and more" },
  { number: 2, id: "menu.review", section: "Find & review", title: "Rate or review", description: "Tell others how a business treated you" },
  { number: 3, id: "menu.add_business", section: "Find & review", title: "Add a missing business", description: "Know a good one we don't have? Add it" },
  { number: 4, id: "menu.buy_sell", section: "Buy, sell & work", title: "Buy or sell", description: "Post an item or find what you need" },
  { number: 5, id: "menu.jobs", section: "Buy, sell & work", title: "Jobs", description: "Find work or hire someone" },
  { number: 6, id: "menu.houses", section: "Buy, sell & work", title: "Houses & rentals", description: "Rooms, cottages and houses by area" },
  { number: 7, id: "menu.area", section: "My area", title: "This week near me", description: "What's trending, in demand and new" },
  { number: 8, id: "menu.scam", section: "My area", title: "Scam check", description: "Check a number or seller before you pay" },
  { number: 9, id: "menu.ask", section: "Me", title: "Ask Wisdom", description: "Any question about your area or business" },
  { number: 10, id: "menu.profile", section: "Me", title: "My profile & credits", description: "Your reviews, listings and credits" },
] as const;

export const MENU_BUTTON_TEXT = "Choose an option";
export const MENU_FOOTER = "Or just type what you need";

export function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The menu as a WhatsApp interactive list, grouped by section in display order. */
export function menuInteractive(body: string): WhatsAppInteractiveMessage {
  const sections: { title: string; rows: { id: string; title: string; description: string }[] }[] = [];
  for (const row of MENU_ROWS) {
    let section = sections.find((candidate) => candidate.title === row.section);
    if (!section) { section = { title: clip(row.section, 24), rows: [] }; sections.push(section); }
    section.rows.push({ id: row.id, title: clip(row.title, 24), description: clip(row.description, 72) });
  }
  return { type: "list", body: clip(body, 1024), footer: MENU_FOOTER, buttonText: MENU_BUTTON_TEXT, sections };
}

/** The same menu as numbered plain text, with real line breaks. */
export function menuText(): string {
  const lines: string[] = [];
  let section = "";
  for (const row of MENU_ROWS) {
    if (row.section !== section) {
      if (lines.length) lines.push("");
      lines.push(`*${row.section}*`);
      section = row.section;
    }
    lines.push(`${row.number}. ${row.title}`);
  }
  lines.push("", "Reply with a number, or just type what you need.");
  return lines.join("\n");
}

export function isMenuCommand(text: string): boolean {
  return /^(?:menu|main menu|start|options|0)$/i.test(text.trim());
}

/** Resolves a tapped row id ("menu.find") or a bare number ("1".."10"); null for anything else. */
export function resolveMenuSelection(text: string): MenuRow | null {
  const trimmed = text.trim();
  const byId = MENU_ROWS.find((row) => row.id === trimmed);
  if (byId) return byId;
  if (!/^(?:10|[1-9])$/.test(trimmed)) return null;
  const number = Number.parseInt(trimmed, 10);
  return MENU_ROWS.find((row) => row.number === number) ?? null;
}
