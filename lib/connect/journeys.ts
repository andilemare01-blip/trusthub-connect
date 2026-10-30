/**
 * TrustHub Connect journeys: the menu-first WhatsApp experience.
 *
 * The engine runs before the search coordinator. It owns the welcome, the
 * main menu, review cards and every guided flow (review, add a business,
 * buy/sell, jobs, houses, area pulse, scam check, Ask Wisdom, profile and
 * feedback). It returns null for anything that is not its business, and the
 * coordinator's existing search and community logic handles that turn.
 *
 * Rules every flow follows:
 * - One question at a time, tap-first, with typed answers always accepted.
 * - A success message is sent only after the store confirmed the write.
 * - Unverified data is labelled as such; nothing is invented.
 */
import type { WhatsAppInteractiveMessage } from "../whatsapp/provider.ts";
import { clip, clipText, isMenuCommand, menuInteractive, menuText, resolveMenuSelection, type MenuId } from "./menu.ts";
import { categorise, correctTown, keywords, listingTitle, maskPhone, parseCardCode, parseCheckedPhone, parsePlace, parsePrice } from "./parse.ts";
import { goodbyeLine, handoverLine, humourLine, smalltalkLine, styleFor, thanksLine } from "./persona.ts";
import { firstNameOf, momentOf, voiceLine } from "./voice.ts";
import { parseLocalSearchRequest } from "../whatsapp/intent-parser.ts";
import { benitaLine } from "../benita/index.ts";
import { intelligenceBrief, intelligenceFallback, isIntelligenceQuestion } from "./intelligence.ts";
import { brainFallback, isAdviceQuestion, isOpenQuestion } from "./brain.ts";
import { isDeepCue, isFeedbackCue, isSearchLike, readReviewsQuestion } from "./routes.ts";
import type { ConnectStore, DirectoryBusiness, Listing, ListingIntent, ReviewItem } from "./store.ts";

export type ConnectFlow = "review" | "read_reviews" | "add_business" | "listing" | "listing_search" | "buy_sell" | "jobs" | "houses" | "area" | "scam" | "ask" | "feedback" | "brain" | "name";
type Scalar = string | number | boolean | null;
export interface ConnectJourneyState { flow: ConnectFlow; step: string; data: Record<string, Scalar> }

export interface ConnectContext {
  identityId: string | null;
  profileName: string | null;
  providerMessageId: string | null;
  assistantName: string;
  /** The teammate who was on before this one, when the name has just changed (morning to afternoon...). */
  handoverFrom?: string | null;
  /** The sender's own number; stored on listings they post so buyers can reach them. */
  senderPhoneForListing?: string | null;
}

/** Answers a deep question from TrustHub data; null when it could not answer. Injected so tests need no AI. */
export type DeepQuestionAnswerer = (question: string, city: string | null, key: string, assistantName?: string) => Promise<string | null>;

export interface ConnectReply {
  reply: string;
  interactive?: WhatsAppInteractiveMessage;
  state: ConnectJourneyState | null;
  action: "show_menu" | "start_journey" | "clarify" | "answer" | "placeholder";
  /** Hand this turn's follow-ups to an existing coordinator journey (search). */
  handoff?: "business_discovery";
  /** Let the coordinator handle this same message (e.g. a free question when AI is off). */
  pass?: boolean;
}

const CANCEL = /^(?:cancel|stop|exit|quit|back|main menu)$/i;
const GREETING = /^(?:hi+|hie|hey|hello|hullo|helo|howzit|good (?:morning|afternoon|evening|day)|mhoro|mhoroi|makadii|salibonani|sawubona|start)\b[\s!.,]*$/i;
const REVIEW_COOLDOWN_DAYS = 30;
/** Screens that show a result rather than wait for a specific answer; a typed menu number still works there. */
const RESULT_SCREENS = new Set(["listing_search.results", "area.shown", "brain.followup", "name.ask", "scam.result", "feedback.offer", "add_business.review_existing"]);

function buttons(body: string, items: [id: string, title: string][], footer?: string): WhatsAppInteractiveMessage {
  return { type: "button", body: clipText(body, 1024), buttons: items.slice(0, 3).map(([id, title]) => ({ id, title: clip(title, 20) })), ...(footer ? { footer: clip(footer, 60) } : {}) };
}

function list(body: string, buttonText: string, sectionTitle: string, rows: { id: string; title: string; description?: string }[]): WhatsAppInteractiveMessage {
  return { type: "list", body: clipText(body, 1024), buttonText: clip(buttonText, 20), sections: [{ title: clip(sectionTitle, 24), rows: rows.slice(0, 10).map((row) => ({ id: row.id, title: clip(row.title, 24), ...(row.description ? { description: clip(row.description, 72) } : {}) })) }] };
}

/** True when the reply is the given button id, its label, or a common typed equivalent. */
function chose(text: string, id: string, ...words: string[]): boolean {
  const value = text.trim().toLocaleLowerCase().replace(/[.!]+$/, "");
  return value === id.toLowerCase() || words.some((word) => value === word.toLowerCase());
}

const YES = ["yes", "y", "yeah", "yep", "ok", "okay", "sure", "correct", "that's it", "thats it", "ehe", "hongu"];
const NO = ["no", "n", "nope", "not it", "wrong", "kwete"];

function where(business: Pick<DirectoryBusiness, "area" | "city">): string {
  return [business.area, business.city].filter(Boolean).join(", ");
}

function stars(rating: number): string { return `${rating} of 5`; }

const RATING_ROWS = [
  { id: "rate:5", title: "5 · Excellent", description: "Better than expected" },
  { id: "rate:4", title: "4 · Good", description: "Happy with it" },
  { id: "rate:3", title: "3 · Okay", description: "Some good, some bad" },
  { id: "rate:2", title: "2 · Poor", description: "Not happy" },
  { id: "rate:1", title: "1 · Terrible", description: "Would not go back" },
];

function parseRating(text: string): number | null {
  const id = /^rate:([1-5])$/.exec(text.trim());
  if (id) return Number(id[1]);
  const typed = /^\s*([1-5])(?:\s*(?:\/\s*5|stars?|out of 5|·.*))?\s*$/i.exec(text);
  if (typed) return Number(typed[1]);
  const word: Record<string, number> = { excellent: 5, great: 5, good: 4, okay: 3, ok: 3, average: 3, poor: 2, bad: 2, terrible: 1, awful: 1 };
  return word[text.trim().toLocaleLowerCase()] ?? null;
}

/** A Zimbabwean mobile number as a WhatsApp link; landlines and malformed numbers are not links. */
function waLink(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const local = digits.startsWith("263") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^7[1378]\d{7}$/.test(local) ? `wa.me/263${local}` : null;
}

