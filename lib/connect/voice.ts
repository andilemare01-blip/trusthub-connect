/**
 * Wisdom's voice, from the TrustHub Wisdom Conversation Library (1,000 lines in 68 moments).
 * Each moment has many ways of saying it, so a returning person never hears the same line twice in a row.
 * The library's example names ("Rudo", "Farai") become the person's own first name, or are left out.
 */
import { applyAssistantName, loadWisdomLibrary, type WisdomLibrary } from "../conversation-coordinator/wisdom-library.ts";

export type VoiceMoment =
  | "new_hi" | "returning" | "thanks" | "goodbye" | "smalltalk_weather" | "light_joke" | "misunderstanding"
  | "frustration" | "who_are_you" | "capability" | "solved" | "no_results";

/** Example names the library uses in its sample replies. */
const SAMPLE_NAMES = ["Tapiwa", "Farai", "Tendai", "Rudo", "Chipo", "Brian", "Nyasha", "Tawanda", "Tinashe", "Tatenda", "Kuda", "Rumbi", "Vimbai", "Tafadzwa", "Chiedza", "Blessing"];
const NAME = new RegExp(`\\b(${SAMPLE_NAMES.join("|")})\\b`, "g");

/** Lines that promise things TrustHub does not do yet are never used. */
const UNSUPPORTED = /\b(voice note|photo|remind you|calendar|book (?:it|for you)|profile started)\b/i;

/** The last line used per moment, so the same line does not come twice in a row. */
const lastUsed = new Map<string, string>();

/** Makes a library line ready to send: the assistant's own name, the person's name or none, and emoji. */
export function personalise(text: string, assistantName: string, firstName: string | null): string {
  let line = applyAssistantName(text, assistantName);
  if (firstName) line = line.replace(NAME, firstName);
  else line = line.replace(new RegExp(`,\\s*(?:${SAMPLE_NAMES.join("|")})\\b`, "g"), "").replace(new RegExp(`\\b(?:${SAMPLE_NAMES.join("|")})\\b,?\\s*`, "g"), "");
  return line.replace(/(^|[\s-])i('m|'ll|'ve|'d)?(?=[\s.,!?])/g, (_, gap: string, rest?: string) => `${gap}I${rest ?? ""}`).replace(/\[smile\]/g, "🙂").replace(/<3/g, "❤️").replace(/\s+([.,!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * One line for a moment, picked at random from the library (never the same as last time), or null
 * when the library is unavailable. `pick` can be fixed in tests.
 */
export function voiceLine(moment: VoiceMoment, assistantName: string, firstName: string | null = null, pick: (count: number) => number = (count) => Math.floor(Math.random() * count), library: WisdomLibrary | null = loadWisdomLibrary(), keep: (line: string) => boolean = () => true): string | null {
  if (!library) return null;
  const lines = [...new Set(library.byCategory(moment).map((entry) => entry.response).filter((text) => !UNSUPPORTED.test(text) && keep(personalise(text, assistantName, firstName))))];
  if (!lines.length) return null;
  const previous = lastUsed.get(moment);
  const choices = lines.length > 1 ? lines.filter((text) => text !== previous) : lines;
  const chosen = choices[Math.min(choices.length - 1, Math.max(0, pick(choices.length)))];
  lastUsed.set(moment, chosen);
  return personalise(chosen, assistantName, firstName);
}

/** Recognises the everyday moments the library has lines for. Order matters: the first match wins. */
export function momentOf(message: string): VoiceMoment | null {
  const text = message.trim().toLocaleLowerCase();
  if (text.length > 80) return null;
  if (/^(?:thanks|thank you|thank u|thx|ty|tnx|appreciated?|much appreciated|you(?:'re| are) (?:the best|amazing|a star)|you helped|that (?:was|is) (?:useful|helpful|great)|ndatenda|maita basa|siyabonga)\b/.test(text)) return "thanks";
  if (/^(?:bye|goodbye|see you|see ya|later|ciao|cheers|talk later|that'?s all|i'?m done|good ?night)\b[\s!.]*$/.test(text)) return "goodbye";
  if (/\b(?:joke|make me laugh|something funny|be funny|cheer me up)\b/.test(text)) return "light_joke";
  if (/^(?:(?:hi|hey|hello|hie)[\s,!]+)?(?:how are you|how are u|how r u|how'?s it going|how is it going|what'?s up|whats up|how was your day|how is your day|how'?s your day|are you (?:ok|okay|well|good)|wassup|sup|how have you been|you good)\b(?:[\s,]+(?:anyway|today|doing|now|though|then|my friend|friend|bro|sis|man|wisdom|tanaka|lizzie|sarah|james|grace|emily|michael|matthew|daniel))*[\s!?.]*$/.test(text)) return "smalltalk_weather";
  if (/^(?:who are you|who am i (?:talking|chatting) to|are you (?:a )?(?:bot|robot|human|real|real person|ai)|is this (?:a )?(?:bot|robot|human|real person)|what are you|what'?s your name|what is your name)\b[\s!?.]*$/.test(text)) return "who_are_you";
  if (/^(?:what can you (?:do|help (?:me )?with)|what do you do|how does this work|how do you work|what can i ask(?: you)?|help)\b[\s!?.]*$/.test(text)) return "capability";
  if (/\b(?:you (?:don'?t|do not|didn'?t) (?:understand|get it|get me)|that'?s not what i (?:meant|asked)|not what i (?:meant|asked)|you got it wrong|wrong answer|i meant something else)\b/.test(text)) return "misunderstanding";
  if (/\b(?:useless|frustrat|annoying|not helping|this is (?:stupid|rubbish|hard|bad)|taking forever|waste of time|so slow)\b/.test(text)) return "frustration";
  if (/^(?:it(?:'s| is) sorted|problem solved|sorted|i found (?:someone|one|it)|it worked|got it sorted)\b/.test(text)) return "solved";
  return null;
}

/** Ten names for the one TrustHub assistant; a new name each visit keeps the chat lively. */
export function nextAssistantName(names: readonly string[], current: string | null | undefined, pick: (count: number) => number = (count) => Math.floor(Math.random() * count)): string {
  const choices = names.filter((name) => name !== current);
  return choices[Math.min(choices.length - 1, Math.max(0, pick(choices.length)))];
}

/** The name to greet someone by: "Miss Tae😊" is Tae, "Dr. Moyo" is Moyo, "baba Tino" is Tino. */
export function firstNameOf(profileName: string | null | undefined): string | null {
  const words = (profileName ?? "").replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  const name = words.find((word) => !/^(miss|mr|mrs|ms|mx|dr|sir|madam|mai|baba|amai|mama|sisi|mukoma|prof|pastor|rev|eng)\.?$/i.test(word));
  if (!name || name.length < 2) return null;
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}
