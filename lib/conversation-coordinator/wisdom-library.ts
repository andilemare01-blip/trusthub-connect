import { readFileSync } from "node:fs";
import path from "node:path";

/** Display identities for the one Wisdom engine; they change only the name, never behaviour. */
export const ASSISTANT_NAMES = ["Wisdom", "Tanaka", "Matthew", "Lizzie", "Daniel", "Sarah", "James", "Emily", "Michael", "Grace"] as const;
export const DEFAULT_ASSISTANT_NAME = "Wisdom";
/** The source library's own self-reference; it is the only token rewritten for other identities. */
const LIBRARY_SELF_NAME = "Wisdom";

export interface WisdomLibraryEntry {
  id: string;
  category: string;
  user: string;
  response: string;
  nextMove: string;
}

const LIBRARY_PATH = path.join("docs", "TRUSTHUB_WISDOM_CONVERSATION_LIBRARY.md");

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619) >>> 0;
  return result;
}

/** Deterministic so a given conversation can never be re-assigned a different name. */
export function assignAssistantName(conversationId: string): string {
  return ASSISTANT_NAMES[hash(`assistant-name:${conversationId}`) % ASSISTANT_NAMES.length];
}

export function isAssistantName(value: unknown): value is string {
  return typeof value === "string" && (ASSISTANT_NAMES as readonly string[]).includes(value);
}

/** Rewrites the library's hardcoded self-reference to the conversation's assigned name. */
export function applyAssistantName(text: string, name: string): string {
  return name === LIBRARY_SELF_NAME ? text : text.replace(/\bWisdom\b/g, name);
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

  /** Picks one `new_hi` entry per conversation and applies the assigned name to it. */
  greeting(conversationId: string, assistantName: string): { entryId: string; reply: string } | null {
    const candidates = this.byCategory("new_hi").filter((entry) => entry.response.includes(LIBRARY_SELF_NAME));
    if (!candidates.length) return null;
    const entry = candidates[hash(`greeting:${conversationId}`) % candidates.length];
    const reply = [entry.response, entry.nextMove].filter(Boolean).join("\n\n");
    return { entryId: entry.id, reply: applyAssistantName(reply, assistantName) };
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

const NAME_PATTERN = ASSISTANT_NAMES.join("|");
const GREETING = new RegExp(`^(?:hi|hie|hey|hello|hullo|good (?:morning|afternoon|evening))(?: there)?(?: (?:${NAME_PATTERN}))?[\\s!.,]*$`, "i");
export function isGreeting(text: string): boolean { return GREETING.test(text.trim()); }