/** The name in a reply like "Andile", "my name is Andile Moyo" or "call me Tino", or null when it isn't a name. */
export function plausibleName(text: string): string | null {
  const cleaned = text.trim().replace(/^(?:my name is|my names are|my name's|i am|i'm|im|call me|you can call me|it's|its|this is|name:?)\s+/i, "").replace(/[.!🙂😊]+$/u, "").trim();
  const words = cleaned.split(/\s+/);
  if (!cleaned || words.length > 3 || cleaned.length > 40) return null;
  if (!words.every((word) => /^[\p{L}][\p{L}'-]{1,19}$/u.test(word))) return null;
  if (/^(hi|hie|hey|hello|yes|no|ok|okay|thanks|menu|help|skip|plumber|hotel|jobs?|house|rent|find|search|harare|bulawayo|mutare|gweru|masvingo|good|fine|nothing|what|who|where|how)$/i.test(words[0])) return null;
  if (correctTown(cleaned)) return null;
  return words.map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()).join(" ");
}

/** True when two business names are the same business, ignoring case, punctuation and words like "Pvt Ltd". */
function sameBusinessName(a: string, b: string): boolean {
  const key = (name: string) => name.toLocaleLowerCase().replace(/\b(pvt|private|ltd|limited|t\/a|the|and|&)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  const left = key(a), right = key(b);
  return !!left && !!right && (left === right || (Math.min(left.length, right.length) >= 6 && (left.includes(right) || right.includes(left))));
}

/** Things people buy and sell (as opposed to services they hire). */
const GOODS = /\b(car|cars|vehicle|toyota|honda|nissan|mazda|mercedes|bmw|vw|volkswagen|ford|isuzu|hilux|fit|aqua|vitz|corolla|probox|fortuner|land ?cruiser|ranger|truck|kombi|motorbike|phone|iphone|samsung|tecno|infinix|laptop|tv|fridge|stove|sofa|bed|solar panel|inverter|generator|furniture)\b/i;

/** Words that say how someone is shopping, not what they want; they never decide a match. */
const SHOPPING_WORDS = new Set(["sale", "sell", "selling", "buy", "buying", "cheap", "cheapest", "used", "second", "hand", "want", "need", "looking", "price", "prices", "good", "nice", "best", "affordable", "rent", "renting", "let", "under", "below", "around", "about", "near", "jobs", "job", "vacancy", "vacancies", "hiring"]);

function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

function listingLine(listing: Listing, index: number): string {
  const web = sourceHost(listing.sourceUrl);
  const checked = listing.status === "approved" ? "Checked" : web ? `Found online (${web}), not yet checked` : "Not yet checked";
  const facts = [listing.priceText, [listing.area, listing.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
  const contact = waLink(listing.phone);
  return `${index + 1}. *${clip(listing.title, 60)}*${facts ? ` · ${facts}` : ""}\n   ${contact ? `WhatsApp: ${contact} · ` : ""}${checked}`;
}

interface ListingKind {
  intent: ListingIntent;
  /** Fixed category, or null to derive it from the text. */
  category: string | null;
  noun: string;
  example: string;
}

const LISTING_KINDS: Record<string, ListingKind> = {
  sell: { intent: "offering", category: null, noun: "listing", example: "Samsung A15, $120, Chinhoyi" },
  buy_request: { intent: "seeking", category: null, noun: "request", example: "fridge in Harare under $300" },
  hire: { intent: "recruiting", category: "jobs", noun: "job post", example: "Shop assistant, Chinhoyi, $150 a month" },
  work: { intent: "job_seeking", category: "jobs", noun: "post", example: "Driver with class 2 licence, Harare" },
  rent_out: { intent: "offering", category: "property", noun: "listing", example: "2-room cottage, $180 a month, Waterfalls, Harare" },
  rent_request: { intent: "seeking", category: "property", noun: "request", example: "2 rooms in Avondale under $200" },
};

interface SearchKind { intents: ListingIntent[]; category: string | null; journey: string; requestKind: string; empty: string }

const SEARCH_KINDS: Record<string, SearchKind> = {
  buy: { intents: ["offering"], category: null, journey: "buy_sell", requestKind: "buy_request", empty: "Nothing listed for that yet" },
  jobs: { intents: ["recruiting"], category: "jobs", journey: "jobs", requestKind: "work", empty: "No jobs like that listed yet" },
  houses: { intents: ["offering"], category: "property", journey: "houses", requestKind: "rent_request", empty: "No places like that listed yet" },
};

export class ConnectJourneys {
  private readonly store: ConnectStore;
  private readonly answerer?: DeepQuestionAnswerer;
  private readonly now: () => Date;

  constructor(store: ConnectStore, answerer?: DeepQuestionAnswerer, now: () => Date = () => new Date()) {
    this.store = store;
    this.answerer = answerer;
    this.now = now;
  }

  /** Handles the turn, or returns null when the coordinator should handle it instead. */
  async handle(text: string, context: ConnectContext, state: ConnectJourneyState | null): Promise<ConnectReply | null> {
    const message = text.trim();
    if (!message) return state ? this.repeat(state) : null;
    try {
      if (GREETING.test(message) || isMenuCommand(message) || chose(message, "btn.menu") || (state && CANCEL.test(message))) return await this.welcome(context, GREETING.test(message));
      const card = parseCardCode(message);
      if (card && (/^\s*(?:review\s+)?th-?\d{4,6}\s*$/i.test(message) || !state)) return await this.startCardReview(card, context);
      // A tapped menu row works from anywhere; a typed number only means a menu
      // option when no flow is waiting for an answer ("5" may be a rating).
      const selection = resolveMenuSelection(message);
      const awaitingAnswer = !!state && !RESULT_SCREENS.has(`${state.flow}.${state.step}`);
      if (selection && (!awaitingAnswer || message.startsWith("menu."))) return await this.begin(selection.id, context);
      if (state) return await this.continue(state, message, context);
      if (/\b(?:scam|fraud|con ?artist|check (?:this |a )?number|is this number)\b/i.test(message) || (/\bcheck\b/i.test(message) && parseCheckedPhone(message))) {
        const phone = parseCheckedPhone(message);
        return phone ? await this.scamResult(phone) : this.begin("menu.scam", context);
      }
      if (/^(?:feedback|suggestion|complaint)\s*$/i.test(message)) return this.askFeedback();
      if (isFeedbackCue(message)) return await this.recordFeedback(message, context);
      if (/\b(?:my (?:credits|profile|account|balance)|create (?:a |my )?(?:profile|account)|sign ?up|register)\b/i.test(message)) return await this.profile(context);
      // "My name is Andile" at any time saves the name.
      if (context.identityId && /^(?:my name is|my names are|my name's|call me|you can call me)\s+\S/i.test(message)) {
        const name = plausibleName(message);
        if (name) {
          await this.store.savePersonName?.(context.identityId, name).catch(() => undefined);
          const body = `Got it, ${name}! I'll remember you. What can I find for you?`;
          return { reply: body, interactive: buttons(body, [["menu.find", "Find a business"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
        }
      }
      const social = this.socialReply(message, context);
      if (social) return social;
      // "review Clevers Hotel" / "I want to rate Sunny Bakery" starts a review of that business.
      const toReview = /^(?:i want to |let me |can i )?(?:review|rate|write a review (?:for|of|about))\s+(.{3,80})$/i.exec(message)?.[1];
      if (toReview && !/\b(?:reviews|say|said|think)\b/i.test(toReview)) return await this.findForReview(toReview, context);
      const natural = await this.naturalListing(message, context);
      if (natural) return natural;
      const reviews = readReviewsQuestion(message);
      if (reviews) return await this.readReviews(reviews);
      return null;
    } catch (error) {
      console.error(JSON.stringify({ event: "connect.journey_failed", flow: state?.flow ?? null, step: state?.step ?? null, errorType: error instanceof Error ? error.name : "unknown", detail: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
      return {
        reply: "Sorry, something went wrong on my side and nothing was saved. Please try that again in a minute.",
        interactive: buttons("Sorry, something went wrong on my side and nothing was saved. Please try that again in a minute.", [["btn.menu", "Main menu"]]),
        state,
        action: "clarify",
      };
    }
  }

  private repeat(state: ConnectJourneyState): ConnectReply {
    return { reply: "I didn't catch that. Please reply to the last question, or type MENU to start again.", state, action: "clarify" };
  }

  private requireIdentity(state: ConnectJourneyState | null): ConnectReply {
    return { reply: "I couldn't confirm your WhatsApp number, so I can't save this. Please message TrustHub Connect directly from WhatsApp.", state, action: "clarify" };
  }

  async welcome(context: ConnectContext, greeted: boolean): Promise<ConnectReply> {
    let returning = false;
    if (context.identityId) {
      const grant = await this.store.addCredits(context.identityId, 10, "welcome", "welcome");
      returning = !grant.added;
    }
    const firstName = firstNameOf(context.profileName);
    const name = context.assistantName;
    // Lines from the Wisdom library, a different one each time; the plain line is the fallback.
    const hello = returning
      ? (greeted ? voiceLine("returning", name, firstName) : null)
      : voiceLine("new_hi", name, firstName, undefined, undefined, (line) => line.includes(name));
    // A returning person meets the teammate on this shift, who says who they're taking over from.
    const introduce = (line: string) => context.handoverFrom && context.handoverFrom !== name ? `${line} ${handoverLine(name, context.handoverFrom, this.now())}` : line.includes(name) ? line : `${line} It's ${name} on duty today 🙂`;
    const body = returning
      ? (greeted && hello ? `${introduce(hello)}${/[?]\s*$/.test(hello) ? "" : " What would you like to do?"}` : `${greeted ? `Welcome back${firstName ? `, ${firstName}` : ""}! ` : ""}It's ${name}. What would you like to do?`)
      : `${hello ?? `Hi, I'm ${name}. I help you find trusted businesses, buy and sell, and see what's happening around you.`}${styleFor(name).signature ? ` ${styleFor(name).signature}` : ""}\n\nWhat would you like to do?`;
    // A new person is asked for a name once, so Wisdom can recognise them next time.
    // Anything that isn't a name (a menu number, a search) simply carries on, so the question never gets in the way.
    if (greeted && !returning && !context.profileName && context.identityId) {
      const asked = `${body}\n\nP.S. What should I call you? Just type your first name.`;
      return { reply: `${body}\n\n${menuText()}\n\nP.S. What should I call you? Just type your first name.`, interactive: menuInteractive(asked), state: { flow: "name", step: "ask", data: { after: "menu" } }, action: "show_menu" };
    }
    return { reply: `${body}\n\n${menuText()}`, interactive: menuInteractive(body), state: null, action: "show_menu" };
  }

  /** Starts "add a business" with whatever the person already told us (e.g. "I know a plumber called Tariro in Chiredzi"). */
  beginAddBusiness(prefill: { name: string | null; category: string | null; city: string | null; area: string | null }): ConnectReply {
    const data: Record<string, Scalar> = { name: prefill.name, category: prefill.category, city: prefill.city, area: prefill.area };
    const known = prefill.name ? `*${prefill.name}*` : "this business";
    if (!prefill.name) return { reply: "Thanks for the tip! Let's add it so others can find it. What's the business called?", state: { flow: "add_business", step: "name", data }, action: "start_journey" };
    if (!prefill.category) return { reply: `Thanks for the tip! Let's add ${known} so others can find it. What kind of business is it?`, state: { flow: "add_business", step: "category", data }, action: "start_journey" };
    if (!prefill.city) return { reply: `Thanks for the tip! Let's add ${known}. Where is it? Send the town, and the area if you know it.`, state: { flow: "add_business", step: "place", data }, action: "start_journey" };
    const body = `Thanks for the tip! Let's add ${known} so others can find it.\n\nWhat's their phone number? Tap Skip if you don't know it.`;
    return { reply: body, interactive: buttons(body, [["btn.skip", "Skip"]]), state: { flow: "add_business", step: "phone", data }, action: "start_journey" };
  }

  async begin(id: MenuId, context: ConnectContext): Promise<ConnectReply> {
    switch (id) {
      case "menu.find": {
        const body = "What are you looking for, and where?\nFor example: *plumber in Avondale*";
        return { reply: body, state: null, action: "start_journey", handoff: "business_discovery" };
      }
      case "menu.review": {
        const body = "Would you like to write a review, or read what people say?";
        return { reply: body, interactive: buttons(body, [["btn.write_review", "Write a review"], ["btn.read_reviews", "Read reviews"]]), state: { flow: "review", step: "choose", data: {} }, action: "start_journey" };
      }
      case "menu.add_business":
        return { reply: "Great, let's add it. What's the business called?", state: { flow: "add_business", step: "name", data: {} }, action: "start_journey" };
      case "menu.buy_sell": {
        const body = "Are you buying or selling?";
        return { reply: body, interactive: buttons(body, [["btn.sell", "I'm selling"], ["btn.buy", "I'm looking"]]), state: { flow: "buy_sell", step: "choose", data: {} }, action: "start_journey" };
      }
      case "menu.jobs": {
        const body = "Are you looking for work, or hiring?";
        return { reply: body, interactive: buttons(body, [["btn.find_work", "Find work"], ["btn.hire", "I'm hiring"]]), state: { flow: "jobs", step: "choose", data: {} }, action: "start_journey" };
      }
      case "menu.houses": {
        const body = "Are you looking for a place, or offering one?";
        return { reply: body, interactive: buttons(body, [["btn.find_place", "Find a place"], ["btn.list_place", "List a place"]]), state: { flow: "houses", step: "choose", data: {} }, action: "start_journey" };
      }
      case "menu.area":
        return await this.startArea(context, null);
      case "menu.scam": {
        const body = "Send me the number you want to check.\nFor example: *0771 234 567*";
        return { reply: body, state: { flow: "scam", step: "number", data: {} }, action: "start_journey" };
      }
      case "menu.ask": {
        const balance = context.identityId ? await this.store.creditBalance(context.identityId) : 0;
        const body = this.answerer
          ? `Ask me anything about businesses, prices or your area.\n\nSimple searches like *plumber in Avondale* are always free. Deep questions use 1 credit, and you're only charged when I answer. You have ${balance}.`
          : "Ask me anything about businesses, prices or your area.\n\nSimple searches like *plumber in Avondale* are always free.";
        return { reply: body, state: { flow: "ask", step: "question", data: {} }, action: "start_journey" };
      }
      case "menu.profile":
        return await this.profile(context);
    }
  }

  private async continue(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply | null> {
    switch (state.flow) {
      case "review": return await this.review(state, text, context);
      case "add_business": return await this.addBusiness(state, text, context);
      case "buy_sell":
        if (chose(text, "btn.sell", "selling", "i'm selling", "sell")) return this.startListing("sell");
        if (chose(text, "btn.buy", "buying", "i'm looking", "im looking", "buy", "looking")) return this.startSearch("buy");
        if (text.trim().length >= 4) return (await this.naturalListing(text, context)) ?? await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "buy" } }, text, context);
        return { reply: "Tap *I'm selling* or *I'm looking*, or type MENU to go back.", interactive: buttons("Are you buying or selling?", [["btn.sell", "I'm selling"], ["btn.buy", "I'm looking"]]), state, action: "clarify" };
      case "jobs":
        if (chose(text, "btn.find_work", "find work", "work", "job", "jobs", "looking for work", "i'm looking", "im looking", "looking", "find", "search")) return this.startSearch("jobs");
        if (chose(text, "btn.hire", "i'm hiring", "hiring", "hire")) return this.startListing("hire");
        // Typing the search itself ("driver jobs in Harare") skips the question.
        if (text.trim().length >= 4 && !/\b(hiring|hire|employ)\b/i.test(text)) return await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "jobs" } }, text, context);
        return { reply: "Tap *Find work* or *I'm hiring*, or type MENU to go back.", interactive: buttons("Are you looking for work, or hiring?", [["btn.find_work", "Find work"], ["btn.hire", "I'm hiring"]]), state, action: "clarify" };
      case "houses":
        if (chose(text, "btn.find_place", "find a place", "find", "looking", "i'm looking", "im looking", "search", "rent", "renting", "buy", "buying")) return this.startSearch("houses");
        if (chose(text, "btn.list_place", "list a place", "list", "offering", "rent out")) return this.startListing("rent_out");
        // Typing the search itself ("cottage in Avondale under $500") skips the question.
        if (text.trim().length >= 4 && !/\b(renting out|letting out|to let|list)\b/i.test(text)) return await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "houses" } }, text, context);
        return { reply: "Tap *Find a place* or *List a place*, or type MENU to go back.", interactive: buttons("Are you looking for a place, or offering one?", [["btn.find_place", "Find a place"], ["btn.list_place", "List a place"]]), state, action: "clarify" };
      case "listing": return await this.listing(state, text, context);
      case "listing_search": return await this.listingSearch(state, text, context);
      case "area": return await this.area(state, text, context);
      case "brain": return await this.brainFollowUp(state, text, context);
      case "name": return await this.nameStep(state, text, context);
      case "scam": return await this.scam(state, text, context);
      case "ask": return await this.ask(state, text, context);
      case "read_reviews": return await this.readReviewsFromText(text);
      case "feedback": return await this.feedback(state, text, context);
    }
  }

  // ---------------------------------------------------------------- reviews

  private async startCardReview(code: string, context: ConnectContext): Promise<ConnectReply> {
    const card = await this.store.findCard(code);
    if (!card || card.status !== "active" || !card.business) {
      return { reply: `Card ${code} isn't active right now. Which business would you like to review? Send its name and town.`, state: { flow: "review", step: "which", data: {} }, action: "start_journey" };
    }
    return await this.askRating(card.business, context, { verified: true, cardCode: card.code }, `Welcome! You're reviewing *${card.business.name}*${where(card.business) ? ` in ${where(card.business)}` : ""}. How was your visit?`);
  }

  private async askRating(business: DirectoryBusiness, context: ConnectContext, extra: { verified: boolean; cardCode: string | null }, intro?: string): Promise<ConnectReply> {
    if (context.identityId) {
      const last = await this.store.lastReviewAt(context.identityId, business.id);
      if (last) {
        const next = new Date(new Date(last).getTime() + REVIEW_COOLDOWN_DAYS * 86_400_000);
        if (next > this.now()) {
          const body = `You already reviewed *${business.name}* on ${new Date(last).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. You can review it again from ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`;
          return { reply: body, interactive: buttons(body, [["menu.review", "Review another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
        }
      }
    }
    const body = intro ?? `How was *${business.name}*?`;
    return {
      reply: `${body}\n\nReply 1 to 5 (5 is excellent).`,
      interactive: list(body, "Tap to rate", "Your rating", RATING_ROWS),
      state: { flow: "review", step: "rating", data: { businessId: business.id, businessName: business.name, verified: extra.verified, cardCode: extra.cardCode } },
      action: "clarify",
    };
  }

  private async review(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const data = state.data;
    if (state.step === "choose") {
      if (chose(text, "btn.read_reviews", "read reviews", "read", "reviews")) return this.askWhichToRead();
      if (chose(text, "btn.write_review", "write a review", "write", "review")) return this.askWhichToReview();
      // Anything typed here is taken as the business name to review.
      return await this.findForReview(text, context);
    }
    const openBusiness = async (id: string) => {
      const business = await this.store.getBusiness(id);
      if (!business) return { reply: "I couldn't open that business. Send the name again, please.", state: { flow: "review" as const, step: "which", data: {} }, action: "clarify" as const };
      return await this.askRating(business, context, { verified: false, cardCode: null });
    };
    if (state.step === "which") return await this.findForReview(text, context);
    if (state.step === "pick") return text.startsWith("biz:") ? await openBusiness(text.slice(4)) : await this.findForReview(text, context);
    if (state.step === "confirm") {
      if (chose(text, "btn.yes", ...YES, "yes, that's it")) return await openBusiness(String(data.businessId ?? ""));
      if (chose(text, "btn.retry", ...NO, "no, try again", "try again")) return { reply: "No problem. Send the business name again, with the town if you know it.", state: { flow: "review", step: "which", data: {} }, action: "clarify" };
      return { reply: "Tap *Yes* if that's the business, or *No* to search again.", interactive: buttons(`Is it *${data.businessName}*?`, [["btn.yes", "Yes, that's it"], ["btn.retry", "No, try again"]]), state, action: "clarify" };
    }
    if (state.step === "rating") {
      const rating = parseRating(text);
      if (!rating) return { reply: "Please choose a rating from 1 to 5.", interactive: list(`How was *${data.businessName}*?`, "Tap to rate", "Your rating", RATING_ROWS), state, action: "clarify" };
      const body = "Want to add a few words? Type it, or tap Skip.";
      return { reply: body, interactive: buttons(body, [["btn.skip", "Skip"]]), state: { ...state, step: "comment", data: { ...data, rating } }, action: "clarify" };
    }
    if (state.step === "comment") {
      if (!context.identityId) return this.requireIdentity(state);
      const comment = chose(text, "btn.skip", "skip", "no", "none", "nothing") ? "" : text.slice(0, 1000);
      const businessId = String(data.businessId);
      const saved = await this.store.saveReview({
        businessId, identityId: context.identityId, rating: Number(data.rating), text: comment,
        verifiedVisit: data.verified === true, cardCode: typeof data.cardCode === "string" ? data.cardCode : null,
        sourceMessageId: context.providerMessageId ?? `local:${businessId}:${this.now().getTime()}`,
      });
      const credit = await this.store.addCredits(context.identityId, 1, "review", saved.id);
      const lines = [
        "Saved. Thank you!",
        "",
        `*${data.businessName}* · ${stars(Number(data.rating))}`,
        ...(comment ? [`"${clip(comment, 200)}"`] : []),
        ...(data.verified === true ? ["✓ Verified visit · you tapped the card in store"] : []),
        "",
        saved.status === "published" ? "Your review is live." : "It will appear after a quick check.",
        `+1 credit · you now have ${credit.balance}`,
      ];
      // Someone who hasn't left a name is asked once, right after their first review, so others see who reviewed.
      if (!context.profileName) {
        lines.push("", "P.S. What should I call you? Reply with your first name so I recognise you next time, or tap *Skip*.");
        const asked = lines.join("\n");
        return { reply: asked, interactive: buttons(asked, [["btn.skip", "Skip"], ["menu.review", "Review another"], ["btn.menu", "Main menu"]]), state: { flow: "name", step: "ask", data: { after: "review" } }, action: "answer" };
      }
      const reply = lines.join("\n");
      return { reply, interactive: buttons(reply, [["menu.review", "Review another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
    }
    return this.repeat(state);
  }

  private askWhichToReview(): ConnectReply {
    return { reply: "Which business would you like to review? Send its name, and the town if you know it.\nFor example: *Sunny Bakery, Chinhoyi*", state: { flow: "review", step: "which", data: {} }, action: "start_journey" };
  }

  private askWhichToRead(): ConnectReply {
    return { reply: "Which business, or what kind of business, and where?\nFor example: *chicken in Chiredzi* or *Sunny Bakery, Chinhoyi*", state: { flow: "read_reviews", step: "which", data: {} }, action: "start_journey" };
  }

  private async readReviewsFromText(text: string): Promise<ConnectReply> {
    const place = parsePlace(text);
    const terms = keywords(text.replace(/\b(?:in|at|near|around)\s+\S+$/i, " ")).slice(0, 4);
    if (!terms.length) return { reply: "Which business, or what kind of business? For example: *chicken in Chiredzi*", state: { flow: "read_reviews", step: "which", data: {} }, action: "clarify" };
    return await this.readReviews({ terms, city: place.city });
  }

  /** Shows published and unchecked reviews that match the question, with a way to write one. */
  private async readReviews(question: { terms: string[]; city: string | null }): Promise<ConnectReply> {
    const found: ReviewItem[] = await this.store.searchReviews({ terms: question.terms, city: question.city, limit: 5 });
    const topic = `${question.terms.join(" ") || "businesses"}${question.city ? ` in ${question.city}` : ""}`;
    const actions: [string, string][] = [["menu.review", "Write a review"], ["btn.menu", "Main menu"]];
    if (!found.length) {
      const body = `Nobody has reviewed *${topic}* on TrustHub yet. Be the first to tell others how it went.`;
      return { reply: body, interactive: buttons(body, actions), state: null, action: "answer" };
    }
    const lines = found.map((item, index) => {
      const stars = "★".repeat(item.rating) + "☆".repeat(Math.max(0, 5 - item.rating));
      const place = where(item.business);
      const status = item.verifiedVisit ? "Verified visit" : item.checked ? "Checked" : "Not checked yet";
      const comment = item.text ? `"${clip(item.text, 160)}"` : "No comment, just a rating";
      return `${index + 1}. ${stars} *${clip(item.business.name, 40)}*${place ? ` · ${place}` : ""}\n   ${comment} · ${status}`;
    });
    const body = [`Here's what people say about *${topic}*:`, "", ...lines, "", "Reviews marked *Not checked yet* have not been checked by the team."].join("\n");
    return { reply: body, interactive: buttons(body, actions), state: null, action: "answer" };
  }

  private async findForReview(text: string, context: ConnectContext): Promise<ConnectReply> {
    const place = parsePlace(text);
    let name = text;
    for (const value of [place.area, place.city]) if (value) name = name.replace(new RegExp(`\\s*(?:,|\\bin\\b|\\bat\\b)?\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
    name = name.replace(/\s+/g, " ").replace(/[,.\s]+$/, "").trim();
    if (name.length < 2) return { reply: "What's the business called?", state: { flow: "review", step: "which", data: {} }, action: "clarify" };
    const found = await this.store.searchDirectory(name, place.city, 5, true);
    await this.store.logSearch({ identityId: context.identityId, journey: "review", category: null, city: place.city, area: place.area, queryText: clip(name, 200), resultCount: found.length, sourceMessageId: context.providerMessageId ? `${context.providerMessageId}:review` : null }).catch(() => undefined);
    if (!found.length) {
      const body = `I couldn't find *${clip(name, 60)}*${place.city ? ` in ${place.city}` : ""} on TrustHub. Want to add it, so you and others can review it?`;
      return { reply: body, interactive: buttons(body, [["btn.add_it", "Add it"], ["btn.retry", "Try another name"], ["btn.menu", "Main menu"]]), state: { flow: "add_business", step: "offer", data: { name: clip(name, 80), city: place.city, area: place.area } }, action: "clarify" };
    }
    if (found.length === 1) {
      const business = found[0];
      const body = `Is it *${business.name}*${where(business) ? ` in ${where(business)}` : ""}?`;
      return { reply: body, interactive: buttons(body, [["btn.yes", "Yes, that's it"], ["btn.retry", "No, try again"]]), state: { flow: "review", step: "confirm", data: { businessId: business.id, businessName: business.name } }, action: "clarify" };
    }
    const body = `I found ${found.length} matches. Which one?`;
    const numbered = found.map((business, index) => `${index + 1}. ${business.name}${where(business) ? ` · ${where(business)}` : ""}`).join("\n");
    return {
      reply: `${body}\n\n${numbered}`,
      interactive: list(body, "Choose business", "Matches", found.map((business) => ({ id: `biz:${business.id}`, title: business.name, description: [business.category, where(business)].filter(Boolean).join(" · ") }))),
      state: { flow: "review", step: "pick", data: { options: found.map((business) => business.id).join(",") } },
      action: "clarify",
    };
  }

  // ---------------------------------------------------------- add business

  private async addBusiness(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const data = state.data;
    const next = (step: string, reply: string, extra: Record<string, Scalar> = {}, interactive?: WhatsAppInteractiveMessage): ConnectReply => ({ reply, ...(interactive ? { interactive } : {}), state: { flow: "add_business", step, data: { ...data, ...extra } }, action: "clarify" });
    switch (state.step) {
      case "offer":
        if (chose(text, "btn.add_it", "add it", "add", ...YES)) return next("category", `What kind of business is *${data.name}*? For example: bakery, plumber, salon.`);
        if (chose(text, "btn.retry", "try another name", "try again", ...NO)) return { reply: "Send the business name again, with the town if you know it.", state: { flow: "review", step: "which", data: {} }, action: "clarify" };
        return next("offer", "Tap *Add it* to add this business, or *Try another name*.");
      case "name": {
        const name = clip(text, 80);
        if (name.length < 2) return next("name", "What's the business called?");
        return next("category", `What kind of business is *${name}*? For example: bakery, plumber, salon.`, { name });
      }
      case "category": {
        const category = clip(text.toLocaleLowerCase(), 40);
        if (category.length < 3) return next("category", "What kind of business is it? For example: bakery, plumber, salon.");
        if (data.city) return this.askPhone({ ...data, category });
        return next("place", "Where is it? Send the town, and the area if you know it.\nFor example: *Avondale, Harare*", { category });
      }
      case "place": {
        const place = parsePlace(text);
        const city = place.city ?? (text.trim().split(/\s+/).length <= 3 && /^[\p{L}\s'-]+$/u.test(text.trim()) ? text.trim().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()) : null);
        if (!city) return next("place", "Which town is it in? For example: *Harare* or *Avondale, Harare*.");
        return this.askPhone({ ...data, city, area: place.area });
      }
      case "phone": {
        const skipped = chose(text, "btn.skip", "skip", "no", "don't know", "dont know", "none");
        const phone = skipped ? null : parseCheckedPhone(text);
        if (!skipped && !phone) return next("phone", "That doesn't look like a phone number. Send it like *0771 234 567*, or tap Skip.", {}, buttons("That doesn't look like a phone number. Send it like 0771 234 567, or tap Skip.", [["btn.skip", "Skip"]]));
        const withPhone = { ...data, phone };
        const duplicates = (await this.store.searchDirectory(String(data.name), typeof data.city === "string" ? data.city : null, 3))
          // Only a business whose name really matches counts as a duplicate ("Dot's Kitchen" is not "Mama Rudo Kitchen").
          .filter((match) => sameBusinessName(match.name, String(data.name)));
        if (duplicates.length) {
          const match = duplicates[0];
          const body = `This looks like it's already on TrustHub:\n*${match.name}*${where(match) ? ` · ${where(match)}` : ""}\n\nIs it the same business?`;
          return { reply: body, interactive: buttons(body, [["btn.same", "Same one"], ["btn.new", "No, it's new"]]), state: { flow: "add_business", step: "duplicate", data: { ...withPhone, duplicateId: match.id, duplicateName: match.name } }, action: "clarify" };
        }
        return this.confirmBusiness(withPhone);
      }
      case "duplicate":
        if (chose(text, "btn.same", "same one", "same", ...YES)) {
          const body = `Great, *${data.duplicateName}* is already listed. Would you like to review it?`;
          return { reply: body, interactive: buttons(body, [["btn.review_it", "Review it"], ["btn.menu", "Main menu"]]), state: { flow: "add_business", step: "review_existing", data }, action: "answer" };
        }
        if (chose(text, "btn.new", "no, it's new", "new", "different", ...NO)) return this.confirmBusiness({ ...data, duplicateId: null });
        return next("duplicate", "Tap *Same one* or *No, it's new*.");
      case "review_existing": {
        const business = await this.store.getBusiness(String(data.duplicateId ?? ""));
        if (chose(text, "btn.review_it", "review it", ...YES) && business) return await this.askRating(business, context, { verified: false, cardCode: null });
        return await this.welcome(context, false);
      }
      case "confirm": {
        if (chose(text, "btn.cancel", "cancel", ...NO)) return { reply: "Okay, I didn't add it.", interactive: buttons("Okay, I didn't add it.", [["btn.menu", "Main menu"]]), state: null, action: "answer" };
        if (!chose(text, "btn.submit", "submit", "send", ...YES)) return this.confirmBusiness(data);
        if (!context.identityId) return this.requireIdentity(state);
        const saved = await this.store.saveBusinessSubmission({
          name: String(data.name), category: String(data.category), city: String(data.city),
          area: typeof data.area === "string" ? data.area : null, phone: typeof data.phone === "string" ? data.phone : null,
          identityId: context.identityId, possibleDuplicateOf: typeof data.duplicateId === "string" ? data.duplicateId : null,
          sourceMessageId: context.providerMessageId ?? `local:business:${this.now().getTime()}`,
        });
        const credit = await this.store.addCredits(context.identityId, 1, "add_business", saved.id);
        const reply = `Thanks! *${data.name}* is waiting for a quick check before it appears in searches.\n\n+1 credit · you now have ${credit.balance}`;
        return { reply, interactive: buttons(reply, [["menu.add_business", "Add another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
      }
    }
    return this.repeat(state);
  }

  private askPhone(data: Record<string, Scalar>): ConnectReply {
    const body = "What's their phone number? Tap Skip if you don't know it.";
    return { reply: body, interactive: buttons(body, [["btn.skip", "Skip"]]), state: { flow: "add_business", step: "phone", data }, action: "clarify" };
  }

  private confirmBusiness(data: Record<string, Scalar>): ConnectReply {
    const body = [
      "Here's what I'll add:", "",
      `*${data.name}*`,
      String(data.category),
      [data.area, data.city].filter(Boolean).join(", "),
      ...(typeof data.phone === "string" ? [`Phone: ${data.phone}`] : []),
    ].join("\n");
    return { reply: body, interactive: buttons(body, [["btn.submit", "Submit"], ["btn.cancel", "Cancel"]]), state: { flow: "add_business", step: "confirm", data }, action: "clarify" };
  }

  // -------------------------------------------------- listings (sell, hire, rent)

  private startListing(kindKey: string): ConnectReply {
    const kind = LISTING_KINDS[kindKey];
    const prompt = kind.intent === "recruiting" ? "Tell me the job, where it is, and the pay if you like."
      : kind.intent === "job_seeking" ? "Tell me the work you're looking for, and where."
        : kind.intent === "seeking" ? "Tell me what you're looking for, where, and your budget."
          : kind.category === "property" ? "Describe the place, the rent and where it is."
            : "Tell me what it is, the price and where. One message is fine.";
    return { reply: `${prompt}\nFor example: *${kind.example}*`, state: { flow: "listing", step: "details", data: { kind: kindKey } }, action: "clarify" };
  }

  private async listing(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const data = state.data;
    const kind = LISTING_KINDS[String(data.kind)] ?? LISTING_KINDS.sell;
    if (state.step === "details" || (state.step === "preview" && chose(text, "btn.edit", "edit", "change"))) {
      if (state.step === "preview") return this.startListing(String(data.kind));
      if (text.length < 3) return this.startListing(String(data.kind));
      const price = parsePrice(text);
      const place = parsePlace(text);
      const parsed = {
        ...data, source: text.slice(0, 1000), title: listingTitle(text), category: kind.category ?? categorise(text),
        priceText: price?.priceText ?? null, priceMin: price?.amount ?? null, currency: price?.currency ?? null,
        city: place.city, area: place.area,
      };
      if (!place.city) return { reply: "Which town is it in?", state: { flow: "listing", step: "city", data: parsed }, action: "clarify" };
      return this.previewListing(parsed);
    }
    if (state.step === "city") {
      const place = parsePlace(text);
      const city = place.city ?? (text.trim().split(/\s+/).length <= 3 ? text.trim().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()) : null);
      if (!city) return { reply: "Which town is it in? For example: *Harare*.", state, action: "clarify" };
      return this.previewListing({ ...data, city, area: place.area });
    }
    if (state.step === "preview") {
      if (chose(text, "btn.cancel", "cancel", ...NO)) return { reply: "Okay, I didn't post it.", interactive: buttons("Okay, I didn't post it.", [["btn.menu", "Main menu"]]), state: null, action: "answer" };
      if (!chose(text, "btn.post", "post it", "post", ...YES)) return this.previewListing(data);
      if (!context.identityId) return this.requireIdentity(state);
      const saved = await this.store.saveListing({
        intent: kind.intent, category: String(data.category), title: String(data.title), description: String(data.source ?? ""),
        priceText: typeof data.priceText === "string" ? data.priceText : null, priceMin: typeof data.priceMin === "number" ? data.priceMin : null,
        currency: typeof data.currency === "string" ? data.currency : null, city: typeof data.city === "string" ? data.city : null,
        area: typeof data.area === "string" ? data.area : null, phone: context.senderPhoneForListing ?? "", identityId: context.identityId,
        sourceText: String(data.source ?? ""), sourceMessageId: context.providerMessageId ?? `local:listing:${this.now().getTime()}`,
      });
      const credit = await this.store.addCredits(context.identityId, 1, "listing", saved.id);
      const demand = typeof data.city === "string" && kind.intent === "offering"
        ? await this.store.countSearches(data.city, String(data.category), 7).catch(() => 0) : 0;
      const lines = [
        `Posted. Your ${kind.noun} shows as *Pending check* until our team confirms it.`,
        ...(demand > 0 ? ["", `${demand} ${demand === 1 ? "person" : "people"} searched for ${String(data.category)} in ${data.city} this week.`] : []),
        "", `+1 credit · you now have ${credit.balance}`,
      ];
      const reply = lines.join("\n");
      return { reply, interactive: buttons(reply, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
    }
    return this.repeat(state);
  }

  private previewListing(data: Record<string, Scalar>): ConnectReply {
    const kind = LISTING_KINDS[String(data.kind)] ?? LISTING_KINDS.sell;
    const label = kind.intent === "recruiting" ? "Job" : kind.intent === "job_seeking" ? "Looking for" : kind.intent === "seeking" ? "Wanted" : "Item";
    const lines = [
      `Here's your ${kind.noun}:`, "",
      `${label}: *${data.title}*`,
      `${kind.intent === "seeking" ? "Budget" : kind.intent === "recruiting" ? "Pay" : "Price"}: ${data.priceText ?? "Not given"}`,
      `Where: ${[data.area, data.city].filter(Boolean).join(", ")}`,
      "Contact: this WhatsApp number",
    ];
    const body = lines.join("\n");
    return { reply: body, interactive: buttons(body, [["btn.post", "Post it"], ["btn.edit", "Edit"], ["btn.cancel", "Cancel"]]), state: { flow: "listing", step: "preview", data }, action: "clarify" };
  }

  private startSearch(kindKey: string): ConnectReply {
    const prompts: Record<string, string> = {
      buy: "What are you looking for? Add your town and budget if you like.\nFor example: *fridge in Harare under $300*",
      jobs: "What kind of work, and where?\nFor example: *driver in Harare*",
      houses: "Where, and what's your budget?\nFor example: *2 rooms in Avondale under $200*",
    };
    return { reply: prompts[kindKey], state: { flow: "listing_search", step: "query", data: { kind: kindKey } }, action: "clarify" };
  }

  private async listingSearch(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const kind = SEARCH_KINDS[String(state.data.kind)] ?? SEARCH_KINDS.buy;
    if (state.step === "results") {
      if (chose(text, "btn.request", "post a request", "post", ...YES)) {
        const source = String(state.data.query ?? "");
        const requestKind = LISTING_KINDS[kind.requestKind];
        const price = parsePrice(source);
        const place = parsePlace(source);
        const data = { kind: kind.requestKind, source, title: listingTitle(source), category: requestKind.category ?? categorise(source), priceText: price?.priceText ?? null, priceMin: price?.amount ?? null, currency: price?.currency ?? null, city: place.city, area: place.area };
        if (!place.city) return { reply: "Which town should it be in?", state: { flow: "listing", step: "city", data }, action: "clarify" };
        return this.previewListing(data);
      }
      if (chose(text, "btn.again", "search again", "again")) return this.startSearch(String(state.data.kind));
      // A different kind of request after the results ("accountant jobs" after a house search, "I'm selling my
      // phone") goes where it belongs; anything that is not about this kind of listing goes back to the coordinator.
      const natural = await this.naturalListing(text, context);
      if (natural) return natural;
      const sameKind = String(state.data.kind) === "houses" ? /\b(house|flat|room|cottage|apartment|stand|bed|rent|let|townhouse|cluster|garden)\b/i
        : String(state.data.kind) === "jobs" ? /\b(job|jobs|work|vacanc|post|position|role|officer|manager|assistant|driver|accountant|teacher|nurse)\b/i : null;
      if (sameKind && !sameKind.test(text) && !parsePrice(text) && !parsePlace(text).city) return { reply: "", state: null, action: "answer", pass: true };
      // "plumber in Avondale" after a car search is a business search, not something to buy.
      if (String(state.data.kind) === "buy" && !GOODS.test(text) && parseLocalSearchRequest(text)?.category && !parsePrice(text)) return { reply: "", state: null, action: "answer", pass: true };
    }
    const query = text.slice(0, 200);
    const place = parsePlace(query);
    const words = keywords(query).filter((word) => !SHOPPING_WORDS.has(word.toLocaleLowerCase()));
    // When the item is named ("Toyota Hilux"), the name decides; a broad category ("vehicles") would let any Toyota in.
    const category = kind.category ?? (words.length ? null : categorise(query) === "general" ? null : categorise(query));
    const budget = parsePrice(query);
    // For homes, a monthly-sized budget means renting; words like "buy" or "for sale" mean buying.
    const deal = kind.journey !== "houses" ? null
      : /\b(rent|to let|lease|per month|monthly|p\/m)\b/i.test(query) ? "rent"
      : /\b(buy|for sale|purchase|own)\b/i.test(query) ? "buy"
      : budget && budget.amount <= 15_000 ? "rent" : null;
    // A home search leaves out offices and shops unless they were asked for.
    const exclude = kind.journey === "houses" && !/\b(office|commercial|warehouse|industrial|shop|retail)\b/i.test(query) ? "\\m(office|offices|commercial|warehouse|industrial|shop|retail)\\M" : null;
    let results = await this.store.searchListings({ intents: kind.intents, words, category, city: place.city, area: place.area, maxPrice: budget?.amount ?? null, deal, exclude, limit: 5 });
    // Nothing in that town: show what there is elsewhere rather than nothing (a car or a job can travel).
    let elsewhere = false;
    if (!results.length && place.city && kind.journey !== "houses" && words.length) {
      // Elsewhere, only listings that name the thing itself count, not anything in the same broad category.
      results = await this.store.searchListings({ intents: kind.intents, words, category: null, city: null, area: null, maxPrice: budget?.amount ?? null, deal, exclude, limit: 5 });
      elsewhere = results.length > 0;
    }
    await this.store.logSearch({ identityId: context.identityId, journey: kind.journey, category: category ?? words[0] ?? null, city: place.city, area: place.area, queryText: clip(query, 200), resultCount: results.length, sourceMessageId: context.providerMessageId ? `${context.providerMessageId}:${kind.journey}` : null }).catch(() => undefined);
    const nextState: ConnectJourneyState = { flow: "listing_search", step: "results", data: { kind: String(state.data.kind), query } };
    const requestLabel = kind.journey === "jobs" ? "Post I'm available" : "Post a request";
    if (!results.length && kind.journey === "buy_sell" && words.length) {
      // No one is selling it second-hand: point to shops that sell it, from Benita's directory.
      const shops = await this.store.benitaSearch({ text: words.join(" "), city: place.city, limit: 3, kinds: ["place"] }).catch(() => []);
      if (shops.length) {
        const body = [`Nobody has posted ${clip(words.join(" "), 30)}${place.city ? ` in ${place.city}` : ""} for sale yet. These shops may have it:`, "", ...shops.map((shop, index) => benitaLine(shop, index)), "", "Or post a request and sellers can find you."].join("\n");
        return { reply: body, interactive: buttons(body, [["btn.request", requestLabel], ["btn.again", "Search again"], ["btn.menu", "Main menu"]]), state: nextState, action: "answer" };
      }
    }
    if (!results.length) {
      const body = `${kind.empty}${place.city ? ` in ${place.city}` : ""}. Want me to post a request so people can find you?`;
      return { reply: body, interactive: buttons(body, [["btn.request", requestLabel], ["btn.again", "Search again"], ["btn.menu", "Main menu"]]), state: nextState, action: "answer" };
    }
    const where = place.area ? ` in ${place.area}` : place.city ? ` in ${place.city}` : "";
    const overBudget = budget && results.every((item) => item.withinBudget === false);
    const lines = [elsewhere ? `Nothing in ${place.city} yet. Here's what I found in other towns:` : overBudget ? `Nothing at about ${budget!.priceText}${where} yet. Here are the closest I found:` : `Here's what I found${where}:`, "", ...results.map(listingLine), "", results.some((item) => item.sourceUrl) ? "Listings come from the community and public websites. Always see an item before you pay." : "Listings come from the community. Always see an item before you pay."];
    const reply = lines.join("\n");
    return { reply, interactive: buttons(reply.length > 1000 ? `${results.length} results found. See the message above.` : reply, [["btn.request", requestLabel], ["btn.again", "Search again"], ["btn.menu", "Main menu"]]), state: nextState, action: "answer" };
  }

  // ------------------------------------------------------------ area pulse

  private async startArea(context: ConnectContext, typed: string | null): Promise<ConnectReply> {
    const city = (typed ? parsePlace(typed).city : null) ?? (context.identityId ? await this.store.lastCity(context.identityId) : null);
    if (!city) {
      const body = "Which town should I show? Tap one or type another.";
      return { reply: body, interactive: buttons(body, [["town:Harare", "Harare"], ["town:Bulawayo", "Bulawayo"], ["town:Chinhoyi", "Chinhoyi"]]), state: { flow: "area", step: "town", data: {} }, action: "start_journey" };
    }
    return await this.pulse(city, context);
  }

  private async area(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const tapped = /^town:(.+)$/.exec(text.trim())?.[1];
    if (state.step === "shown") {
      if (tapped) return await this.pulse(tapped, context);
      if (chose(text, "btn.change_area", "change area", "change")) {
        const body = "Which town should I show? Tap one or type another.";
        return { reply: body, interactive: buttons(body, [["town:Harare", "Harare"], ["town:Bulawayo", "Bulawayo"], ["town:Chinhoyi", "Chinhoyi"]]), state: { flow: "area", step: "town", data: {} }, action: "clarify" };
      }
      // A question about prices, money, news or the town is a conversation with Community intelligence.
      const city = String(state.data.city ?? "Harare");
      const moment = momentOf(text);
      if (moment === "thanks" || moment === "goodbye" || moment === "smalltalk_weather") {
        const line = voiceLine(moment, context.assistantName, firstNameOf(context.profileName)) ?? "Anytime!";
        const body = moment === "goodbye" ? line : `${line}\n\nAnything else you want to know about ${city}?`;
        return { reply: body, interactive: buttons(body, [["btn.change_area", "Change area"], ["btn.menu", "Main menu"]]), state, action: "answer" };
      }
      if (isIntelligenceQuestion(text)) return await this.intelligenceAnswer(text, city, context, state);
      // Anything else is a new request for the coordinator.
      return { reply: "", state: null, action: "answer", pass: true };
    }
    const city = tapped ?? parsePlace(text).city ?? (text.trim().split(/\s+/).length <= 3 && /^[\p{L}\s'-]+$/u.test(text.trim()) ? text.trim().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()) : null);
    if (!city) return { reply: "Which town? For example: *Harare*.", state: { flow: "area", step: "town", data: {} }, action: "clarify" };
    return await this.pulse(city, context);
  }

  /**
   * Everyday phrasing for the market flows: "I'm selling my iPhone 13 for $450 in Harare" starts a listing,
   * "2 bedroom flat in Avondale under $800" searches homes, "accountant jobs" searches jobs, "cheap Toyota Hilux
   * in Bulawayo" searches items for sale. Returns null for anything else.
   */
  async naturalListing(message: string, context: ConnectContext): Promise<ConnectReply | null> {
    const text = message.trim();
    if (text.length < 4 || text.length > 300) return null;
    const property = /\b(house|houses|flat|flats|room|rooms|cottage|apartment|stand|townhouse|cluster|bedroom|bedroomed|\d\s?-?bed|bed ?sitter|accommodation to rent|place to (?:rent|stay))\b/i;
    const goods = GOODS;
    const selling = /^(?:i'?m |i am |we'?re |we are )?(?:selling|sell(?:ing)? my|for sale[:,]?)\b|\bi (?:want|would like|wanna) to sell\b/i;
    const lettingOut = /\b(?:i'?m |i am |we'?re )?(?:renting out|letting out)\b|^to let\b/i;
    const hiring = /\b(?:we'?re hiring|i'?m hiring|we are hiring|looking to hire|need to hire|i want to hire|vacancy at my)\b/i;
    const strip = (value: string) => value.replace(/^(?:i'?m |i am |we'?re |we are )?(?:selling|renting out|letting out)\s+(?:my |our |a |an )?/i, "").replace(/^i (?:want|would like|wanna) to sell\s+(?:my |our |a |an )?/i, "").replace(/^for sale[:,]?\s*/i, "");
    if (hiring.test(text)) return await this.listing({ flow: "listing", step: "details", data: { kind: "hire" } }, text.replace(hiring, "").trim() || text, context);
    if (lettingOut.test(text)) return await this.listing({ flow: "listing", step: "details", data: { kind: "rent_out" } }, strip(text), context);
    if (selling.test(text)) return await this.listing({ flow: "listing", step: "details", data: { kind: property.test(text) ? "rent_out" : "sell" } }, strip(text), context);
    if (/\b(jobs?|vacanc(?:y|ies)|employment|internships?|graduate trainee)\b/i.test(text) && !/\b(job seekers?|cv|my cv)\b/i.test(text)) {
      return await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "jobs" } }, text, context);
    }
    // A place to live is a listing search only when it sounds like one: a budget, renting or buying, or bedrooms.
    if (property.test(text) && !/\b(agents?|agency|agencies|valuers?|builders?|painters?|plumbers?|cleaners?|security|my house|our house|flood\w*|leak\w*|broken|fire)\b/i.test(text) && (parsePrice(text) || /\b(rent|renting|to let|for rent|lease|buy|buying|for sale|bedroom|bed|rooms)\b/i.test(text))) {
      return await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "houses" } }, text, context);
    }
    // "phone shops", "car repairs", "Toyota dealer" are businesses to find, not items to buy.
    const business = /\b(shops?|stores?|repairs?|dealers?|dealerships?|showrooms?|spares|services?|fix|fixing|mechanics?|garages?|agents?|hire|rental company|insurance|wash)\b/i;
    // Goods are a search only with a reason to buy: a price, "for sale", "cheap", "second hand"... never "my car won't start".
    if (goods.test(text) && !business.test(text) && !/\b(my|our|won'?t|doesn'?t|broke|broken|stolen|accident|stuck)\b/i.test(text) && (parsePrice(text) || /\b(for sale|buy|buying|cheap|second hand|ex ?japan|used|selling|price of|prices?)\b/i.test(text))) {
      return await this.listingSearch({ flow: "listing_search", step: "query", data: { kind: "buy" } }, text, context);
    }
    return null;
  }

  /**
   * Wisdom's brain: a free, considered answer to an open question, from everything TrustHub knows about the place.
   * Returns null only when there is no data at all and no AI, so the caller can fall back.
   */
  async brainAnswer(question: string, context: ConnectContext, earlier?: { question: string; answer: string; city: string } | null): Promise<ConnectReply | null> {
    const city = parsePlace(question).city ?? earlier?.city ?? (context.identityId ? await this.store.lastCity(context.identityId).catch(() => null) : null) ?? "Harare";
    const reference = `${context.providerMessageId ?? `local:brain:${this.now().getTime()}`}:brain`;
    // A follow-up carries the last exchange, so "what about Bulawayo?" or "tell me more" continues the conversation.
    const asked = earlier ? `Earlier in this chat they asked: "${clip(earlier.question, 200)}" and you answered: "${clip(earlier.answer.replace(/\s+/g, " "), 500)}". Their follow-up now: ${question}` : question;
    const worded = this.answerer ? await this.answerer(asked, city, reference, context.assistantName).catch(() => null) : null;
    let body: string;
    if (worded) body = clipText(worded, 1600);
    else {
      const [pulse, signals, news] = await Promise.all([
        this.store.areaPulse(city, 30).catch(() => null),
        this.store.signals ? this.store.signals(city).catch(() => null) : Promise.resolve(null),
        this.store.news ? this.store.news({ text: question, town: city, limit: 3 }).catch(() => []) : Promise.resolve([]),
      ]);
      // A follow-up to advice ("what about Bulawayo?") is still advice, for the new place.
      const basis = earlier && isAdviceQuestion(earlier.question) ? `${earlier.question} ${question}` : question;
      body = brainFallback(basis, city, pulse, signals, news);
      // Without the AI and without any matching data, say nothing here: the normal "try this" help is more useful.
      if (body.startsWith("I haven't seen anything") && !isAdviceQuestion(basis)) return null;
    }
    const reply = `${body}\n\n_Ask me a follow-up, or tap Community intelligence for ${city}'s latest._`;
    return { reply, interactive: buttons(reply, [["menu.area", "Community intel"], ["menu.find", "Find a business"], ["btn.menu", "Main menu"]]), state: { flow: "brain", step: "followup", data: { question: clip(question, 300), answer: clip(body, 900), city } }, action: "answer" };
  }

  /** The reply to "what should I call you?": a name is saved; Skip or a real request moves on. */
  private async nameStep(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const after = String(state.data.after ?? "menu");
    const next = after === "review" ? "Thanks again for the review!" : after === "profile" ? "Your profile is updated." : "What would you like to do?";
    if (chose(text, "btn.skip", "skip", "later", "not now", ...NO)) {
      if (context.identityId) await this.store.markNameAsked?.(context.identityId).catch(() => undefined);
      const body = `No problem. ${next}`;
      return { reply: after === "menu" ? `${body}\n\n${menuText()}` : body, interactive: after === "menu" ? menuInteractive(body) : buttons(body, [["btn.menu", "Main menu"]]), state: null, action: after === "menu" ? "show_menu" : "answer" };
    }
    const name = plausibleName(text);
    if (!name || !context.identityId) {
      if (context.identityId) await this.store.markNameAsked?.(context.identityId).catch(() => undefined);
      // Not a name: treat it as a fresh message (a menu number, a search, a question).
      return (await this.handle(text, context, null)) ?? { reply: "", state: null, action: "answer", pass: true };
    }
    await this.store.savePersonName?.(context.identityId, name).catch(() => undefined);
    const body = `Nice to meet you, ${name}! You're saved, so I'll recognise you next time. ${next}`;
    return { reply: after === "menu" ? `${body}\n\n${menuText()}` : body, interactive: after === "menu" ? menuInteractive(body) : buttons(body, [["menu.review", "Review another"], ["btn.menu", "Main menu"]]), state: null, action: after === "menu" ? "show_menu" : "answer" };
  }

  /** After a brain answer: a follow-up continues the conversation; anything else is a new request. */
  private async brainFollowUp(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const followUp = /^(?:what about|how about|and (?:in|for|what|how)|also|more|tell me more|go on|why|explain|elaborate|what else|anything else|which (?:one|is)|how (?:much|many|long|do|can)|is (?:it|that|there)|are there|should i|can i|ok(?:ay)?,? (?:what|how|and))\b/i.test(text.trim())
      || isOpenQuestion(text) || isIntelligenceQuestion(text);
    if (!followUp || parseLocalSearchRequest(text)?.category && !isAdviceQuestion(text) && !/^(?:what about|how about)\b/i.test(text.trim())) return { reply: "", state: null, action: "answer", pass: true };
    const earlier = { question: String(state.data.question ?? ""), answer: String(state.data.answer ?? ""), city: String(state.data.city ?? "Harare") };
    return await this.brainAnswer(text, context, earlier) ?? { reply: "", state: null, action: "answer", pass: true };
  }

  /** A free answer in Community intelligence, from Benita's news, facts and signals; the AI words it when it is available. */
  private async intelligenceAnswer(question: string, city: string, context: ConnectContext, state: ConnectJourneyState): Promise<ConnectReply> {
    const [news, signals] = await Promise.all([
      this.store.news ? this.store.news({ text: question, town: city, limit: 4 }).catch(() => []) : Promise.resolve([]),
      this.store.signals ? this.store.signals(city).catch(() => null) : Promise.resolve(null),
    ]);
    const reference = `${context.providerMessageId ?? `local:intel:${this.now().getTime()}`}:intel`;
    const worded = this.answerer ? await this.answerer(question, city, reference, context.assistantName).catch(() => null) : null;
    const body = `${worded ? clipText(worded, 1400) : intelligenceFallback(question, city, signals, news)}\n\n_Ask another, or tap Main menu._`;
    return { reply: body, interactive: buttons(body, [["btn.change_area", "Change area"], ["btn.menu", "Main menu"]]), state, action: "answer" };
  }

  private async pulse(city: string, context?: ConnectContext): Promise<ConnectReply> {
    const [pulse, signals, news] = await Promise.all([
      this.store.areaPulse(city, 7).catch(() => null),
      this.store.signals ? this.store.signals(city).catch(() => null) : Promise.resolve(null),
      this.store.news ? this.store.news({ town: city, topics: ["prices", "fuel", "money", "power_water", "jobs", "housing", "transport", "scams", "council"], limit: 3 }).catch(() => []) : Promise.resolve([]),
    ]);
    const firstName = firstNameOf(context?.profileName);
    const greeting = `Hey${firstName ? ` ${firstName}` : ""}! ${context?.assistantName ?? "Wisdom"} here with the latest 👇`;
    const reply = intelligenceBrief(city, greeting, signals, news, pulse);
    return { reply, interactive: buttons(reply.length > 1024 ? `That's ${city} right now. Ask me anything, or pick an option.` : reply, [["btn.change_area", "Change area"], ["btn.menu", "Main menu"]]), state: { flow: "area", step: "shown", data: { city } }, action: "answer" };
  }

  // ------------------------------------------------------------ scam check

  private async scam(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply> {
    const phone = typeof state.data.phone === "string" ? state.data.phone : null;
    if (state.step === "result" && phone) {
      if (chose(text, "btn.report", "report", "report it", "report it too", "report this number")) {
        return { reply: "What happened? One or two sentences, please. Don't include anyone's personal details.", state: { flow: "scam", step: "reason", data: { phone } }, action: "clarify" };
      }
      if (chose(text, "btn.check_another", "check another", "another")) return { reply: "Send the next number you want to check.", state: { flow: "scam", step: "number", data: {} }, action: "clarify" };
    }
    if (state.step === "reason" && phone) {
      if (!context.identityId) return this.requireIdentity(state);
      if (text.length < 3) return { reply: "Please tell me briefly what happened.", state, action: "clarify" };
      const outcome = await this.store.saveScamReport({ phone, reason: text.slice(0, 300), identityId: context.identityId, sourceMessageId: context.providerMessageId ?? `local:scam:${this.now().getTime()}` });
      const reply = outcome === "already_reported"
        ? `You've already reported ${maskPhone(phone)}. Thank you for looking out for others.`
        : "Thanks. Your report helps protect others. We never share who reported a number.";
      return { reply, interactive: buttons(reply, [["btn.check_another", "Check another"], ["btn.menu", "Main menu"]]), state: { flow: "scam", step: "result", data: { phone } }, action: "answer" };
    }
    const checked = parseCheckedPhone(text);
    if (!checked && state.step === "result") return { reply: "", state: null, action: "answer", pass: true };
    if (!checked) return { reply: "That doesn't look like a phone number. Send it like *0771 234 567*.", state: { flow: "scam", step: "number", data: {} }, action: "clarify" };
    return await this.scamResult(checked);
  }

  private async scamResult(phone: string): Promise<ConnectReply> {
    const summary = await this.store.scamSummary(phone, 90);
    const masked = maskPhone(phone);
    let reply: string;
    let options: [string, string][];
    if (summary.reports > 0) {
      reply = [
        "*Be careful*",
        `${masked} was reported by ${summary.reports} ${summary.reports === 1 ? "person" : "people"} in the last 90 days.`,
        ...(summary.reasons.length ? ["", ...summary.reasons.map((reason) => `• ${clip(reason, 120)}`)] : []),
        "", "*Safer way:* meet in a public place and see the item before you pay anything.",
      ].join("\n");
      options = [["btn.report", "Report it too"], ["btn.check_another", "Check another"], ["btn.menu", "Main menu"]];
    } else {
      reply = [`*No reports found* for ${masked}.`, "That doesn't prove it's safe. It just means nobody has reported it yet.", "", "Never send a deposit to someone you haven't met."].join("\n");
      options = [["btn.report", "Report this number"], ["btn.check_another", "Check another"], ["btn.menu", "Main menu"]];
    }
    return { reply, interactive: buttons(reply, options), state: { flow: "scam", step: "result", data: { phone } }, action: "answer" };
  }

  // ------------------------------------------------------------ Ask Wisdom

  private async ask(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply | null> {
    if (state.step === "question") {
      if (isFeedbackCue(text)) return await this.recordFeedback(text, context);
      // A plain search is always free, so the coordinator answers it as a search.
      if (isSearchLike(text)) return { reply: "", state: null, action: "answer", pass: true };
      // "Yes" or "ok" is not a question yet.
      if (text.trim().length < 8 || chose(text, "yes", ...YES, ...NO)) return { reply: "Go ahead, what's your question? For example: *What's the best area in Harare to open a hardware shop?*", state, action: "clarify" };
      if (!this.answerer || !context.identityId) return this.deepUnavailable();
      const balance = await this.store.creditBalance(context.identityId);
      if (balance < 1) {
        const body = "You're out of credits. You earn 1 free credit for every review, business or listing you add.";
        return { reply: body, interactive: buttons(body, [["menu.review", "Rate or review"], ["menu.add_business", "Add a business"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
      }
      const body = `That's a deep question. It uses *1 credit*, and you're only charged if I answer. You have ${balance}.`;
      return { reply: body, interactive: buttons(body, [["btn.use_credit", "Use 1 credit"], ["btn.cancel", "Cancel"]]), state: { flow: "ask", step: "confirm", data: { question: text.slice(0, 500) } }, action: "clarify" };
    }
    if (state.step === "confirm") {
      // A new question typed instead of tapping a button replaces the old one (and is confirmed again).
      if (text.trim().length >= 12 && !chose(text, "btn.use_credit", "use 1 credit", "use credit", ...YES) && !chose(text, "btn.cancel", "cancel", ...NO)) return await this.ask({ flow: "ask", step: "question", data: {} }, text, context);
      if (!chose(text, "btn.use_credit", "use 1 credit", "use credit", ...YES)) return { reply: "Okay, no credit used.", interactive: buttons("Okay, no credit used.", [["btn.menu", "Main menu"]]), state: null, action: "answer" };
      if (!this.answerer || !context.identityId) return this.deepUnavailable();
      const reference = context.providerMessageId ?? `local:ask:${this.now().getTime()}`;
      const question = String(state.data.question ?? "");
      const city = parsePlace(question).city ?? await this.store.lastCity(context.identityId);
      // Answer first, then charge: a failed answer never costs a credit, so no refund is needed.
      const answer = await this.answerer(question, city, reference, context.assistantName).catch(() => null);
      if (!answer) {
        const body = "I couldn't work that one out just now, so nothing was charged. Try again in a bit, or ask it as a simple search, like *plumber in Avondale*.";
        return { reply: body, interactive: buttons(body, [["menu.find", "Find a business"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
      }
      const spent = await this.store.addCredits(context.identityId, -1, "deep_question", reference);
      const reply = `${clipText(answer, 1500)}\n\n_From TrustHub data. ${spent.balance} ${spent.balance === 1 ? "credit" : "credits"} left._`;
      return { reply, interactive: buttons(reply, [["menu.ask", "Ask another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
    }
    return this.repeat(state);
  }

  private deepUnavailable(): ConnectReply {
    const body = "Wisdom's deep answers are resting right now, so nothing was charged. Simple searches still work, like *plumber in Avondale*.";
    return { reply: body, interactive: buttons(body, [["menu.find", "Find a business"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
  }

  /** Light replies to thanks, goodbyes, small talk and requests for a joke. */
  private socialReply(message: string, context: ConnectContext): ConnectReply | null {
    const name = context.assistantName;
    const firstName = firstNameOf(context.profileName);
    const menu: [string, string][] = [["menu.find", "Find a business"], ["btn.menu", "Main menu"]];
    const moment = momentOf(message);
    // "Thanks" and "sorted" can answer a question in progress, so the coordinator decides those.
    if (!moment || moment === "thanks" || moment === "solved") return null;
    if (moment === "goodbye") return { reply: voiceLine("goodbye", name, firstName) ?? goodbyeLine(), state: null, action: "answer" };
    const fallback = moment === "light_joke" ? humourLine(name, message.length) : moment === "smalltalk_weather" ? smalltalkLine(name) : null;
    const line = voiceLine(moment, name, firstName);
    if (!line && !fallback) return null;
    // One question per message: a line that already asks something isn't followed by another question.
    const asks = !!line && /\?\s*(?:🙂|❤️)?\s*$/.test(line);
    const intro = !!line && !line.includes(name) && (moment === "light_joke" || moment === "smalltalk_weather") ? ` I'm ${name}, by the way.` : "";
    const body = line ? `${line}${asks ? (intro ? `\n\n${intro.trim()}` : "") : `\n\n${intro.trim() ? `${intro.trim()} ` : ""}What can I find for you?`}` : fallback!;
    return { reply: body, interactive: buttons(body, menu), state: null, action: "answer" };
  }

  // ------------------------------------------------------- profile & feedback

  private async profile(context: ConnectContext): Promise<ConnectReply> {
    if (!context.identityId) return this.requireIdentity(null);
    const [balance, activity, person] = await Promise.all([
      this.store.creditBalance(context.identityId), this.store.activity(context.identityId),
      this.store.personSummary ? this.store.personSummary(context.identityId).catch(() => null) : Promise.resolve(null),
    ]);
    const name = person?.name ?? context.profileName;
    const since = person?.joinedAt ? new Date(person.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Harare" }) : null;
    const searches = (person?.recentSearches ?? []).filter((item) => item.text.trim());
    const reply = [
      `*${name ? `${name}'s` : "Your"} TrustHub profile*`, "",
      `Name: ${name ?? "Not set yet (reply *my name is ...* to add it)"}`,
      ...(since ? [`With TrustHub since: ${since}`] : []),
      `Credits: ${balance}`,
      `Reviews: ${activity.reviews} · Listings: ${activity.listings} · Businesses added: ${activity.businesses}`,
      ...(searches.length ? ["", "*Your recent searches*", ...searches.map((item) => `• ${clip(item.text, 50)}${item.city ? ` · ${item.city}` : ""}`)] : []),
      ...(person?.agent ? ["", `Invited by ${person.agent}, a TrustHub agent.`] : []),
      "", "Earn 1 free credit for every review, business or listing you add. Credits are used for deep questions in Ask Wisdom.",
    ].join("\n");
    return { reply, interactive: buttons(reply, [["btn.change_name", name ? "Change my name" : "Add my name"], ["btn.feedback", "Send feedback"], ["btn.menu", "Main menu"]]), state: { flow: "feedback", step: "offer", data: {} }, action: "answer" };
  }

  /** Saves feedback in one step when the message already says what the problem is. */
  private async recordFeedback(message: string, context: ConnectContext): Promise<ConnectReply> {
    if (!context.identityId) return this.requireIdentity(null);
    await this.store.saveFeedback({ message: message.slice(0, 1000), identityId: context.identityId });
    const body = "Thanks, that's noted. The TrustHub team reads every message, and it's how I get better.";
    return { reply: body, interactive: buttons(body, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
  }

  private askFeedback(): ConnectReply {
    return { reply: "What should we improve? Tell me in one message.", state: { flow: "feedback", step: "message", data: {} }, action: "clarify" };
  }

  private async feedback(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply | null> {
    if (chose(text, "btn.feedback", "send feedback", "feedback")) return this.askFeedback();
    if (chose(text, "btn.change_name", "change my name", "add my name", "change name")) return { reply: "What should I call you? Type your first name.", state: { flow: "name", step: "ask", data: { after: "profile" } }, action: "clarify" };
    // On the profile screen, a typed message that isn't "Send feedback" is a new request.
    if (state.step === "offer") return { reply: "", state: null, action: "answer", pass: true };
    if (!context.identityId) return this.requireIdentity(null);
    if (text.length < 3) return this.askFeedback();
    await this.store.saveFeedback({ message: text.slice(0, 1000), identityId: context.identityId });
    const reply = "Thanks. The TrustHub team reads every message.";
    return { reply, interactive: buttons(reply, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
  }
}

