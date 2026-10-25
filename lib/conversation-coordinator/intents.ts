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
  /\bi (?:want|would like) (?:to )?(?:add|submit|list|contribute)\b.*?(?:business|shop|store|place|salon|dealer|outlet)\b/i,
  /\bcan i (?:add|submit|list|contribute)\b.*?(?:business|shop|store|place|salon)\b/i,
  /\bi know a business (?:not on|that is not)\b/i,
  /\bi found a business (?:that is|which is) (?:not on|missing)\b/i,
  /\badd this business\b/i,
  /\bhow do i (?:add|list|submit|contribute)\b.*?(?:business|shop|store|place)\b/i,
  /\bcan i (?:list|submit)\b.*?(?:my|their)\b.*?(?:business|shop)\b/i,
  // Shona / local variations
  /\bndoda kuisa\b.*?(?:bhizimisi|shop|store)\b/i,
  /\bndinoda kuwedzera\b.*?(?:bhizimisi|shop|store)\b/i,
];

const REVIEW_WRITE_PATTERNS: RegExp[] = [
  /\bi (?:want|would like) (?:to )?(?:write|leave|share|add|give)\b.*?(?:review|rating|experience|feedback)\b/i,
  /\bcan i (?:write|leave|share|add|give)\b.*?(?:review|rating|experience|feedback)\b/i,
  /\bi want to rate\b/i,
  /\bcan i rate\b/i,
  /\bleave a review\b/i,
  /\bwrite a review\b/i,
  /\badd a review\b/i,
  /\bi just used this (?:service|business|place|shop)\b/i,
  /\bi want to tell people\b/i,
  /\bi have something to (?:share|say) about\b/i,
  /\bwhere can i share my experience\b/i,
  /\bhow do i (?:leave|write|add)\b.*?review\b/i,
  /\bhow do i rate\b.*?(?:business|place|shop|service)\b/i,
  // Shona / local variations
  /\bndinoda kuleta\b.*?(?:review|rating)\b/i,
  /\bndinoda kureview\b/i,
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
  // Shona / local variations
  /\bvanhu vanoti\b.*?(?:review|rating)\b/i,
  /\bzviri kutaurwa\b/i,
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
  // Shona / local variations
  /\bndinoda\b.*?trusthub profile\b/i,
  /\bndinoda kuve\b.*?trusthub\b/i,
];

// Accommodation search patterns - for finding places to stay
const ACCOMMODATION_PATTERNS: RegExp[] = [
  /\b(?:where|place|somewhere) (?:to stay|for accommodation|to sleep)\b/i,
  /\b(?:need|want|looking for)\b.*?(?:accommodation|place to stay|somewhere to stay|hotel|lodge|guesthouse|b&b|bed and breakfast|airbnb)\b/i,
  /\bcan you (?:find|recommend)\b.*?(?:accommodation|place to stay|hotel|lodge|guesthouse)\b/i,
  /\bwhere can i stay\b/i,
  // Budget/date preferences
  /\b(?:cheap|affordable|budget)\b.*?(?:accommodation|place to stay|hotel)\b/i,
  /\bfor tonight\b.*?(?:accommodation|place to stay|hotel)\b/i,
  /\btonight\b.*?(?:accommodation|place to stay|hotel)\b/i,
  // Shona variations
  /\bndinoda\b.*?(?:kugara|hoteru|roji|gesto hauzi)\b/i,
  /\bkugara\b.*?(?:mawana|mangwanani|manheru)\b/i,
];

