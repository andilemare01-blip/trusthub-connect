import type { NormalizedRequest } from "../answer-resolution/types.ts";
import type { RequestIntent } from "../../types/service-request";

export interface RecognizedIntent {
  intent: RequestIntent;
  questionType: NormalizedRequest["questionType"];
  request: NormalizedRequest;
}

const ADD_BUSINESS_PATTERNS: RegExp[] = [
  /\bthis business is missing\b/i,
  /\b(?:this|that) business is not (?:on|in|listed)\b/i,
  /\bi (?:want|would like) (?:to )?(?:add|submit|list|contribute)\b.*\b(?:business|shop|store|place|salon|dealer|outlet)\b/i,
  /\bcan i (?:add|submit|list|contribute)\b.*\b(?:business|shop|store|place|salon)\b/i,
  /\bi know a business (?:not on|that is not)\b/i,
  /\bi found a business (?:that is|which is) (?:not on|missing)\b/i,
  /\badd this business\b/i,
  /\bhow do i (?:add|list|submit|contribute)\b.*\b(?:business|shop|store|place)\b/i,
  /\bcan i (?:list|submit)\b.*\b(?:my|their)\b.*(?:business|shop)\b/i,
];

const REVIEW_WRITE_PATTERNS: RegExp[] = [
  /\bi (?:want|would like) (?:to )?(?:write|leave|share|add|give)\b.*\b(?:review|rating|experience|feedback)\b/i,
  /\bcan i (?:write|leave|share|add|give)\b.*\b(?:review|rating|experience|feedback)\b/i,
  /\bi want to rate\b/i,
  /\bcan i rate\b/i,
  /\bleave a review\b/i,
  /\bwrite a review\b/i,
  /\badd a review\b/i,
  /\bi just used this (?:service|business|place|shop)\b/i,
  /\bi want to tell people\b/i,
  /\bi have something to (?:share|say) about\b/i,
  /\bwhere can i share my experience\b/i,
  /\bhow do i leave a review\b/i,
];

const REVIEW_READ_PATTERNS: RegExp[] = [
  /\bwhat do people say about\b/i,
  /\bare there (?:reviews|experiences)\b/i,
  /\bshow me (?:reviews|experiences)\b/i,
  /\bwhat are the reviews for\b/i,
  /\breviews for\b/i,
  /\bwhat (?:are|is) the reviews\b/i,
  /\bcan i see (?:reviews|experiences)\b/i,
  /\bhonest (?:reviews|experiences)\b/i,
  /\bgood (?:reviews|experiences)\b/i,
];

const PROFILE_CREATION_PATTERNS: RegExp[] = [
  /\bi (?:want|would like) (?:to )?(?:create|get|have)(?: a)?\s*trusthub profile\b/i,
  /\bhow do i (?:create|make|set up|get)\b.*\btrusthub (?:profile|account)\b/i,
  /\bi (?:want|would like) a trusthub profile\b/i,
  /\bjoin trusthub\b/i,
  /\bsign up for trusthub\b/i,
  /\bregister (?:a|an)?\s*trusthub (?:account|profile)\b/i,
  /\bcreate my trusthub account\b/i,
  /\bget a trusthub profile\b/i,
];

export function recognizeNonSearchIntent(text: string): RecognizedIntent | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 500) return null;

  for (const pattern of PROFILE_CREATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent: "profile_creation",
        questionType: "profile_creation",
        request: {
          text: trimmed,
          intent: "profile_creation",
          category: null,
          location: null,
          questionType: "profile_creation",
        },
      };
    }
  }

  for (const pattern of ADD_BUSINESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent: "add_business",
        questionType: "add_business",
        request: {
          text: trimmed,
          intent: "add_business",
          category: null,
          location: null,
          questionType: "add_business",
        },
      };
    }
  }

  for (const pattern of REVIEW_WRITE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent: "review_experience",
        questionType: "review_write",
        request: {
          text: trimmed,
          intent: "review_experience",
          category: null,
          location: null,
          questionType: "review_write",
        },
      };
    }
  }

  for (const pattern of REVIEW_READ_PATTERNS) {
    if (pattern.test(trimmed)) {
      const category = extractMentionedEntity(trimmed);
      return {
        intent: "get_reviews",
        questionType: "reputation",
        request: {
          text: trimmed,
          intent: "get_reviews",
          category,
          location: null,
          questionType: "reputation",
        },
      };
    }
  }

  return null;
}

const LOCATION_INDICATORS = /\b(?:in|near|around|within)\s+/i;

function extractMentionedEntity(text: string): string | null {
  const cleaned = text.replace(LOCATION_INDICATORS, "").replace(/[?.!,;:]+$/, "").trim().toLowerCase();
  const reviewsPattern = /\b(?:reviews|experiences|rating|ratings)\s+(?:for|about|on)\s+(.+)$/i;
  const mentionPattern = /\b(?:people say|what are people saying|about|for)\s+(?:the\s+)?(.+)$/i;
  const match = reviewsPattern.exec(cleaned) ?? mentionPattern.exec(cleaned);
  if (match) {
    const entity = match[1].trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[?.!,;:]+$/, "");
    return entity || null;
  }
  return null;
}

export function isGreeting(text: string): boolean {
  return /^(?:hi|hie|hey|hello|hullo|good (?:morning|afternoon|evening))\b/i.test(text.trim());
}

export function isThanks(text: string): boolean {
  return /\b(?:thanks|thank you|thx|thnx|ty|cheers|appreciate|grateful|thankies)\b/i.test(text.trim());
}

export function isGoodbye(text: string): boolean {
  return /\b(?:bye|goodbye|bye bye|see you|see ya|ta? (?:ta)?(?:la)?ter|gonna go|have to go|need to go|got to go|catch you|catch ya)\b/i.test(text.trim());
}
