import type { AnswerResolver } from "../answer-resolution/resolver";
import type { NormalizedRequest, ResolutionResult, ResolverContext } from "../answer-resolution/types";
import type { ConversationMessage } from "../../types/conversation";
import type { CoordinatorAction, IncomingTurn, OutcomeConfirmation, RuntimeConversation, RuntimeState, TurnResult } from "./types";
import type { RuntimeConversationRepository } from "./repository";
import { createAnswerGenerator } from "../answer-resolution/response-generator.ts";
import type { AnswerGenerator } from "@/types/answer";
import { assignAssistantName, isAssistantName, isGreeting, loadWisdomLibrary, type WisdomLibrary } from "./wisdom-library.ts";
import { parseNotificationPreference, preferenceReply } from "../notifications/community-missions.ts";
import type { IdentityProvisioner } from "../identity/provisioner.ts";
import { parseProfileCreationRequest } from "../identity/profile-intent.ts";
import { formatServiceBoard, isMenuCommand, menuJourneyEntry, resolveMenuNumber } from "./service-board.ts";
import { parseLocalSearchRequest } from "../whatsapp/intent-parser.ts";
import { recognizeNonSearchIntent } from "./intents.ts";

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

/** Closes a results message; a later "yes" or "no" still records the outcome through the existing confirmation path. */
export const OUTCOME_FOLLOW_UP = "If one of these works out, let me know. If not, say *no luck* and I'll look wider.";

