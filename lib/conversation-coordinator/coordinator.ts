import type { AnswerResolver } from "../answer-resolution/resolver";
import type { NormalizedRequest, ResolutionResult, ResolverContext } from "../answer-resolution/types";
import type { ConversationMessage } from "../../types/conversation";
import type { CoordinatorAction, IncomingTurn, OutcomeConfirmation, RuntimeConversation, RuntimeState, TurnResult } from "./types";
import type { RuntimeConversationRepository } from "./repository";
import { createAnswerGenerator } from "../answer-resolution/response-generator.ts";
import type { AnswerGenerator } from "@/types/answer";
import { ASSISTANT_NAMES, assignAssistantName, isAssistantName, isGreeting, loadWisdomLibrary, type WisdomLibrary } from "./wisdom-library.ts";
import { firstNameOf, momentOf, voiceLine } from "../connect/voice.ts";
import { isAdviceQuestion, isOpenQuestion } from "../connect/brain.ts";

/** A different one of the ten names for a new visit, chosen from the person and the time so it is repeatable. */
export function rotateAssistantName(base: string, at: string, current: string): string {
  const fresh = assignAssistantName(`${base}:${at.slice(0, 13)}`);
  if (fresh !== current) return fresh;
  return ASSISTANT_NAMES[(ASSISTANT_NAMES.indexOf(current as (typeof ASSISTANT_NAMES)[number]) + 1) % ASSISTANT_NAMES.length];
}
import { parseNotificationPreference, preferenceReply } from "../notifications/community-missions.ts";
import type { IdentityProvisioner } from "../identity/provisioner.ts";
import { parseProfileCreationRequest } from "../identity/profile-intent.ts";
import { parseLocalSearchRequest } from "../whatsapp/intent-parser.ts";
import type { WhatsAppInteractiveMessage } from "../whatsapp/provider.ts";
import { ConnectJourneys, type ConnectContext, type ConnectReply } from "../connect/journeys.ts";
import { InMemoryConnectStore, type ConnectStore } from "../connect/store.ts";
import { clip, clipText, menuInteractive } from "../connect/menu.ts";
import { correctTown, parsePlace } from "../connect/parse.ts";
import { unclearLine } from "../connect/persona.ts";
import { suggestRoutes, type RouteSuggestion } from "../connect/intent-classifier.ts";
import type { ConnectRoute } from "../connect/intent-routes.ts";
import { benitaLine, benitaReply, factIntent, factReply, type BenitaResult } from "../benita/index.ts";
import type { EvidenceItem } from "../answer-resolution/types.ts";
import { databaseFilterTerms, serviceMatchIntent } from "../discovery/service-taxonomy.ts";

/** The journey a suggested route opens, as a menu row or a button. */
const ROUTE_ACTION: Record<ConnectRoute, [id: string, label: string] | null> = {
  search: ["menu.find", "Find a business"],
  buy: ["menu.buy_sell", "Buy or sell"],
  sell: ["menu.buy_sell", "Sell something"],
  jobs: ["menu.jobs", "Jobs"],
  houses: ["menu.houses", "Houses & rentals"],
  read_reviews: ["menu.review", "Read reviews"],
  write_review: ["menu.review", "Write a review"],
  add_business: ["menu.add_business", "Add a business"],
  scam: ["menu.scam", "Scam check"],
  feedback: ["menu.profile", "Send feedback"],
  menu: null,
  social: null,
  community: null,
};

/**
 * The reply when nothing matched: a witty apology, plus up to three likely
 * journeys as tappable choices. A tap is a confirmed intent, which is the
 * labelled data the team reviews to improve the rules.
 */
function unclearReply(assistantName: string, text: string): { reply: string; interactive: WhatsAppInteractiveMessage } {
  const suggestions: RouteSuggestion[] = suggestRoutes(text);
  const choices = suggestions.map((item) => ROUTE_ACTION[item.route]).filter((item): item is [string, string] => item !== null);
  const seen = new Set<string>();
  const unique = choices.filter(([id]) => (seen.has(id) ? false : (seen.add(id), true)));
  const body = unique.length ? `${unclearLine(assistantName)}\n\nDid you mean one of these?` : unclearLine(assistantName);
  const buttonItems: [string, string][] = [...unique.slice(0, 2), ["btn.menu", "Main menu"]];
  return { reply: body, interactive: { type: "button", body: clipText(body, 1024), buttons: buttonItems.map(([id, title]) => ({ id, title: clip(title, 20) })) } };
}

const NON_ANSWER = /^(?:thanks?(?: you)?|thank u|ok(?:ay)?|yes|yeah|yep|no|nope|sure|cool|alright|fine|good|please|nothing|never ?mind|not now|hi|hello|hey)$/i;
const CITY_QUESTION = "Which city should I look in? An area is optional.";
const CATEGORY_QUESTION = "What type of business or service are you looking for?";

/** True when the place name resolves to a known location; supplied by the runtime from TrustHub communities. */
export type CityValidator = (city: string, country: string | null) => Promise<boolean>;

const LEADING_LOCATION_WORDS = /^(?:(?:it'?s|its|i'?m|i am|we are|somewhere|anywhere|anywhere at all)\s+)?(?:in|around|near|within)\s+/i;
const LEADING_ARTICLE = /^(?:a|an|the|some|any)\s+/i;
const LOOK_IN_PREFIX = /^(?:please\s+)?(?:(?:can you|could you)\s+)?(?:look|search|check|try)(?:\s+(?:for it|there|again))?\s+/i;
const TRAILING_PLACE_WORD = /\s+(?:community|city|town|area)$/i;
/** A message that explicitly asks to search somewhere, e.g. "Look in the Harare community". */
export const LOCATION_REDIRECT = /^(?:please\s+)?(?:(?:can you|could you)\s+)?(?:look|search|check|try)\b.*\b(?:in|around|near|within)\s+\S/i;

