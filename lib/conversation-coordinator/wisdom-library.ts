import { readFileSync } from "node:fs";
import path from "node:path";

/** The ten possible names for the single shared TrustHub assistant intelligence. */
export const ASSISTANT_NAMES = ["Wisdom", "Tanaka", "Matthew", "Lizzie", "Daniel", "Sarah", "James", "Emily", "Michael", "Grace"] as const;
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Assigns one assistant name per conversation, deterministically and stably.
 * The same conversation id always yields the same name across restarts and
 * providers, so a returning user is not greeted by a different name on every
 * message. Conversation ids are opaque and phone numbers are never hashed here.
 */
export function assignAssistantName(conversationId: string): string {
  const index = hashString(conversationId) % ASSISTANT_NAMES.length;
  return ASSISTANT_NAMES[index];
}

export function isAssistantName(value: unknown): value is string {
  return typeof value === "string" && ASSISTANT_NAMES.includes(value as (typeof ASSISTANT_NAMES)[number]);
}

/** Rewrites the library's canonical self-reference to the assigned assistant name. */
export function applyAssistantName(text: string, name: string): string {
  if (!isAssistantName(name)) return text;
  const self = LIBRARY_SELF_NAME;
  return text.split(self).join(name);
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

  /** Picks one `new_hi` entry per conversation, introduced under the assigned name. */
  greeting(conversationId: string, assistantName: string): { entryId: string; reply: string } | null {
    const candidates = this.byCategory("new_hi").filter((entry) => entry.response.includes(LIBRARY_SELF_NAME));
    if (!candidates.length) return null;
    const entry = candidates[0]; // Deterministic: always pick the first greeting
    const reply = applyAssistantName([entry.response, entry.nextMove].filter(Boolean).join("\n\n"), assistantName);
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

const GREETING = /^(?:hi|hie|hey|hello|hullo|good (?:morning|afternoon|evening)|mhoro|mhoroi)\b/i;
export function isGreeting(text: string): boolean { return GREETING.test(text.trim()); }