// Recruitment patterns - distinguish job seeking, recruiting and vacancy
// enquiries from ordinary business discovery. Patterns are broad enough to
// catch recruitment wording, while `recruitmentIntent` classifies the exact
// role so a service search ("I need a plumber") is not mistaken for hiring.
const RECRUITMENT_PATTERNS: RegExp[] = [
  /\b(i ?(?:am|'m|was|been)?\s*)?(looking\s+for|need|want|searching\s+for)\s+(?:a\s+)?(?:job|work|employment|position|role)\b/i,
  /\b(find|get)\s+(?:me\s+)?(?:a\s+)?(?:job|work|employment)\b/i,
  /\bi (?:need|want|am looking for) work\b/i,
  /\b(j?ob\s*(?:seeker|seeking|hunting))\b/i,
  /\bi (?:want|need|would like) (?:to )?(?:be|get )?(?:hired|employed)\b/i,
  /\b(?:i ?(?:am|'m)|we ?(?:are|'re)|my company|our business)\s+(?:are\s+)?(?:looking\s+for|need|want|hiring|recruit(?:ing|ment)?)\s+(?:someone|people|staff|workers|employees|candidates|applicants|a candidate|an applicant)\b/i,
  /\b(?:we|i)\s+(?:need|want|are looking for)\s+(?:to\s+)?(?:hire|recruit)\b/i,
  /\b(?:we|i)\s+(?:need|want)\s+(?:\d+|one|two|three|four|five|several|many)\s+(?:drivers|plumbers|accountants|teachers|nurses|cleaners|security|workers|staff|employees|people)\b/i,
  /\bto hire\b/i,
  /\b(?:do\s+you\s+)?(?:have|any)\s+(?:vacancies|job openings|open positions|job vacancies)\b/i,
  /\b(i ?(?:want|would like)|we ?(?:want|would like)) (?:to )?(?:advertise|post|list|create)\s+(?:a\s+)?(?:job|vacancy|position|role)\b/i,
  /\b(find|looking for)\s+(?:someone|a|candidate|person)\s+(?:with|for)\s+(?:accounting|driving|plumbing|electrical|teaching|nursing|cleaning|security|farming|mining|retail|hospitality)\b/i,
  /\b(candidate|applicant|job applicant)\b/i,
  /\b(?:what|how)\s+(?:happened|is|are)\s+(?:to|with)\s+(?:my|the)\s+(?:job|application|vacancy|request)\b/i,
  /\b(?:status|update)\s+(?:of|on|for)\s+(?:my|the)\s+(?:job|application|vacancy|request)\b/i,
  /\b(recruitment|recruit|recruiting|hiring|employment|vacancy|vacancies)\b/i,
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

  for (const pattern of ACCOMMODATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent: "find_business",
        questionType: "business_discovery",
        request: {
          text: trimmed,
          intent: "find_business",
          category: "accommodation",
          location: null,
          questionType: "business_discovery",
        },
      };
    }
  }

  for (const pattern of RECRUITMENT_PATTERNS) {
    if (pattern.test(trimmed)) return recruitmentIntent(trimmed);
  }

  return null;
}

function recruitmentIntent(text: string): RecognizedIntent {
  const intent: RequestIntent =
    /\b(?:advertise|post|list|create)\s+(?:a\s+)?(?:job|vacancy|position|role)\b/i.test(text) ? "vacancy_create"
    : /\b(?:status|update|what happened)\b/i.test(text) ? "recruitment_status"
    : /\b(?:vacancies|job openings|open positions)\b/i.test(text) ? "vacancy_search"
    : /\b(candidate|applicant|someone with|someone\s+for)\b/i.test(text) ? "candidate_search"
    : /\b(?:hiring|recruit|recruiting|employ|to hire|need to hire|want to hire)\b/i.test(text) ? "employer_recruiting"
    : /\b\d+\s+(?:drivers|plumbers|accountants|teachers|nurses|cleaners|security|workers|staff|employees|people)\b/i.test(text) ? "employer_recruiting"
    : /\b(?:one|two|three|four|five|several|many)\s+(?:drivers|plumbers|accountants|teachers|nurses|cleaners|security|workers|staff|employees|people)\b/i.test(text) ? "employer_recruiting"
    : /\b(recruitment|employment|vacancy)\b/i.test(text) ? "recruitment_other"
    : "job_seeker";
  return {
    intent,
    questionType: "recruitment",
    request: {
      text: text.trim(),
      intent,
      category: null,
      location: null,
      questionType: "recruitment",
    },
  };
}

const LOCATION_INDICATORS = /\b(?:in|near|around|within)\s+/i;

function extractMentionedEntity(text: string): string | null {
  const cleaned = text.replace(LOCATION_INDICATORS, "").replace(/[?.!,;:]+$/, "").trim().toLowerCase();
  const reviewsPattern = /\b(?:reviews|experiences|rating|ratings)\s+(?:for|about|on)\s+(.+)$/i;
  const mentionPattern = /\b(?:people say|what are people saying|about|for)\s+(?:the\s+)?(.+)$/i;
  const match = reviewsPattern.exec(cleaned) ?? mentionPattern.exec(cleaned);
  if (match) {
    const entity = match[1].trim().replace(/^(?:the|a|an|about)\s+/i, "").replace(/[?.!,;:]+$/, "");
    return entity || null;
  }
  return null;
}

export function isGreeting(text: string): boolean {
  return /^(?:hi|hie|hey|hello|hullo|good (?:morning|afternoon|evening)|mhoro|mhoroi)\b/i.test(text.trim());
}

export function isThanks(text: string): boolean {
  return /\b(?:thanks|thank you|thx|thnx|ty|cheers|appreciate|grateful|thankies|tatenda|ndinotenda)\b/i.test(text.trim());
}

export function isGoodbye(text: string): boolean {
  return /\b(?:bye|goodbye|bye bye|see you|see ya|ta? (?:ta)?(?:la)?ter|gonna go|have to go|need to go|got to go|catch you|catch ya|sara mushe|sara zvakanaka)\b/i.test(text.trim());
}