function placeFrom(cleaned: string): string {
  return cleaned.replace(LOOK_IN_PREFIX, "").replace(LEADING_LOCATION_WORDS, "").replace(/^anywhere\s*/i, "").replace(LEADING_ARTICLE, "").replace(TRAILING_PLACE_WORD, "").trim();
}

/** A bare place name such as "Harare" starts a search whose category is still to be asked; null unless the place is recognised. */
export async function locationOnlyRequest(text: string, validate: CityValidator): Promise<NormalizedRequest | null> {
  const cleaned = text.trim().replace(/[?.!,;:]+$/, "").trim();
  if (!cleaned || cleaned.length > 40 || isGreeting(cleaned) || NON_ANSWER.test(cleaned)) return null;
  const place = cleaned.replace(LEADING_LOCATION_WORDS, "").replace(/^anywhere\s*/i, "").trim();
  if (!place || place.split(/\s+/).length > 3 || /\d/.test(place) || !(await validate(place, "Zimbabwe"))) return null;
  return { text: text.trim(), intent: "find_business", category: null, location: { country: "Zimbabwe", city: place }, questionType: "business_discovery" };
}

/** Applies a short reply to the one detail the pending clarification asked for; null when it cannot be read as that detail. */
export function continueClarifiedRequest(pending: NormalizedRequest, reply: string, allowCityChange = false): NormalizedRequest | null {
  const cleaned = reply.trim().replace(/[?.!,;:]+$/, "").trim();
  if (!cleaned || cleaned.length > 60 || isGreeting(cleaned) || NON_ANSWER.test(cleaned)) return null;
  const text = `${pending.text} ${reply.trim()}`.trim();
  if (!pending.category) return { ...pending, text, category: cleaned.replace(LEADING_LOCATION_WORDS, "").replace(LEADING_ARTICLE, "") || null };
  if (pending.location?.city && !allowCityChange) return null;
  const place = placeFrom(cleaned);
  if (!place || place.split(/\s+/).length > 4 || /\d/.test(place)) return null;
  const [city, country] = place.split(",").map((part) => part.trim()).filter(Boolean);
  return { ...pending, text, location: { ...pending.location, city: city ?? null, country: country ?? pending.location?.country ?? null } };
}

/**
 * A suburb typed as the "city" ("plumber in Avondale") is searched as that
 * suburb inside its town (Avondale, Harare); the directory stores towns in
 * `city`, so searching for a city called "Avondale" would find nothing.
 */
export function withKnownTown(request: NormalizedRequest): NormalizedRequest {
  const typed = request.location?.city?.trim();
  if (!typed) return request;
  // A misspelt town ("beightbridge") is searched as the town that was meant.
  const corrected = correctTown(typed);
  if (corrected && corrected !== typed) request = { ...request, location: { ...request.location, city: corrected, country: request.location?.country ?? "Zimbabwe" } };
  if (corrected) return request;
  const place = parsePlace(typed);
  if (!place.city || !place.area || place.city.toLocaleLowerCase() === typed.toLocaleLowerCase()) return request;
  return { ...request, location: { ...request.location, city: place.city, area: request.location?.area ?? place.area, country: request.location?.country ?? "Zimbabwe" } };
}

/** The words that mean what was asked for: "hotel" also means lodge, motel, guest house. */
export function requestTerms(request: NormalizedRequest): string[] {
  const intent = request.category ? serviceMatchIntent(request.category, request.serviceConcept) : null;
  const terms = intent ? databaseFilterTerms(intent, 8) : { substrings: [], words: [] };
  return [...new Set([request.category ?? "", ...terms.substrings, ...terms.words].map((term) => term.toLocaleLowerCase().trim()).filter((term) => term.length >= 3))];
}

/**
 * True when a directory result is actually the kind of thing asked for. Its category or services must say so;
 * a name only counts on a whole, specific word, so "Chicken Inn" is not a hotel.
 */
export function evidenceMatchesRequest(item: EvidenceItem, request: NormalizedRequest): boolean {
  const intent = request.category ? serviceMatchIntent(request.category, request.serviceConcept) : null;
  const terms = intent ? databaseFilterTerms(intent, 8) : { substrings: [], words: [] };
  const own = (request.category ?? "").toLocaleLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 4);
  const long = [...new Set([...terms.substrings, ...own].map((term) => term.toLocaleLowerCase()))];
  const described = `${item.category ?? ""} ${(item.businessDetails?.services ?? []).join(" ")}`.toLocaleLowerCase();
  if (long.some((term) => described.includes(term))) return true;
  if (terms.words.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(described))) return true;
  const name = (item.name ?? "").toLocaleLowerCase();
  return long.some((term) => term.length >= 4 && name.includes(term));
}

/**
 * Puts the listings that are plainly what was asked for first ("Regency Hotel" before "Bushmaid Campsite"
 * for "hotel") and drops unrelated ones ("Laundry Mart" for "plumber") when there are real matches.
 */
