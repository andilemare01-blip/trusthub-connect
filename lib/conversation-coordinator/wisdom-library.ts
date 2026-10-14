import { readFileSync } from "node:fs";
import path from "node:path";

/** The single canonical identity for the Wisdom engine. */
export const ASSISTANT_NAMES = ["Wisdom"] as const;
export const DEFAULT_ASSISTANT_NAME = "Wisdom";
/** The source library's own self-reference. */
const LIBRARY_SELF_NAME = "Wisdom";

export interface WisdomLibraryEntry {
  id: string;
  category: string;
  user: string;
  response: string;
  nextMove: string;
}

const LIBRARY_PATH = path.join("docs", "TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md");

/** Always returns the canonical Wisdom name. */
export function assignAssistantName(_conversationId: string): string {
  return DEFAULT_ASSISTANT_NAME;
}

export function isAssistantName(value: unknown): value is string {
  return typeof value === "string" && value === DEFAULT_ASSISTANT_NAME;
}

/** No rewriting needed since we always use the canonical name. */
export function applyAssistantName(text: string, _name: string): string {
  return text;
}

export function parseWisdomLibrary(markdown: string): WisdomLibraryEntry[] {
  const entries: WisdomLibraryEntry[] = [];
  let category = "";
  for (const section of markdown.split(/^(?=#{3,4} )/m)) {
    const categoryCode = /^### .*\(`([a-z_]+)`\)/m.exec(section)?.[1] ?? /^- \*\*CATEGORY \(PDF-SOURCED\):\*\* `[^`]+` \(`([a-z_]+)`\)/m.exec(section)?.[1];
    if (categoryCode) category = categoryCode;
    const id = /^#### (TH-WIS-\d{4})/.exec(section)?.[1];
    if (!id) continue;
    const user = /\*\*USER MESSAGE \(PDF-SOURCED\)\*\*\s+```text\n([\s\S]*?)\n```/.exec(section)?.[1];
    const response = /\*\*WISDOM RESPONSE \(PDF-SOURCED\)\*\*\s+```text\n([\s\S]*?)\n```/.exec(section)?.[1];
    const nextMove = /`NEXT MOVE`\):\*\* (.*)/.exec(section)?.[1] ?? "";
    if (user && response) entries.push({ id, category, user: user.trim(), response: response.trim(), nextMove: nextMove.trim() });
  }
  return entries;
}

export class WisdomLibrary {
  private readonly entries: WisdomLibraryEntry[];

  constructor(entries: WisdomLibraryEntry[]) { this.entries = entries; }

  static load(root: string = process.cwd()): WisdomLibrary {
    return new WisdomLibrary(parseWisdomLibrary(readFileSync(path.join(root, LIBRARY_PATH), "utf8")));
  }

  byCategory(category: string): WisdomLibraryEntry[] { return this.entries.filter((entry) => entry.category === category); }

  /** Picks one `new_hi` entry per conversation. */
  greeting(conversationId: string, _assistantName: string): { entryId: string; reply: string } | null {
    const candidates = this.byCategory("new_hi").filter((entry) => entry.response.includes(LIBRARY_SELF_NAME));
    if (!candidates.length) return null;
    const entry = candidates[0]; // Deterministic: always pick the first greeting
    const reply = [entry.response, entry.nextMove].filter(Boolean).join("\n\n");
    return { entryId: entry.id, reply };
  }
}

let cached: WisdomLibrary | null | undefined;
/** Null when the library file cannot be read; the coordinator then keeps its previous generic reply. */
export function loadWisdomLibrary(): WisdomLibrary | null {
  if (cached === undefined) {
    try { cached = WisdomLibrary.load(); } catch { cached = null; }
  }
  return cached;
}

const GREETING = /^(?:hi|hie|hey|hello|hullo|good (?:morning|afternoon|evening))\b/i;
export function isGreeting(text: string): boolean { return GREETING.test(text.trim()); }
