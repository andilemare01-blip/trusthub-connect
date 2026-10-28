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
import { categorise, keywords, listingTitle, maskPhone, parseCardCode, parseCheckedPhone, parsePlace, parsePrice } from "./parse.ts";
import type { ConnectStore, DirectoryBusiness, Listing, ListingIntent } from "./store.ts";

export type ConnectFlow = "review" | "add_business" | "listing" | "listing_search" | "buy_sell" | "jobs" | "houses" | "area" | "scam" | "ask" | "feedback";
type Scalar = string | number | boolean | null;
export interface ConnectJourneyState { flow: ConnectFlow; step: string; data: Record<string, Scalar> }

export interface ConnectContext {
  identityId: string | null;
  profileName: string | null;
  providerMessageId: string | null;
  assistantName: string;
  /** The sender's own number; stored on listings they post so buyers can reach them. */
  senderPhoneForListing?: string | null;
}

/** Answers a deep question from TrustHub data; null when it could not answer. Injected so tests need no AI. */
export type DeepQuestionAnswerer = (question: string, city: string | null, key: string) => Promise<string | null>;

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
const RESULT_SCREENS = new Set(["listing_search.results", "area.shown", "scam.result", "feedback.offer", "add_business.review_existing"]);

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

function waLink(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "");
  return digits && digits.length >= 8 ? `wa.me/${digits}` : null;
}