export function focusEvidence(resolution: ResolutionResult, request: NormalizedRequest | null): ResolutionResult {
  if (!request?.category || !resolution.evidence.length) return resolution;
  const listings = resolution.evidence.filter((item) => item.kind === "listing");
  if (listings.length < 2) return resolution;
  const terms = requestTerms(request).filter((term) => term.length >= 4);
  const strength = (item: EvidenceItem) => {
    const name = (item.name ?? "").toLocaleLowerCase();
    return (terms.some((term) => name.includes(term)) ? 2 : 0) + (evidenceMatchesRequest(item, request) ? 1 : 0);
  };
  const ranked = listings.map((item, index) => ({ item, index, score: strength(item) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const kept = ranked.some((entry) => entry.score > 0) ? ranked.filter((entry) => entry.score > 0) : ranked;
  return { ...resolution, evidence: [...resolution.evidence.filter((item) => item.kind !== "listing"), ...kept.map((entry) => entry.item)] };
}

const nameKey = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The light, every-time invitation that turns each answer into more data. */
export function communityAsk(request: NormalizedRequest): string {
  return `Know a good ${request.category ?? "one"} in ${request.location?.city ?? "your area"} that isn't here? Tap *Add a business* and help the next person.`;
}

/** Closes a results message; a later "yes" or "no" still records the outcome through the existing confirmation path. */
export const OUTCOME_FOLLOW_UP = "Did one of these work out? Tap *It helped* or *No luck* and I'll look wider.";

function acknowledgement(request: NormalizedRequest | null, resolution: ResolutionResult): string {
  if (!request?.category || (request.questionType !== "business_discovery" && request.questionType !== "provider_recommendation")) return "";
  const listings = resolution.evidence.filter((item) => item.kind === "listing").length;
  const where = request.location?.city ? ` in ${request.location.area ? `${request.location.area}, ` : ""}${request.location.city}` : "";
  const found = listings === 0 ? "Here's what TrustHub has" : listings === 1 ? "I found one match on TrustHub" : `I found ${Math.min(listings, 8)}${listings > 8 ? " of the closest" : ""} on TrustHub`;
  return `Got it: ${request.category}${where}. ${found}${resolution.status === "partially_answered" ? ", though some details are missing" : ""}:`;
}

/**
 * A confirmed answer counts as a match only when the answer itself named a
 * TrustHub-listed business/provider for a discovery or recommendation request.
 * A confirmed fact answer stays a useful answer, never an invented match.
 */
export function matchConfirmedByConfirmation(request: NormalizedRequest | null, resolution: ResolutionResult | null): boolean {
  if (!request || !resolution) return false;
  if (resolution.status !== "answered" && resolution.status !== "partially_answered") return false;
  if (request.questionType !== "business_discovery" && request.questionType !== "provider_recommendation") return false;
  return resolution.evidence.some((item) => item.source === "trusthub" && item.sourceRecordId.trim().length > 0);
}

function consentFromText(text: string): boolean | undefined {
  const normalized = text.trim().toLowerCase();
  if (/^(yes|yeah|yep|ok|okay|please do|go ahead|sure|it helped)\b/.test(normalized)) return true;
  if (/^(no|nope|don't|do not|not now|rather not|no luck)\b/.test(normalized)) return false;
  return undefined;
}

/** WhatsApp buttons send their id; the yes/no buttons carry the same meaning as typing yes or no. */
function normalizeButtonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "btn.yes" || trimmed === "btn.helped") return "yes";
  if (trimmed === "btn.no" || trimmed === "btn.no_luck") return "no";
  return text;
}

/** Attaches reply buttons only when the whole reply fits WhatsApp's interactive body limit. */
/** Buttons for a reply. A long reply keeps its buttons: the full text is sent first and the buttons follow. */
function withButtons(reply: string, items: [id: string, title: string][]): WhatsAppInteractiveMessage | undefined {
  return { type: "button", body: reply.length > 1024 ? "What would you like to do next?" : reply, buttons: items.slice(0, 3).map(([id, title]) => ({ id, title: clip(title, 20) })) };
}

export interface CoordinatorConnectOptions {
  journeys: ConnectJourneys;
  store: ConnectStore;
}

export class ConversationCoordinator {
  private readonly repository: RuntimeConversationRepository;
  private readonly resolver: AnswerResolver;
  private readonly now: () => string;
  private readonly answerGenerator: AnswerGenerator;
  private readonly library: WisdomLibrary | null;
  private readonly cityValidator?: CityValidator;
  private readonly provisioner?: IdentityProvisioner;
  private readonly connect: CoordinatorConnectOptions;

  constructor(repository: RuntimeConversationRepository, resolver: AnswerResolver, now: () => string = () => new Date().toISOString(), answerGenerator: AnswerGenerator = createAnswerGenerator(), library: WisdomLibrary | null = loadWisdomLibrary(), cityValidator?: CityValidator, provisioner?: IdentityProvisioner, connect?: CoordinatorConnectOptions) {
    this.cityValidator = cityValidator;
    this.library = library;
    this.repository = repository;
    this.resolver = resolver;
    this.now = now;
    this.answerGenerator = answerGenerator;
    this.provisioner = provisioner;
    if (connect) this.connect = connect;
    else {
      const store = new InMemoryConnectStore(now);
      this.connect = { store, journeys: new ConnectJourneys(store, undefined, () => new Date(now())) };
    }
  }

  async handleTurn(incoming: IncomingTurn): Promise<TurnResult> {
    const duplicate = incoming.providerMessageId ? await this.repository.getByProviderMessageId?.(incoming.providerMessageId) : null;
    if (duplicate) {
      const reply = [...duplicate.messages].reverse().find((message) => message.direction === "outbound")?.text ?? "This message was already processed.";
      const duplicateMessage = duplicate.messages.find((message) => message.providerMessageId === incoming.providerMessageId);
      const grantedAt = duplicateMessage?.metadata?.communityConsentAt;
      const storedConfirmation = duplicateMessage?.metadata?.outcomeConfirmation;
      return { conversationId: duplicate.id, state: duplicate.state, action: duplicate.lastAction ?? "answer", reply, resolution: duplicate.lastResolution, conversation: duplicate, communityConsentGranted: typeof grantedAt === "string", communityConsentAt: typeof grantedAt === "string" ? grantedAt : null, outcomeConfirmation: storedConfirmation && typeof storedConfirmation === "object" ? storedConfirmation as OutcomeConfirmation : null };
    }
    const turn: IncomingTurn = { ...incoming, text: normalizeButtonText(incoming.text) };
    const at = this.now();
    const conversation = await this.repository.get(turn.conversationId) ?? {
      id: turn.conversationId, state: "ready_for_request", pendingPermission: null, lastRequest: null, lastResolution: null, lastAction: null,
      messages: [], transitions: [], updatedAt: at,
    } satisfies RuntimeConversation;
    // One name per person, not per conversation: a person whose chats span several
    // conversations (one per city) keeps meeting the same assistant.
    const identityId = turn.identityId ?? conversation.persistence?.whatsappIdentityId ?? null;
    // A new visit (three hours or more since the last message) brings a new name from the ten, so the chat stays lively;
    // within a visit the name never changes.
    const nameBase = identityId ? `identity:${identityId}` : turn.conversationId;
    const idleHours = conversation.messages.length ? (Date.parse(at) - Date.parse(conversation.updatedAt)) / 3_600_000 : 0;
    if (!conversation.messages.length && identityId) conversation.assistantName = assignAssistantName(nameBase);
    else if (!isAssistantName(conversation.assistantName)) conversation.assistantName = assignAssistantName(nameBase);
    else if (idleHours >= 3) conversation.assistantName = rotateAssistantName(nameBase, at, conversation.assistantName);
    const priorState = conversation.state;
    const userMetadata = {
      ...(turn.media?.length ? { whatsappMedia: turn.media } : {}),
      ...(turn.contributionCandidate ? { detectedContribution: turn.contributionCandidate } : {}),
      ...(turn.understanding ? { understanding: turn.understanding } : {}),
    };
    const userMessage: ConversationMessage = { id: `${turn.conversationId}:in:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "inbound", sender: "user", text: incoming.text, createdAt: at, ...(turn.providerMessageId ? { providerMessageId: turn.providerMessageId } : {}), ...(Object.keys(userMetadata).length ? { metadata: userMetadata } : {}) };
    conversation.messages.push(userMessage);

    const connectContext: ConnectContext = {
      identityId,
      profileName: turn.profileName ?? null,
      providerMessageId: turn.providerMessageId ?? null,
      assistantName: conversation.assistantName ?? "Wisdom",
      senderPhoneForListing: turn.senderPhoneNumber ?? null,
    };

    // 1. The guided Connect journeys run first: welcome, menu, review cards and every flow in progress.
    const pendingCoordinatorQuestion = conversation.pendingPermission !== null;
    const connectReply = !turn.media?.length && !(pendingCoordinatorQuestion && !conversation.connect && consentFromText(turn.text) !== undefined)
      ? await this.connect.journeys.handle(turn.text, connectContext, conversation.connect ?? null)
      : null;
    if (connectReply && !connectReply.pass) return await this.finishConnect(conversation, turn, connectReply, priorState, at);
    if (connectReply?.pass) conversation.connect = null;

    // 1b. Public facts people ask every day (fuel ceilings, the ZiG rate) come straight from Benita.
    const fact = !turn.media?.length ? await this.factAnswer(turn.text) : null;
    if (fact) return await this.finishConnect(conversation, turn, fact, priorState, at);

    // 1c. Open questions ("what business should I start in Harare?", "how much is rent in Avondale?") go to Wisdom's brain.
    // "Recommend a good plumber in Harare" is still a search: the brain takes questions with no service to find,
    // or ones that are plainly about advice ("should I", "in demand", "start a business", "how much").
    const wantsAdvice = isOpenQuestion(turn.text ?? "") && (!turn.request?.category || isAdviceQuestion(turn.text ?? ""));
    if (!turn.media?.length && !conversation.pendingPermission && wantsAdvice) {
      const thought = await this.connect.journeys.brainAnswer(turn.text, connectContext).catch(() => null);
      if (thought) return await this.finishConnect(conversation, turn, thought, priorState, at);
    }

    // 2. Natural-language requests for a guided flow join that flow instead of the old dead-end prompts.
    const intended = await this.connectIntent(turn, connectContext);
    if (intended) return await this.finishConnect(conversation, turn, intended, priorState, at);

    let action: CoordinatorAction;
    let reply: string;
    let interactive: WhatsAppInteractiveMessage | undefined;
    let resolution: ResolutionResult | null = null;
    let nextState: RuntimeState;
    let communityConsentGranted = false;
    let communityConsentAt: string | null = null;
    let outcomeConfirmation: OutcomeConfirmation | null = null;
    const consent = consentFromText(turn.text);
    const redirect = priorState !== "clarification_needed" && !!conversation.lastRequest?.category && LOCATION_REDIRECT.test(turn.text.trim());
    const continued = !turn.request && !turn.contributionCandidate && !turn.media?.length && conversation.lastRequest && (priorState === "clarification_needed" || redirect)
      ? await this.continueClarification(conversation.lastRequest, turn.text, redirect)
      : null;
    const pendingQuestion = conversation.lastRequest?.category ? CITY_QUESTION : CATEGORY_QUESTION;
    const started = !turn.request && !continued && !turn.contributionCandidate && !turn.media?.length && priorState !== "clarification_needed" && consent === undefined && this.cityValidator
      ? await locationOnlyRequest(turn.text, this.cityValidator)
      : null;
    let task = conversation.activeTask ?? { seq: 1, completed: false };
    if ((turn.request || started) && task.completed) task = { seq: task.seq + 1, completed: false };
    const preference = !turn.request && !turn.media?.length ? parseNotificationPreference(turn.text) : null;
    if (preference) {
      action = "clarify";
      reply = preferenceReply(preference);
      nextState = priorState;
    } else if (conversation.pendingPermission === "community" && (turn.communityConsent !== undefined || consent !== undefined)) {
      const granted = turn.communityConsent ?? consent ?? false;
      if (granted && conversation.lastRequest) {
        communityConsentGranted = true;
        communityConsentAt = at;
        userMessage.metadata = { ...userMessage.metadata, communityConsentAt: at };
      }
      conversation.pendingPermission = null;
      action = granted ? "community_request_consented" : "community_request_declined";
      if (granted && conversation.lastRequest) {
        resolution = await this.resolve(conversation.lastRequest, { requesterConsentedToCommunity: true, communityAvailable: true });
        ({ reply, nextState, action } = await this.mapResolution(resolution));
        if (nextState === "asking_community") nextState = "waiting_for_community";
      } else if (conversation.lastRequest) {
        resolution = await this.resolve(conversation.lastRequest, { requesterConsentedToCommunity: false });
        ({ reply, nextState, action } = await this.mapResolution(resolution));
      } else { reply = "Understood. I won't ask your community."; nextState = "ready_for_request"; }
    } else if (conversation.pendingPermission === "human" && (turn.humanConsent !== undefined || consent !== undefined)) {
      const granted = turn.humanConsent ?? consent ?? false;
      conversation.pendingPermission = null;
      action = granted ? "human_handoff_consented" : "human_handoff_declined";
      if (granted) { reply = "I have recorded your consent for a Trust Agent handoff. No agent connection has been made by this local runtime."; nextState = "human_handoff"; }
      else { reply = "Understood. I won't pass this to a Trust Agent. I still haven't found enough reliable information to confirm an answer."; nextState = "unresolved"; }
    } else if (consent !== undefined && !turn.request && !turn.contributionCandidate && conversation.lastRequest
      && (priorState === "answer_found" || priorState === "answer_uncertain")) {
      // The explicit yes/no contract that already carries permission turns also carries the
      // "did that help?" confirmation. Nothing else in the runtime may record an outcome.
      const confirmedRequest = conversation.lastRequest;
      outcomeConfirmation = {
        helpful: consent,
        confirmedAt: at,
        matchConfirmed: consent && matchConfirmedByConfirmation(confirmedRequest, conversation.lastResolution),
      };
      userMessage.metadata = { ...userMessage.metadata, outcomeConfirmation };
      conversation.pendingPermission = null;
      action = consent ? "answer" : "final_unresolved";
      nextState = consent ? "resolved" : "unresolved";
      reply = consent
        ? "Glad it helped! I've recorded that."
        : "Sorry about that. I've recorded that it didn't help. You can try a nearby area, a different kind of service, or ask the community.";
      interactive = withButtons(reply, consent ? [["btn.menu", "Main menu"]] : [["menu.find", "Search again"], ["btn.menu", "Main menu"]]);
    } else if (turn.contributionCandidate && !conversation.activeJourney) {
      action = "contribution_recorded";
      reply = "Thanks. I saved this as an unverified community contribution for review. It is not yet a verified listing.";
      nextState = "ready_for_request";
    } else if (continued) {
      conversation.lastRequest = withKnownTown(continued);
      conversation.pendingPermission = null;
      resolution = await this.resolve(conversation.lastRequest, { ...turn.resolverContext, clarificationAsked: false });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    } else if (started) {
      conversation.lastRequest = withKnownTown(started);
      resolution = await this.resolve(conversation.lastRequest, { ...turn.resolverContext, clarificationAsked: false });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    } else if (turn.request && turn.request.intent === "get_reviews") {
      conversation.lastRequest = withKnownTown(turn.request);
      resolution = await this.resolve(conversation.lastRequest, { ...turn.resolverContext, clarificationAsked: false });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    } else if (conversation.activeJourney === "business_discovery" && !turn.media?.length && !turn.contributionCandidate) {
      // A follow-up to "Find a business" reaches the same search a natural-language message would.
      const request = turn.request ?? parseLocalSearchRequest(turn.text);
      if (!request) {
        action = "clarify";
        reply = "Tell me what you'd like to find and where. For example: *plumber in Avondale*";
        nextState = "clarification_needed";
      } else {
        conversation.lastRequest = withKnownTown(request);
        resolution = await this.resolve(conversation.lastRequest, { ...turn.resolverContext, clarificationAsked: false });
        ({ reply, nextState, action } = await this.mapResolution(resolution));
        const answered = action === "answer" && (resolution.status === "answered" || resolution.status === "partially_answered") && resolution.evidence.length > 0;
        if (answered || nextState === "resolved" || nextState === "unresolved" || nextState === "abandoned") conversation.activeJourney = undefined;
      }
    } else if (!turn.request && !turn.media?.length && priorState === "clarification_needed" && conversation.lastRequest) {
      action = "clarify";
      reply = pendingQuestion;
      nextState = "clarification_needed";
    } else if (!turn.request) {
      action = "clarify";
      if (turn.media?.length) {
        reply = `I received your ${turn.media.map((item) => item.kind === "voice" ? "voice note" : item.kind).join(" and ")}, but I can't read media yet. Please type what you need.`;
        nextState = "clarification_needed";
      } else {
        // "Thanks", "sorted!", "who are you?": everyday moments get a line from the Wisdom library, not "I didn't understand".
        const moment = momentOf(turn.text ?? "");
        const said = moment ? voiceLine(moment, conversation.assistantName ?? "Wisdom", firstNameOf(turn.profileName)) : null;
        // Before admitting we didn't understand, ask Benita: "who sells cement in Gweru" often matches even when the parser can't place it.
        const found = said ? null : await this.benitaFreeText(turn.text ?? "");
        // A real sentence nothing else understood is still a question for a person: Wisdom's brain answers it.
        const thought = !said && !found && (turn.text ?? "").trim().split(/\s+/).length >= 4 ? await this.connect.journeys.brainAnswer(turn.text ?? "", connectContext).catch(() => null) : null;
        if (thought) {
          action = "answer";
          reply = thought.reply;
          interactive = thought.interactive;
          nextState = "ready_for_request";
        } else if (said) {
          action = "answer";
          reply = moment === "thanks" || moment === "solved" ? `${said}\n\nAnything else I can find for you?` : said;
          interactive = withButtons(reply, [["menu.find", "Find a business"], ["btn.menu", "Main menu"]]);
          nextState = "ready_for_request";
        } else if (found) {
          action = "answer";
          reply = found.reply;
          interactive = withButtons(reply, [["btn.helped", "It helped"], ["btn.no_luck", "No luck"], ["btn.menu", "Main menu"]]);
          nextState = "answer_uncertain";
        } else {
          const fallback = unclearReply(conversation.assistantName ?? "Wisdom", turn.text ?? "");
          reply = fallback.reply;
          interactive = fallback.interactive;
          nextState = "ready_for_request";
        }
      }
    } else {
      // A fresh request made while a clarification is pending keeps the city already given.
      const carried = priorState === "clarification_needed" ? conversation.lastRequest?.location : null;
      const request: NormalizedRequest = carried?.city && !turn.request.location?.city
        ? { ...turn.request, location: { ...turn.request.location, country: turn.request.location?.country ?? carried.country ?? null, city: carried.city, area: turn.request.location?.area ?? carried.area ?? null } }
        : turn.request;
      // An unrelated topic change clears the previous request so a later "yes"
      // cannot be mistaken for a consent or confirmation of a search the user
      // has already moved on from. Only the clarification path above keeps it.
      conversation.lastResolution = null;
      conversation.lastAction = null;
      conversation.pendingPermission = null;
      conversation.activeJourney = undefined;
      conversation.lastRequest = withKnownTown(request);
      action = "answer";
      resolution = await this.resolve(conversation.lastRequest, { ...turn.resolverContext, clarificationAsked: priorState === "clarification_needed" });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    }

    // Community requests are stored against a TrustHub profile, so a guest is never offered one they could not complete.
    if (action === "ask_community_permission" && resolution && turn.profileLinked === false) {
      if (resolution.evidence.length) {
        resolution = { ...resolution, status: "partially_answered", uncertainty: "I don't have community recommendations to add yet." };
        ({ reply, nextState, action } = await this.mapResolution(resolution));
      } else {
        resolution = { ...resolution, status: "unresolved" };
        action = "final_unresolved";
        nextState = "unresolved";
        reply = "I haven't found enough reliable information to confirm that.";
      }
    }

    let completedTask: { taskId: string } | undefined;
    if (!task.completed && resolution && (resolution.status === "answered" || resolution.status === "partially_answered") && resolution.evidence.length > 0) {
      task = { ...task, completed: true };
      completedTask = { taskId: `${turn.conversationId}:${task.seq}` };
    }
    conversation.activeTask = task;
    const searched = conversation.lastRequest;
    const discovery = searched?.category && searched.location?.city && (searched.questionType === "business_discovery" || searched.questionType === "provider_recommendation");
    // Nothing in the TrustHub directory: Benita's wider index (OpenStreetMap, public directories, web listings) answers instead of a dead end.
    const emptyDirectory = !!discovery && !!resolution && (resolution.status === "unresolved" || (resolution.status === "community_needed" && resolution.evidence.length === 0));
    // Benita is asked on every directory search, not only empty ones. A directory result that is off-topic
    // (a restaurant called "Chicken Inn" for "hotel") does not count as an answer.
    const directoryListings = resolution?.evidence.filter((item) => item.kind === "listing") ?? [];
    const onTopic = discovery ? directoryListings.filter((item) => evidenceMatchesRequest(item, searched!)) : directoryListings;
    const offTopicOnly = !!discovery && directoryListings.length > 0 && onTopic.length === 0;
    let wider = discovery && resolution ? await this.benitaForRequest(searched!) : [];
    if (!wider.length && (emptyDirectory || offTopicOnly) && this.connect.store.benitaLive) {
      // Nothing stored anywhere: Benita looks it up live (open map, then the web) and saves what it finds for the next person.
      const added = await this.connect.store.benitaLive({ text: searched!.category!, city: searched!.location!.city!, terms: requestTerms(searched!) }).catch(() => 0);
      if (added > 0) wider = await this.benitaForRequest(searched!);
    }
    const own = new Set(directoryListings.map((item) => nameKey(item.name ?? "")));
    const extra = wider.filter((found) => !own.has(nameKey(found.name))).slice(0, 3);
    const benitaLeads = (emptyDirectory || offTopicOnly) && wider.length > 0;
    if (benitaLeads) {
      reply = `${benitaReply(wider, searched!.category!, searched!.location!.city!)}\n\n${communityAsk(searched!)}\n\n${OUTCOME_FOLLOW_UP}`;
      interactive = withButtons(reply, [["btn.helped", "It helped"], ["btn.no_luck", "No luck"], ["menu.add_business", "Add a business"]]);
      action = "answer";
      nextState = "answer_uncertain";
    } else if (discovery && resolution?.status === "community_needed" && resolution.evidence.length === 0) {
      reply = `I couldn't find any ${searched.category} listed in ${searched.location!.city} on TrustHub yet. Would you like me to ask people in the ${searched.location!.city} community? I'd only share your question, never your number. Reply yes to go ahead, or no and I'll leave it there.`;
      interactive = withButtons(reply, [["btn.yes", "Yes, ask them"], ["btn.no", "No thanks"]]);
    } else if (action === "ask_community_permission") {
      interactive = withButtons(reply, [["btn.yes", "Yes, ask them"], ["btn.no", "No thanks"]]);
    }
    if (!benitaLeads && resolution && (resolution.status === "answered" || resolution.status === "partially_answered") && action === "answer" && resolution.evidence.length) {
      const opening = acknowledgement(searched, resolution);
      // TrustHub's own results stay first; Benita adds what else it knows underneath, each with its trust label.
      const more = discovery && extra.length
        ? `\n\n*More ${searched!.category} in ${searched!.location!.city} that Benita found:*\n${extra.map((found, index) => benitaLine(found, index)).join("\n")}`
        : "";
      reply = `${opening ? `${opening}\n\n` : ""}${reply}${more}\n\n${OUTCOME_FOLLOW_UP}`;
      interactive = withButtons(reply, [["btn.helped", "It helped"], ["btn.no_luck", "No luck"], ["btn.menu", "Main menu"]]);
    }
    if (resolution?.status === "unresolved" && discovery && !wider.length) {
      reply = `I couldn't find any ${searched!.category} in ${searched!.location!.city} yet, on TrustHub or online. I've put it on Benita's list to look for tonight.\n\n${communityAsk(searched!)}`;
      interactive = withButtons(reply, [["menu.add_business", "Add a business"], ["menu.find", "Search again"], ["btn.menu", "Main menu"]]);
    }
    if (action === "ask_community_permission") conversation.pendingPermission = "community";
    if (action === "request_human_permission") conversation.pendingPermission = "human";
    if (discovery && resolution && turn.providerMessageId) await this.logDiscovery(identityId, searched!, resolution, turn.providerMessageId);

    conversation.state = nextState;
    conversation.lastResolution = resolution;
    conversation.lastAction = action;
    conversation.updatedAt = at;
    if (conversation.state !== priorState) conversation.transitions.push({ from: priorState, to: conversation.state, at, reason: action });
    conversation.messages.push({ id: `${turn.conversationId}:out:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "outbound", sender: "system", text: reply, createdAt: at });
    await this.repository.save(conversation);
    return { conversationId: turn.conversationId, state: conversation.state, action, reply, resolution, conversation, communityConsentGranted, communityConsentAt, outcomeConfirmation, ...(interactive ? { interactive } : {}), ...(completedTask ? { completedTask } : {}), ...(preference ? { notificationPreference: preference } : {}) };
  }

  /** A ready reply when the message asks for today's fuel prices or exchange rate and Benita has them. */
  private async factAnswer(text: string): Promise<ConnectReply | null> {
    const kind = factIntent(text);
    if (!kind) return null;
    const facts = await this.connect.store.currentFacts(kind === "fuel" ? "fuel." : "fx.").catch(() => []);
    const reply = factReply(kind, facts);
    if (!reply) return null;
    return { reply, interactive: withButtons(reply, [["btn.menu", "Main menu"]]), state: null, action: "answer" };
  }

  /** Benita results for a parsed directory request, using the service taxonomy's synonyms. */
  private async benitaForRequest(request: NormalizedRequest): Promise<BenitaResult[]> {
    const extraTerms = requestTerms(request).filter((term) => term !== request.category?.toLocaleLowerCase()).slice(0, 8);
    const text = [request.entityName, request.category, request.serviceConcept].filter(Boolean).join(" ") || request.text;
    try {
      const found = await this.connect.store.benitaSearch({ text, city: request.location?.city ?? null, limit: 8, kinds: ["place"], extraTerms });
      // Keep the results that are plainly the thing asked for ("Aquaseal Plumbers", not "Laundry Mart"), when there are any.
      const terms = requestTerms(request).filter((term) => term.length >= 4);
      const plain = found.filter((result) => terms.some((term) => `${result.name} ${result.category ?? ""} ${result.subcategory ?? ""}`.toLocaleLowerCase().includes(term)));
      return (plain.length ? plain : found).slice(0, 5);
    } catch (error) {
      console.error(JSON.stringify({ event: "benita.search_failed", errorType: error instanceof Error ? error.name : "unknown" }));
      return [];
    }
  }

  /** A confident Benita answer for a message nothing else understood, or null. */
  private async benitaFreeText(text: string): Promise<{ reply: string } | null> {
    const clean = text.trim();
    if (clean.length < 6 || NON_ANSWER.test(clean) || !/[\p{L}]{4,}/u.test(clean)) return null;
    const city = parsePlace(clean).city;
    try {
      const results = await this.connect.store.benitaSearch({ text: clean, city, limit: 5 });
      const strong = results.filter((result) => result.score >= 0.95);
      if (strong.length < 2) return null;
      return { reply: benitaReply(strong, clip(clean, 40), city) };
    } catch {
      return null;
    }
  }

  /** Records every directory search, including the ones that found nothing, for demand intelligence. */
  private async logDiscovery(identityId: string | null, request: NormalizedRequest, resolution: ResolutionResult, providerMessageId: string): Promise<void> {
    try {
      await this.connect.store.logSearch({
        identityId, journey: "find", category: request.category ?? null, city: request.location?.city ?? null, area: request.location?.area ?? null,
        queryText: clip(request.text, 200), resultCount: resolution.evidence.filter((item) => item.source === "trusthub").length, sourceMessageId: `${providerMessageId}:find`,
      });
    } catch (error) {
      // Bookkeeping never costs the person their answer.
      console.error(JSON.stringify({ event: "connect.search_log_failed", errorType: error instanceof Error ? error.name : "unknown" }));
    }
  }

  /**
   * Routes plain-language requests for a guided flow into that flow:
   * "I want to write a review", "add a business", "create my profile" and a
   * guest's "I know a plumber called...". Those used to end at a question
   * that saved nothing, or crash when profile creation was not connected.
   */
  private async connectIntent(turn: IncomingTurn, context: ConnectContext): Promise<ConnectReply | null> {
    if (turn.media?.length) return null;
    const request = turn.request;
    if (request && (request.intent === "review_experience" || request.questionType === "review_write")) return await this.connect.journeys.begin("menu.review", context);
    if (request && (request.intent === "add_business" || request.questionType === "add_business")) {
      return this.connect.journeys.beginAddBusiness({ name: request.entityName ?? null, category: request.category ?? null, city: request.location?.city ?? null, area: request.location?.area ?? null });
    }
    if (turn.contributionCandidate && turn.profileLinked === false) {
      // A guest has no TrustHub profile to attach a contribution to, so their tip becomes a business submission.
      const candidate = turn.contributionCandidate;
      return this.connect.journeys.beginAddBusiness({ name: candidate.providerName, category: candidate.category, city: candidate.city, area: candidate.area });
    }
    if (!request && turn.profileLinked !== true && parseProfileCreationRequest(turn.text)) {
      if (this.provisioner) return null;
      return await this.connect.journeys.begin("menu.profile", context);
    }
    return null;
  }

  private async finishConnect(conversation: RuntimeConversation, turn: IncomingTurn, result: ConnectReply, priorState: RuntimeState, at: string): Promise<TurnResult> {
    // "Hi" or MENU in the middle of a search question shows the menu but keeps the
    // question open, so typing the missing city afterwards still finishes that search.
    const keepClarification = result.action === "show_menu" && !conversation.connect && priorState === "clarification_needed" && !!conversation.lastRequest;
    conversation.connect = result.state;
    if (keepClarification) {
      conversation.lastAction = result.action;
      conversation.updatedAt = at;
      conversation.messages.push({ id: `${turn.conversationId}:out:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "outbound", sender: "system", text: result.reply, createdAt: at });
      await this.repository.save(conversation);
      return {
        conversationId: turn.conversationId, state: conversation.state, action: result.action, reply: result.reply, resolution: null, conversation,
        communityConsentGranted: false, communityConsentAt: null, outcomeConfirmation: null,
        ...(result.interactive ? { interactive: result.interactive } : {}),
      };
    }
    if (result.action === "show_menu" || result.state) {
      // The menu and every guided flow start fresh: no stale search or consent can capture the next reply.
      conversation.activeJourney = undefined;
      conversation.pendingPermission = null;
      conversation.lastResolution = null;
    }
    if (result.handoff) {
      conversation.activeJourney = result.handoff;
      conversation.pendingPermission = null;
      conversation.lastRequest = null;
    }
    const nextState: RuntimeState = result.state ? "clarification_needed" : result.handoff ? "ready_for_request" : result.action === "answer" ? "resolved" : "ready_for_request";
    conversation.state = nextState;
    conversation.lastAction = result.action;
    conversation.updatedAt = at;
    if (nextState !== priorState) conversation.transitions.push({ from: priorState, to: nextState, at, reason: result.action });
    conversation.messages.push({ id: `${turn.conversationId}:out:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "outbound", sender: "system", text: result.reply, createdAt: at });
    await this.repository.save(conversation);
    return {
      conversationId: turn.conversationId, state: nextState, action: result.action, reply: result.reply, resolution: null, conversation,
      communityConsentGranted: false, communityConsentAt: null, outcomeConfirmation: null,
      ...(result.interactive ? { interactive: result.interactive } : {}),
    };
  }

  /** Every directory answer is focused on what was asked: the closest matches first, unrelated ones dropped. */
  private async resolve(request: NormalizedRequest, context: ResolverContext) { return focusEvidence(await this.resolver.resolve(request, context), request); }

  private async continueClarification(pending: NormalizedRequest, text: string, allowCityChange = false): Promise<NormalizedRequest | null> {
    const next = continueClarifiedRequest(pending, text, allowCityChange);
    const city = next?.location?.city;
    if (!city || city.toLocaleLowerCase() === pending.location?.city?.toLocaleLowerCase() || !this.cityValidator) return next;
    if (parsePlace(city).city) return next;
    return await this.cityValidator(city, next.location?.country ?? null) ? next : null;
  }

  private async mapResolution(resolution: ResolutionResult): Promise<{ action: CoordinatorAction; reply: string; nextState: RuntimeState }> {
    const { text: reply } = await this.answerGenerator.generate(resolution);
    switch (resolution.status) {
      case "answered": return { action: "answer", reply, nextState: "answer_found" };
      case "partially_answered": return { action: "answer", reply, nextState: "answer_uncertain" };
      case "clarification_needed": return { action: "clarify", reply, nextState: "clarification_needed" };
      case "community_needed": return { action: "ask_community_permission", reply, nextState: "asking_community" };
      case "human_needed": return { action: "request_human_permission", reply, nextState: "trust_agent_offer" };
      case "unresolved": return { action: "final_unresolved", reply, nextState: "unresolved" };
    }
  }
}