function acknowledgement(request: NormalizedRequest | null, resolution: ResolutionResult): string {
  if (!request?.category || (request.questionType !== "business_discovery" && request.questionType !== "provider_recommendation")) return "";
  const listings = resolution.evidence.filter((item) => item.kind === "listing").length;
  const where = request.location?.city ? ` in ${request.location.city}${request.location.area ? `, ${request.location.area}` : ""}` : "";
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
  if (/^(yes|yeah|yep|ok|okay|please do|go ahead|sure)\b/.test(normalized)) return true;
  if (/^(no|nope|don't|do not|not now|rather not)\b/.test(normalized)) return false;
  return undefined;
}

/**
 * Journey follow-up helpers. Each reuses the SAME deterministic parser a
 * natural-language message uses, so a numbered menu selection and its
 * equivalent sentence reach identical handlers.
 */
function recruitmentRequest(text: string): NormalizedRequest | null {
  const recognized = recognizeNonSearchIntent(text);
  return recognized && recognized.request.questionType === "recruitment" ? recognized.request : null;
}

function addBusinessRequest(text: string): NormalizedRequest | null {
  const recognized = recognizeNonSearchIntent(text);
  return recognized && recognized.request.questionType === "add_business" ? recognized.request : null;
}

function reviewRequest(text: string): NormalizedRequest | null {
  const recognized = recognizeNonSearchIntent(text);
  return recognized && recognized.request.questionType === "review_write" ? recognized.request : null;
}

export class ConversationCoordinator {
  private readonly repository: RuntimeConversationRepository;
  private readonly resolver: AnswerResolver;
  private readonly now: () => string;
  private readonly answerGenerator: AnswerGenerator;
  private readonly library: WisdomLibrary | null;
  private readonly cityValidator?: CityValidator;
  private readonly provisioner?: IdentityProvisioner;

  constructor(repository: RuntimeConversationRepository, resolver: AnswerResolver, now: () => string = () => new Date().toISOString(), answerGenerator: AnswerGenerator = createAnswerGenerator(), library: WisdomLibrary | null = loadWisdomLibrary(), cityValidator?: CityValidator, provisioner?: IdentityProvisioner) {
    this.cityValidator = cityValidator;
    this.library = library;
    this.repository = repository;
    this.resolver = resolver;
    this.now = now;
    this.answerGenerator = answerGenerator;
    this.provisioner = provisioner;
  }

  async handleTurn(turn: IncomingTurn): Promise<TurnResult> {
    const duplicate = turn.providerMessageId ? await this.repository.getByProviderMessageId?.(turn.providerMessageId) : null;
    if (duplicate) {
      const reply = [...duplicate.messages].reverse().find((message) => message.direction === "outbound")?.text ?? "This message was already processed.";
      const duplicateMessage = duplicate.messages.find((message) => message.providerMessageId === turn.providerMessageId);
      const grantedAt = duplicateMessage?.metadata?.communityConsentAt;
      const storedConfirmation = duplicateMessage?.metadata?.outcomeConfirmation;
      return { conversationId: duplicate.id, state: duplicate.state, action: duplicate.lastAction ?? "answer", reply, resolution: duplicate.lastResolution, conversation: duplicate, communityConsentGranted: typeof grantedAt === "string", communityConsentAt: typeof grantedAt === "string" ? grantedAt : null, outcomeConfirmation: storedConfirmation && typeof storedConfirmation === "object" ? storedConfirmation as OutcomeConfirmation : null };
    }
    const at = this.now();
    const conversation = await this.repository.get(turn.conversationId) ?? {
      id: turn.conversationId, state: "ready_for_request", pendingPermission: null, lastRequest: null, lastResolution: null, lastAction: null,
      messages: [], transitions: [], updatedAt: at,
    } satisfies RuntimeConversation;
    if (!isAssistantName(conversation.assistantName)) conversation.assistantName = assignAssistantName(turn.conversationId);
    const priorState = conversation.state;
    const userMetadata = {
      ...(turn.media?.length ? { whatsappMedia: turn.media } : {}),
      ...(turn.contributionCandidate ? { detectedContribution: turn.contributionCandidate } : {}),
      ...(turn.understanding ? { understanding: turn.understanding } : {}),
    };
    const userMessage: ConversationMessage = { id: `${turn.conversationId}:in:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "inbound", sender: "user", text: turn.text, createdAt: at, ...(turn.providerMessageId ? { providerMessageId: turn.providerMessageId } : {}), ...(Object.keys(userMetadata).length ? { metadata: userMetadata } : {}) };
    conversation.messages.push(userMessage);

    let action: CoordinatorAction;
    let reply: string;
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
    // The MENU command and a bare menu number are handled before every other
    // branch. They never start, complete or corrupt an active task, and a
    // number never overrides an active clarification, consent or confirmation.
    const menuOption = isMenuCommand(turn.text) ? null : resolveMenuNumber(turn.text);
    if (isMenuCommand(turn.text) || menuOption) {
      const board = formatServiceBoard();
      if (isMenuCommand(turn.text)) {
        action = "show_menu";
        reply = board;
        // MENU preserves the current state verbatim — clarification, community
        // consent, human handoff or ready — so it never completes, cancels or
        // corrupts an active task.
        nextState = conversation.state;
      } else if (menuOption!.status === "placeholder") {
        action = "placeholder";
        reply = `${board}\n\n${menuOption!.placeholderReply}`;
        nextState = "ready_for_request";
        // Even placeholder journeys keep their context, so a follow-up message
        // continues the same journey instead of resetting to a generic prompt.
        conversation.activeJourney = menuOption!.journey;
      } else {
        const entry = menuJourneyEntry(menuOption!.journey);
        const starter = entry?.starterText ?? menuOption!.label;
        action = "start_journey";
        reply = `${board}\n\n${this.journeyStarter(menuOption!.journey, starter)}`;
        nextState = conversation.state === "clarification_needed" ? "clarification_needed" : "ready_for_request";
        // Remember which journey the numbered selection started so follow-up
        // answers route through the same handler a natural-language message would.
        conversation.activeJourney = menuOption!.journey;
      }
      // MENU and a menu number never complete, delete or corrupt an active task.
      // The pending request and clarification are preserved so the user can
      // still answer them; only unrelated stale state is cleared.
      conversation.lastResolution = null;
      conversation.lastAction = null;
      conversation.pendingPermission = null;
    } else if (preference) {
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
        ? "Thanks. I've recorded that this answered your question."
        : "Understood. I've recorded that this did not answer your question. You can refine the request or try another route.";
    } else if (turn.contributionCandidate && !conversation.activeJourney) {
      action = "contribution_recorded";
      reply = "Thanks. I saved this as an unverified community contribution for review. It is not yet a verified listing.";
      nextState = "ready_for_request";
    } else if (!turn.request && !turn.media?.length && isGreeting(turn.text) && this.library?.greeting(turn.conversationId, conversation.assistantName)) {
      action = "clarify";
      reply = this.library.greeting(turn.conversationId, conversation.assistantName)!.reply;
      if (priorState === "clarification_needed") reply = `${reply}\n\n${pendingQuestion}`;
      else reply = `${reply}\n\n${formatServiceBoard()}`;
      nextState = priorState === "clarification_needed" ? priorState : "ready_for_request";
    } else if (continued) {
      conversation.lastRequest = continued;
      conversation.pendingPermission = null;
      resolution = await this.resolve(continued, { ...turn.resolverContext, clarificationAsked: false });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    } else if (started) {
      conversation.lastRequest = started;
      resolution = await this.resolve(started, { ...turn.resolverContext, clarificationAsked: false });
      ({ reply, nextState, action } = await this.mapResolution(resolution));
    } else if (!turn.request && !turn.contributionCandidate && !turn.media?.length
      && turn.profileLinked !== true && parseProfileCreationRequest(turn.text)) {
      // An explicit request to start the profile flow. It is never answered by
      // asking "What are you trying to find or sort out?" — the existing
      // IdentityProvisioner seam creates the profile, and it is currently not
      // connected, which throws instead of silently doing nothing.
      const profileRequest = parseProfileCreationRequest(turn.text)!;
      const displayName = profileRequest.displayName ?? (turn.understanding?.request?.text ? turn.understanding.request.text : null);
      const next = await this.startProfileCreation(turn, displayName);
      reply = next.reply;
      action = next.action;
      nextState = next.state;
    } else if (turn.request && (turn.request.intent === "add_business" || turn.request.questionType === "add_business")) {
      // Handle "add a business" requests - guide user through business submission
      const { reply: addReply, state: addState, action: addAction } = await this.handleAddBusiness(turn, conversation);
      reply = addReply;
      action = addAction;
      nextState = addState;
    } else if (turn.request && (turn.request.intent === "review_experience" || turn.request.questionType === "review_write")) {
      // Handle "write a review" requests - guide user through review submission
      const { reply: reviewReply, state: reviewState, action: reviewAction } = await this.handleWriteReview(turn, conversation);
      reply = reviewReply;
      action = reviewAction;
      nextState = reviewState;
    } else if (turn.request && turn.request.intent === "get_reviews") {
      // Handle "read reviews" requests - search for reviews on a business
      const { reply: reviewsReply, state: reviewsState, action: reviewsAction } = await this.handleGetReviews(turn, conversation);
      reply = reviewsReply;
      action = reviewsAction;
      nextState = reviewsState;
    } else if (conversation.activeJourney && !turn.media?.length && !turn.contributionCandidate) {
      // A follow-up to a numbered menu selection routes through the SAME
      // handler a natural-language message would use, so the journey stays
      // coherent instead of resetting to a generic prompt. It wins over the
      // generic clarification branch below, so a menu number and its
      // equivalent sentence reach identical handlers.
      const routed = await this.routeJourneyFollowUp(conversation.activeJourney, turn, conversation, priorState);
      reply = routed.reply;
      action = routed.action;
      nextState = routed.state;
      if (routed.resolution) resolution = routed.resolution;
      const answered = routed.action === "answer" && routed.resolution && (routed.resolution.status === "answered" || routed.resolution.status === "partially_answered") && routed.resolution.evidence.length > 0;
      if (answered || routed.state === "resolved" || routed.state === "unresolved" || routed.state === "abandoned") {
        conversation.activeJourney = undefined;
      }
    } else if (!turn.request && !turn.media?.length && priorState === "clarification_needed" && conversation.lastRequest) {
      action = "clarify";
      reply = pendingQuestion;
      nextState = "clarification_needed";
    } else if (!turn.request) {
      action = "clarify";
      reply = turn.media?.length
        ? `I received your ${turn.media.map((item) => item.kind === "voice" ? "voice note" : item.kind).join(" and ")}, but media transcription or image reading is not configured yet. Please describe what you need in a text message.`
        : "What are you trying to find or sort out?";
      nextState = turn.media?.length ? "clarification_needed" : "ready_for_request";
    } else {
      // A fresh request made while a clarification is pending keeps the city already given.
      const carried = priorState === "clarification_needed" ? conversation.lastRequest?.location : null;
      const request: NormalizedRequest = carried?.city && !turn.request.location?.city
        ? { ...turn.request, location: { ...turn.request.location, country: turn.request.location?.country ?? carried.country ?? null, city: carried.city, area: turn.request.location?.area ?? carried.area ?? null } }
        : turn.request;
// An unrelated topic change clears the previous request so a later "yes"
      // cannot be mistaken for a consent or confirmation of a search the user
      // has already moved on from. Only the clarification path above keeps it.
      conversation.lastRequest = null;
      conversation.lastResolution = null;
      conversation.lastAction = null;
      conversation.pendingPermission = null;
      conversation.activeJourney = undefined;
      conversation.lastRequest = request;
      action = "answer";
      resolution = await this.resolve(request, { ...turn.resolverContext, clarificationAsked: priorState === "clarification_needed" });
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
    if (discovery && resolution?.status === "community_needed" && resolution.evidence.length === 0) {
      reply = `I couldn't find any ${searched.category} listed in ${searched.location!.city} in TrustHub's records yet. Would you like me to ask people in the ${searched.location!.city} community? I'd only share your question, never your number. Reply yes to go ahead, or no and I'll leave it there.`;
    }
    if (resolution && (resolution.status === "answered" || resolution.status === "partially_answered") && action === "answer" && resolution.evidence.length) {
      const opening = acknowledgement(searched, resolution);
      reply = `${opening ? `${opening}\n\n` : ""}${reply}\n\n${OUTCOME_FOLLOW_UP}`;
    }
    if (resolution?.status === "unresolved" && searched?.category && searched.location?.city && (searched.questionType === "business_discovery" || searched.questionType === "provider_recommendation")) {
      reply = `I couldn't find any ${searched.category} listed in ${searched.location.city} in TrustHub's records yet. Would you like me to try a nearby city, or search for a different kind of service?`;
    }
    if (action === "ask_community_permission") conversation.pendingPermission = "community";
    if (action === "request_human_permission") conversation.pendingPermission = "human";

    conversation.state = nextState;
    conversation.lastResolution = resolution;
    conversation.lastAction = action;
    conversation.updatedAt = at;
    if (conversation.state !== priorState) conversation.transitions.push({ from: priorState, to: conversation.state, at, reason: action });
    conversation.messages.push({ id: `${turn.conversationId}:out:${conversation.messages.length}`, conversationId: turn.conversationId, channel: turn.channel ?? "web", direction: "outbound", sender: "system", text: reply, createdAt: at });
    await this.repository.save(conversation);
    return { conversationId: turn.conversationId, state: conversation.state, action, reply, resolution, conversation, communityConsentGranted, communityConsentAt, outcomeConfirmation, ...(completedTask ? { completedTask } : {}), ...(preference ? { notificationPreference: preference } : {}) };
  }

  private resolve(request: NormalizedRequest, context: ResolverContext) { return this.resolver.resolve(request, context); }

  private async continueClarification(pending: NormalizedRequest, text: string, allowCityChange = false): Promise<NormalizedRequest | null> {
    const next = continueClarifiedRequest(pending, text, allowCityChange);
    const city = next?.location?.city;
    if (!city || city.toLocaleLowerCase() === pending.location?.city?.toLocaleLowerCase() || !this.cityValidator) return next;
    return await this.cityValidator(city, next.location?.country ?? null) ? next : null;
  }

  /**
   * The opening question for a numbered menu selection. Every implemented
   * journey routes into the SAME handler natural-language messages use, so a
   * menu number and an equivalent sentence reach identical journeys. Only
   * placeholder journeys call this, and they are handled inline instead.
   */
  private journeyStarter(journey: string, label: string): string {
    switch (journey) {
      case "business_discovery":
        return `Got it — option 1, finding a business or service. 🔎 What would you like to find, and where?`;
      case "business_contribution":
        return `Got it — option 2, adding a business. 🏪 What is the business called, and where is it?`;
      case "review_submission":
        return `Got it — option 3, writing a review. ⭐ Which business, and what was your experience?`;
      case "jobs_recruitment":
        return `Got it — option 6, jobs and recruitment. 💼 Are you looking for work, or looking to hire someone?`;
      case "housing_rentals":
        return `Got it — option 7, housing and rentals. 🏠 Are you looking for a place to stay, or offering one?`;
      case "community_intelligence":
        return `Got it — option 8, Community Intelligence. 🧠 What would you like to learn more about in your community?`;
      case "buy_sell":
        return `🛍️ Buy & Sell\n\nWhat would you like to do?\n\n* 🛒 Buy something\n* 🏷️ Sell something\n* 🔙 Back to the main menu\n\nJust pick one or tell me in your own words!`;
      default:
        return `Got it — ${label}. Tell me more and I will help you with that.`;
    }
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

  /**
   * Starts the profile flow through the existing IdentityProvisioner seam.
   * The seam is currently not connected, so this throws
   * `IdentityProvisionerNotConnectedError` rather than silently doing nothing
   * or creating a parallel profile. A profile is never created from an
   * unlinked phone number.
   */
  private async startProfileCreation(turn: IncomingTurn, displayName: string | null): Promise<{ action: CoordinatorAction; reply: string; state: RuntimeState }> {
    if (!this.provisioner) {
      throw new Error("Profile creation is not available: the IdentityProvisioner seam is not connected.");
    }
    const profile = await this.provisioner.provisionProfile({
      phoneNumber: turn.senderPhoneNumber ?? "",
      displayName,
      communityKey: null,
    });
    return {
      action: "profile_created",
      reply: `You're all set! Your TrustHub profile is ready${profile.name ? `, ${profile.name}` : ""}. What would you like to do today?`,
      state: "profile_created",
    };
  }

  /** Handles "add a business" requests by guiding the user through the submission flow. */
  private async handleAddBusiness(turn: IncomingTurn, conversation: RuntimeConversation): Promise<{ action: CoordinatorAction; reply: string; state: RuntimeState }> {
    const request = turn.request!;
    const category = request.category;
    const location = request.location;

    // If we have a category and location, we can accept the submission
    if (category && location?.city) {
      // Store the pending business submission in conversation state for follow-up
      conversation.lastRequest = request;
      return {
        action: "clarify",
        reply: `Great! I'll help you add "${category}" in ${location.city}${location.area ? `, ${location.area}` : ""}. What's the business name?`,
        state: "clarification_needed",
      };
    }

    // Need category
    if (!category) {
      return {
        action: "clarify",
        reply: "What type of business would you like to add? (e.g., bakery, plumber, hair salon)",
        state: "clarification_needed",
      };
    }

    // Need location
    if (!location?.city) {
      return {
        action: "clarify",
        reply: `What city is this "${category}" in?`,
        state: "clarification_needed",
      };
    }

    return {
      action: "clarify",
      reply: "I need a bit more information to add this business. What's the business name and which city is it in?",
      state: "clarification_needed",
    };
  }

  /** Handles "write a review" requests by guiding the user through the review flow. */
  private async handleWriteReview(turn: IncomingTurn, conversation: RuntimeConversation): Promise<{ action: CoordinatorAction; reply: string; state: RuntimeState }> {
    const request = turn.request!;
    const category = request.category;
    const location = request.location;

    if (category && location?.city) {
      conversation.lastRequest = request;
      return {
        action: "clarify",
        reply: `I'd be happy to help you share your experience with "${category}" in ${location.city}${location.area ? `, ${location.area}` : ""}. Which business did you use?`,
        state: "clarification_needed",
      };
    }

    if (!category) {
      return {
        action: "clarify",
        reply: "What type of business or service would you like to review?",
        state: "clarification_needed",
      };
    }

    if (!location?.city) {
      return {
        action: "clarify",
        reply: `Which city is the "${category}" you want to review located in?`,
        state: "clarification_needed",
      };
    }

    return {
      action: "clarify",
      reply: "Which business would you like to review, and in which city is it located?",
      state: "clarification_needed",
    };
  }

  /** Handles "read reviews" requests by searching for reviews on a business. */
  private async handleGetReviews(turn: IncomingTurn, conversation: RuntimeConversation): Promise<{ action: CoordinatorAction; reply: string; state: RuntimeState }> {
    const request = turn.request!;
    // This goes through the normal resolver which handles "reputation" questionType
    conversation.lastRequest = request;
    const resolution = await this.resolve(request, { ...turn.resolverContext, clarificationAsked: false });
    const { action, reply, nextState } = await this.mapResolution(resolution);
    return { action, reply, state: nextState };
  }

  /**
   * Option 4 — Rate a business.
   *
   * No rating persistence exists in TrustHub Connect yet, so this journey
   * collects the details honestly and offers the supported alternative
   * (writing a review, option 3). It never claims a rating was recorded.
   */
  private handleRateBusiness(turn: IncomingTurn, conversation: RuntimeConversation): { action: CoordinatorAction; reply: string; state: RuntimeState } {
    const request = turn.request!;
    const category = request.category;
    const location = request.location;
    if (category && location?.city) {
      conversation.lastRequest = request;
      return {
        action: "clarify",
        reply: `I'd be happy to help you rate "${category}" in ${location.city}${location.area ? `, ${location.area}` : ""}. Which business did you use?`,
        state: "clarification_needed",
      };
    }
    if (!category) {
      return { action: "clarify", reply: "What type of business or service would you like to rate?", state: "clarification_needed" };
    }
    if (!location?.city) {
      return { action: "clarify", reply: `Which city is the "${category}" you want to rate located in?`, state: "clarification_needed" };
    }
    return { action: "clarify", reply: "Which business would you like to rate, and in which city is it?", state: "clarification_needed" };
  }

  /**
   * Option 5 — Buy or sell.
   *
   * Interactive buy/sell journey with emoji-rich choices.
   */
  private handleBuySell(turn: IncomingTurn, conversation: RuntimeConversation): { action: CoordinatorAction; reply: string; state: RuntimeState } {
    const request = turn.request!;
    const text = turn.text.trim();
    const lower = text.toLowerCase();
    const meta = (conversation as any).buySellMeta;
    
    if (meta?.mode === "sell") {
      if (!meta.item) {
        const item = text.replace(/[?.!,]+$/, "").trim();
        (conversation as any).buySellMeta = { mode: "sell", item };
        return {
          action: "clarify",
          reply: `Great! 😊 Got it — you want to sell ${item}.\n\n📝 Can you tell me a bit more:\n• 📍 Where are you located (city/area)?\n• 💰 What's your asking price?\n• 📸 Any details you'd like to share (condition, etc.)?\n\nYou can answer what you have for now — I'll guide you from there.`,
          state: "clarification_needed",
        };
      } else {
        (conversation as any).buySellMeta = undefined;
        return {
          action: "answer",
          reply: `Thanks! I've noted your ${meta.item} for sale. 🛍️\n\nWhile direct marketplace posting isn't fully automated yet, I can help you find interested buyers in your community or connect you to relevant local businesses.\n\nWhat would you like to do next? Just tell me or type MENU to see options.`,
          state: "ready_for_request",
        };
      }
    } else if (meta?.mode === "buy") {
      if (!meta.item) {
        const item = text.replace(/[?.!,]+$/, "").trim();
        (conversation as any).buySellMeta = { mode: "buy", item };
        return {
          action: "clarify",
          reply: `Got it! 🛒 You're looking to buy ${item}.\n\n📍 Which city/area should I search in?\n💰 Do you have a budget in mind (optional)?\n\nTell me your location and I'll look for matches on TrustHub.`,
          state: "clarification_needed",
        };
      } else {
        (conversation as any).buySellMeta = undefined;
        return {
          action: "answer",
          reply: `Let me look for ${meta.item} in ${text}. 🔎\n\nI can help you find businesses that might have what you're looking for. Just tell me "find ${meta.item} in [city]" and I'll search for you, or type MENU for other options.`,
          state: "ready_for_request",
        };
      }
    }
    
    if (/\bsell\s+my\b/i.test(lower) || /\bi want to sell\b/i.test(lower) || (/\bsell\b/i.test(lower) && !/\bbuy\b/i.test(lower))) {
      const itemMatch = lower.match(/sell\s+(?:my\s+)?(.+?)(?:\.|$)/i) || lower.match(/want to sell\s+(.+?)(?:\.|$)/i);
      if (itemMatch && itemMatch[1] && itemMatch[1].trim().length > 2 && !/(something|anything|it)/i.test(itemMatch[1])) {
        const item = itemMatch[1].trim().replace(/[?.!,]+$/, "");
        (conversation as any).buySellMeta = { mode: "sell", item };
        return {
          action: "clarify",
          reply: `Great! 😊 Got it — you want to sell ${item}.\n\n📝 Can you tell me a bit more:\n• 📍 Where are you located (city/area)?\n• 💰 What's your asking price?\n• 📸 Any details you'd like to share (condition, etc.)?\n\nYou can answer what you have for now — I'll guide you from there.`,
          state: "clarification_needed",
        };
      }
      (conversation as any).buySellMeta = { mode: "sell" };
      return { action: "clarify", reply: `Great! 😊 What would you like to sell?`, state: "clarification_needed" };
    }
    
    if (/\bbuy\s+a\b/i.test(lower) || /\bi(?:'m| am) looking to buy\b/i.test(lower) || /\bi want to buy\b/i.test(lower) || (/\bbuy\b/i.test(lower) && !/\bsell\b/i.test(lower))) {
      const itemMatch = lower.match(/buy\s+(?:a\s+|an\s+)?(.+?)(?:\.|$)/i) || lower.match(/looking to buy\s+(.+?)(?:\.|$)/i) || lower.match(/want to buy\s+(.+?)(?:\.|$)/i);
      if (itemMatch && itemMatch[1] && itemMatch[1].trim().length > 2 && !/(something|anything|it)/i.test(itemMatch[1])) {
        const item = itemMatch[1].trim().replace(/[?.!,]+$/, "");
        (conversation as any).buySellMeta = { mode: "buy", item };
        return {
          action: "clarify",
          reply: `Got it! 🛒 You're looking to buy ${item}.\n\n📍 Which city/area should I search in?\n💰 Do you have a budget in mind (optional)?\n\nTell me your location and I'll look for matches on TrustHub.`,
          state: "clarification_needed",
        };
      }
      (conversation as any).buySellMeta = { mode: "buy" };
      return { action: "clarify", reply: `Got it! 🛒 What are you looking to buy?`, state: "clarification_needed" };
    }
    
    conversation.activeJourney = "buy_sell";
    return {
      action: "clarify",
      reply: `🛍️ Buy & Sell\n\nWhat would you like to do?\n\n* 🛒 Buy something\n* 🏷️ Sell something\n* 🔙 Back to the main menu\n\nJust pick one or tell me in your own words!`,
      state: "clarification_needed",
    };
  }

  /**
   * Option 9 — Improve TrustHub.
   *
   * Product feedback has no persistence path yet, so this journey records the
   * suggestion in conversation state and tells the user honestly that it is
   * being noted for the team. It never claims the feedback was saved to a
   * system the user cannot see.
   */
  private handleProductFeedback(turn: IncomingTurn, conversation: RuntimeConversation): { action: CoordinatorAction; reply: string; state: RuntimeState } {
    const text = turn.text.trim();
    if (text.length < 5 || /^improve trusthub$/i.test(text)) {
      return {
        action: "clarify",
        reply: "Tell me what would make your experience better — what should we improve or add?",
        state: "clarification_needed",
      };
    }
    conversation.lastRequest = turn.request ?? { text, intent: null, category: null, location: null, questionType: "general" };
    conversation.lastAction = "placeholder";
    return {
      action: "placeholder",
      reply: `Thanks — I've noted your suggestion about "${text.slice(0, 120)}" for the TrustHub team. Product feedback is not saved to a system you can see yet, but your suggestion is recorded in this conversation. Is there anything else I can help with?`,
      state: "ready_for_request",
    };
  }

  /**
   * Option 10 — Business Growth.
   *
   * No business analytics or growth services exist yet, so this journey is
   * honest about that and offers the supported alternative: improving a
   * business listing so more people can discover it.
   */
  private handleBusinessGrowth(turn: IncomingTurn, conversation: RuntimeConversation): { action: CoordinatorAction; reply: string; state: RuntimeState } {
    const text = turn.text.trim();
    if (text.length < 5 || /^business growth$/i.test(text)) {
      return {
        action: "clarify",
        reply: "Business Growth is planned, not available yet. The supported way to help your business get discovered right now is to add or improve its listing (option 2). Would you like to do that?",
        state: "ready_for_request",
      };
    }
    conversation.lastRequest = turn.request ?? { text, intent: null, category: null, location: null, questionType: "general" };
    return {
      action: "placeholder",
      reply: `I've noted your interest in Business Growth regarding "${text.slice(0, 120)}". Business insights and growth support are planned, not available yet. You can add or improve a business listing now (option 2), which is the supported way to help your business get discovered.`,
      state: "ready_for_request",
    };
  }

  /**
   * Routes a follow-up message to the journey a numbered menu selection
   * started. Every implemented journey reaches the SAME handler a
   * natural-language message would use, so the numbered path and the
   * natural-language path cannot drift.
   *
   * A journey that has no further handler is answered honestly rather than
   * silently resetting the conversation.
   */
  private async routeJourneyFollowUp(journey: string, turn: IncomingTurn, conversation: RuntimeConversation, priorState: RuntimeState): Promise<{ action: CoordinatorAction; reply: string; state: RuntimeState; resolution: ResolutionResult | null }> {
    switch (journey) {
      case "business_discovery":
      case "housing_rentals": {
        const request = turn.request ?? parseLocalSearchRequest(turn.text);
        if (!request) return { action: "clarify", reply: "Tell me what you'd like to find and where.", state: "clarification_needed", resolution: null };
        conversation.lastRequest = request;
        const resolution = await this.resolve(request, { ...turn.resolverContext, clarificationAsked: false });
        const mapped = await this.mapResolution(resolution);
        return { action: mapped.action, reply: mapped.reply, state: mapped.nextState, resolution };
      }
      case "jobs_recruitment": {
        const request = turn.request ?? recruitmentRequest(turn.text);
        if (!request) return { action: "clarify", reply: "Are you looking for work, or looking to hire someone?", state: "clarification_needed", resolution: null };
        conversation.lastRequest = request;
        const resolution = await this.resolve(request, { ...turn.resolverContext, clarificationAsked: false });
        const mapped = await this.mapResolution(resolution);
        return { action: mapped.action, reply: mapped.reply, state: mapped.nextState, resolution };
      }
      case "business_contribution": {
        // Prefer the explicit add-business recognizer, then an ordinary search
        // phrase ("bakery in Harare"). Only when the user answers the opening
        // question with just a name ("Sunny Bake") — which is not a complete
        // search — carry the category and city from the previous turn so the
        // existing handler asks for the missing city.
        const carried = conversation.lastRequest && turn.text.trim() && priorState === "clarification_needed" && !parseLocalSearchRequest(turn.text)
          ? { text: turn.text, intent: conversation.lastRequest.intent, category: conversation.lastRequest.category, location: conversation.lastRequest.location, questionType: conversation.lastRequest.questionType, entityName: turn.text.trim() }
          : null;
        const request = turn.request ?? addBusinessRequest(turn.text) ?? carried ?? parseLocalSearchRequest(turn.text);
        if (!request) return { action: "clarify", reply: "What is the business called, and where is it?", state: "clarification_needed", resolution: null };
        return { ...(await this.handleAddBusiness({ ...turn, request }, conversation)), resolution: null };
      }
      case "review_submission": {
        const carried = conversation.lastRequest && turn.text.trim() && priorState === "clarification_needed" && !parseLocalSearchRequest(turn.text)
          ? { text: turn.text, intent: conversation.lastRequest.intent, category: conversation.lastRequest.category, location: conversation.lastRequest.location, questionType: conversation.lastRequest.questionType, entityName: turn.text.trim() }
          : null;
        const request = turn.request ?? reviewRequest(turn.text) ?? carried ?? parseLocalSearchRequest(turn.text);
        if (!request) return { action: "clarify", reply: "Which business would you like to review, and in which city is it?", state: "clarification_needed", resolution: null };
        return { ...(await this.handleWriteReview({ ...turn, request }, conversation)), resolution: null };
      }
      case "community_intelligence": {
        const request = turn.request ?? parseLocalSearchRequest(turn.text);
        if (!request) return { action: "clarify", reply: "What would you like to learn more about in your community?", state: "clarification_needed", resolution: null };
        conversation.lastRequest = request;
        const resolution = await this.resolve(request, { ...turn.resolverContext, clarificationAsked: false });
        const mapped = await this.mapResolution(resolution);
        return { action: mapped.action, reply: mapped.reply, state: mapped.nextState, resolution };
      }
      case "business_rating": {
        const request = turn.request ?? { text: turn.text, intent: null, category: null, location: null, questionType: "general" };
        return { ...this.handleRateBusiness({ ...turn, request }, conversation), resolution: null };
      }
      case "buy_sell": {
        const request = turn.request ?? { text: turn.text, intent: null, category: null, location: null, questionType: "general" };
        return { ...this.handleBuySell({ ...turn, request }, conversation), resolution: null };
      }
      case "product_feedback": {
        const request = turn.request ?? { text: turn.text, intent: null, category: null, location: null, questionType: "general" };
        return { ...this.handleProductFeedback({ ...turn, request }, conversation), resolution: null };
      }
      case "business_growth": {
        const request = turn.request ?? { text: turn.text, intent: null, category: null, location: null, questionType: "general" };
        return { ...this.handleBusinessGrowth({ ...turn, request }, conversation), resolution: null };
      }
      default:
        return { action: "clarify", reply: "I can help with that. Tell me more and I'll route it.", state: "clarification_needed", resolution: null };
    }
  }
}