function listingLine(listing: Listing, index: number): string {
  const checked = listing.status === "approved" ? "Checked" : "Not yet checked";
  const facts = [listing.priceText, [listing.area, listing.city].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ");
  const contact = waLink(listing.phone);
  return `${index + 1}. *${clip(listing.title, 60)}*${facts ? ` · ${facts}` : ""}\n   ${contact ? `Contact: ${contact} · ` : ""}${checked}`;
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
      if (/^(?:feedback|suggestion|complaint)\b/i.test(message)) return this.askFeedback();
      if (/\b(?:my (?:credits|profile|account|balance)|create (?:a |my )?(?:profile|account)|sign ?up|register)\b/i.test(message)) return await this.profile(context);
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
    const firstName = context.profileName?.trim().split(/\s+/)[0];
    const body = returning
      ? `${greeted ? `Welcome back${firstName ? `, ${firstName}` : ""}! ` : ""}It's ${context.assistantName}. What would you like to do?`
      : `Hi, I'm ${context.assistantName}. I help you find trusted businesses, buy and sell, and see what's happening around you.\n\nWhat would you like to do?`;
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
        const body = "Which business would you like to review? Send its name, and the town if you know it.\nFor example: *Sunny Bakery, Chinhoyi*";
        return { reply: body, state: { flow: "review", step: "which", data: {} }, action: "start_journey" };
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
        const deep = this.answerer ? `\n\nSimple searches are always free. Deep questions use 1 credit (you have ${balance}).` : "";
        return { reply: `Ask me anything about businesses, prices or your area.${deep}`, state: { flow: "ask", step: "question", data: {} }, action: "start_journey" };
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
        if (chose(text, "btn.buy", "buying", "i'm looking", "buy", "looking")) return this.startSearch("buy");
        return { reply: "Tap *I'm selling* or *I'm looking*, or type MENU to go back.", interactive: buttons("Are you buying or selling?", [["btn.sell", "I'm selling"], ["btn.buy", "I'm looking"]]), state, action: "clarify" };
      case "jobs":
        if (chose(text, "btn.find_work", "find work", "work", "job", "looking for work")) return this.startSearch("jobs");
        if (chose(text, "btn.hire", "i'm hiring", "hiring", "hire")) return this.startListing("hire");
        return { reply: "Tap *Find work* or *I'm hiring*, or type MENU to go back.", interactive: buttons("Are you looking for work, or hiring?", [["btn.find_work", "Find work"], ["btn.hire", "I'm hiring"]]), state, action: "clarify" };
      case "houses":
        if (chose(text, "btn.find_place", "find a place", "find", "looking")) return this.startSearch("houses");
        if (chose(text, "btn.list_place", "list a place", "list", "offering", "rent out")) return this.startListing("rent_out");
        return { reply: "Tap *Find a place* or *List a place*, or type MENU to go back.", interactive: buttons("Are you looking for a place, or offering one?", [["btn.find_place", "Find a place"], ["btn.list_place", "List a place"]]), state, action: "clarify" };
      case "listing": return await this.listing(state, text, context);
      case "listing_search": return await this.listingSearch(state, text, context);
      case "area": return await this.area(state, text);
      case "scam": return await this.scam(state, text, context);
      case "ask": return await this.ask(state, text, context);
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
      const reply = lines.join("\n");
      return { reply, interactive: buttons(reply, [["menu.review", "Review another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
    }
    return this.repeat(state);
  }

  private async findForReview(text: string, context: ConnectContext): Promise<ConnectReply> {
    const place = parsePlace(text);
    let name = text;
    for (const value of [place.area, place.city]) if (value) name = name.replace(new RegExp(`\\s*(?:,|\\bin\\b|\\bat\\b)?\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
    name = name.replace(/\s+/g, " ").replace(/[,.\s]+$/, "").trim();
    if (name.length < 2) return { reply: "What's the business called?", state: { flow: "review", step: "which", data: {} }, action: "clarify" };
    const found = await this.store.searchDirectory(name, place.city, 5);
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
        const duplicates = await this.store.searchDirectory(String(data.name), typeof data.city === "string" ? data.city : null, 3);
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
      // Any other text is treated as a new search of the same kind.
    }
    const query = text.slice(0, 200);
    const place = parsePlace(query);
    const words = keywords(query);
    const category = kind.category ?? (categorise(query) === "general" ? null : categorise(query));
    const results = await this.store.searchListings({ intents: kind.intents, words, category, city: place.city, limit: 5 });
    await this.store.logSearch({ identityId: context.identityId, journey: kind.journey, category: category ?? words[0] ?? null, city: place.city, area: place.area, queryText: clip(query, 200), resultCount: results.length, sourceMessageId: context.providerMessageId ? `${context.providerMessageId}:${kind.journey}` : null }).catch(() => undefined);
    const nextState: ConnectJourneyState = { flow: "listing_search", step: "results", data: { kind: String(state.data.kind), query } };
    const requestLabel = kind.journey === "jobs" ? "Post I'm available" : "Post a request";
    if (!results.length) {
      const body = `${kind.empty}${place.city ? ` in ${place.city}` : ""}. Want me to post a request so people can find you?`;
      return { reply: body, interactive: buttons(body, [["btn.request", requestLabel], ["btn.again", "Search again"], ["btn.menu", "Main menu"]]), state: nextState, action: "answer" };
    }
    const lines = [`Here's what people have posted${place.city ? ` in ${place.city}` : ""}:`, "", ...results.map(listingLine), "", "Listings come from the community. Always see an item before you pay."];
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
    return await this.pulse(city);
  }

  private async area(state: ConnectJourneyState, text: string): Promise<ConnectReply> {
    const tapped = /^town:(.+)$/.exec(text.trim())?.[1];
    if (state.step === "shown") {
      if (tapped) return await this.pulse(tapped);
      if (chose(text, "btn.change_area", "change area", "change")) {
        const body = "Which town should I show? Tap one or type another.";
        return { reply: body, interactive: buttons(body, [["town:Harare", "Harare"], ["town:Bulawayo", "Bulawayo"], ["town:Chinhoyi", "Chinhoyi"]]), state: { flow: "area", step: "town", data: {} }, action: "clarify" };
      }
      // Anything else after the pulse is a new request for the coordinator.
      return { reply: "", state: null, action: "answer", pass: true };
    }
    const city = tapped ?? parsePlace(text).city ?? (text.trim().split(/\s+/).length <= 3 && /^[\p{L}\s'-]+$/u.test(text.trim()) ? text.trim().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()) : null);
    if (!city) return { reply: "Which town? For example: *Harare*.", state: { flow: "area", step: "town", data: {} }, action: "clarify" };
    return await this.pulse(city);
  }

  private async pulse(city: string): Promise<ConnectReply> {
    const pulse = await this.store.areaPulse(city, 7);
    const sections: string[] = [`*${city} this week*`];
    if (pulse.topSearches.length) sections.push(["", "*Most searched*", ...pulse.topSearches.map((item, index) => `${index + 1}. ${item.label} · ${item.count} ${item.count === 1 ? "search" : "searches"}`)].join("\n"));
    if (pulse.notFound.length) sections.push(["", "*Asked for, but not found*", ...pulse.notFound.map((item) => `• ${item.label} · ${item.count} ${item.count === 1 ? "time" : "times"}`), "People want these and nobody is listed. That's a business opportunity."].join("\n"));
    if (pulse.newBusinesses || pulse.newListings) sections.push(["", "*New near you*", `${pulse.newBusinesses} new ${pulse.newBusinesses === 1 ? "business" : "businesses"} · ${pulse.newListings} new ${pulse.newListings === 1 ? "listing" : "listings"}`].join("\n"));
    if (pulse.typicalPrices.length) sections.push(["", "*Typical prices*", ...pulse.typicalPrices.map((item) => `• ${item.label}: ${item.currency === "USD" ? "$" : `${item.currency} `}${Math.round(item.median)} (from ${item.samples} listings)`)].join("\n"));
    if (sections.length === 1) sections.push("", `It's early days for ${city}: there aren't enough searches yet this week to show trends. Every search people make helps build this picture.`);
    else sections.push("", `_Based on TrustHub searches and listings in ${city} over the last 7 days._`);
    const reply = sections.join("\n");
    return { reply, interactive: buttons(reply, [["btn.change_area", "Change area"], ["btn.menu", "Main menu"]]), state: { flow: "area", step: "shown", data: { city } }, action: "answer" };
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
      if (!this.answerer || !context.identityId) return { reply: "", state: null, action: "answer", pass: true };
      const balance = await this.store.creditBalance(context.identityId);
      if (balance < 1) {
        const body = "You're out of credits. You earn 1 free credit for every review, business or listing you add.";
        return { reply: body, interactive: buttons(body, [["menu.review", "Rate or review"], ["menu.add_business", "Add a business"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
      }
      const body = `That's a deep question. It uses *1 credit*. You have ${balance}.`;
      return { reply: body, interactive: buttons(body, [["btn.use_credit", "Use 1 credit"], ["btn.cancel", "Cancel"]]), state: { flow: "ask", step: "confirm", data: { question: text.slice(0, 500) } }, action: "clarify" };
    }
    if (state.step === "confirm") {
      if (!chose(text, "btn.use_credit", "use 1 credit", "use credit", ...YES)) return { reply: "Okay, no credit used.", interactive: buttons("Okay, no credit used.", [["btn.menu", "Main menu"]]), state: null, action: "answer" };
      if (!this.answerer || !context.identityId) return { reply: "", state: null, action: "answer", pass: true };
      const reference = context.providerMessageId ?? `local:ask:${this.now().getTime()}`;
      const question = String(state.data.question ?? "");
      const city = parsePlace(question).city ?? await this.store.lastCity(context.identityId);
      const spent = await this.store.addCredits(context.identityId, -1, "deep_question", reference);
      const answer = await this.answerer(question, city, reference).catch(() => null);
      if (!answer) {
        if (spent.added) await this.store.addCredits(context.identityId, 1, "admin_adjustment", `refund:${reference}`);
        const body = "I couldn't answer that properly right now, so I didn't use your credit. Please try again later.";
        return { reply: body, interactive: buttons(body, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
      }
      const reply = `${clipText(answer, 1500)}\n\n_From TrustHub data. ${spent.balance} ${spent.balance === 1 ? "credit" : "credits"} left._`;
      return { reply, interactive: buttons(reply, [["menu.ask", "Ask another"], ["btn.menu", "Main menu"]]), state: null, action: "answer" };
    }
    return this.repeat(state);
  }

  // ------------------------------------------------------- profile & feedback

  private async profile(context: ConnectContext): Promise<ConnectReply> {
    if (!context.identityId) return this.requireIdentity(null);
    const [balance, activity] = await Promise.all([this.store.creditBalance(context.identityId), this.store.activity(context.identityId)]);
    const reply = [
      "*Your TrustHub profile*", "",
      `Name: ${context.profileName ?? "Not set yet"}`,
      `Credits: ${balance}`,
      `Reviews: ${activity.reviews} · Listings: ${activity.listings} · Businesses added: ${activity.businesses}`,
      "", "Earn 1 free credit for every review, business or listing you add. Credits are used for deep questions in Ask Wisdom.",
    ].join("\n");
    return { reply, interactive: buttons(reply, [["btn.feedback", "Send feedback"], ["btn.menu", "Main menu"]]), state: { flow: "feedback", step: "offer", data: {} }, action: "answer" };
  }

  private askFeedback(): ConnectReply {
    return { reply: "What should we improve? Tell me in one message.", state: { flow: "feedback", step: "message", data: {} }, action: "clarify" };
  }

  private async feedback(state: ConnectJourneyState, text: string, context: ConnectContext): Promise<ConnectReply | null> {
    if (chose(text, "btn.feedback", "send feedback", "feedback")) return this.askFeedback();
    // On the profile screen, a typed message that isn't "Send feedback" is a new request.
    if (state.step === "offer") return { reply: "", state: null, action: "answer", pass: true };
    if (!context.identityId) return this.requireIdentity(null);
    if (text.length < 3) return this.askFeedback();
    await this.store.saveFeedback({ message: text.slice(0, 1000), identityId: context.identityId });
    const reply = "Thanks. The TrustHub team reads every message.";
    return { reply, interactive: buttons(reply, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
  }
}

