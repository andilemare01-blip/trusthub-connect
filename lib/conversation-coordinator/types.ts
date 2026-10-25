import type { NormalizedRequest, ResolutionResult, ResolverContext } from "../answer-resolution/types";
import type { ConversationMessage } from "../../types/conversation";
import type { WhatsAppMediaMetadata } from "../whatsapp/provider";
import type { DetectedContribution } from "../contributions/detection";
import type { StructuredUnderstanding } from "../ai/understanding";

export type RuntimeState = "ready_for_request" | "understanding_request" | "clarification_needed" | "searching_trusthub" | "answer_found" | "answer_uncertain" | "asking_community" | "waiting_for_community" | "trust_agent_offer" | "human_handoff" | "waiting_for_agent" | "profile_creation" | "profile_created" | "business_submission" | "review_writing" | "resolved" | "abandoned" | "unresolved";
export type CoordinatorAction = "answer" | "clarify" | "contribution_recorded" | "ask_community_permission" | "community_request_consented" | "community_request_declined" | "request_human_permission" | "human_handoff_consented" | "human_handoff_declined" | "final_unresolved" | "profile_creation" | "profile_created" | "business_submission" | "review_writing" | "show_menu" | "start_journey" | "placeholder";

export interface RuntimeConversation {
  id: string;
  state: RuntimeState;
  pendingPermission: "community" | "human" | null;
  lastRequest: NormalizedRequest | null;
  lastResolution: ResolutionResult | null;
  lastAction: CoordinatorAction | null;
  /** Display name assigned once per conversation; the engine and library are shared by every name. */
  assistantName?: string;
  /** One search task spans clarifications and follow-ups; it completes when a useful result is delivered. */
  activeTask?: { seq: number; completed: boolean };
  /** The Service Board journey a numbered selection started, if any. Preserved
   * across follow-ups so a menu number and its natural-language equivalent
   * reach the same handler; cleared when the journey finishes or the user
   * starts an unrelated task. */
  activeJourney?: string;
  messages: ConversationMessage[];
  transitions: { from: RuntimeState; to: RuntimeState; at: string; reason: string }[];
  updatedAt: string;
  persistence?: { channel: "whatsapp" | "web" | "admin" | "system"; whatsappIdentityId: string | null; profileId: string | null; communityId: string | null; area: string | null };
}

export interface IncomingTurn {
  conversationId: string;
  text: string;
  request?: NormalizedRequest;
  /** Explicit caller-provided consent signal; consent is never inferred from a non-answer. */
  communityConsent?: boolean;
  humanConsent?: boolean;
  resolverContext?: ResolverContext;
  channel?: "whatsapp" | "web" | "admin" | "system";
  providerMessageId?: string | null;
  media?: WhatsAppMediaMetadata[];
  contributionCandidate?: DetectedContribution | null;
  understanding?: StructuredUnderstanding;
  /** False when the sender has no TrustHub profile; community requests need one, so none is offered. Unset means unknown. */
  profileLinked?: boolean;
  /** The sender's E.164 WhatsApp number, when the caller knows it. Profile creation needs it; it is never logged. */
  senderPhoneNumber?: string | null;
  correlationId?: string;
}

/**
 * One explicit requester confirmation about whether the delivered answer or
 * match actually helped. It is only produced by the confirmation turn that
 * follows an `answer_found`/`answer_uncertain` reply, and it is the sole
 * permitted trigger for the persistent `help_request_outcomes` record.
 */
export interface OutcomeConfirmation {
  helpful: boolean;
  confirmedAt: string;
  /** True only when the confirmed answer actually named a TrustHub-listed business or provider. */
  matchConfirmed: boolean;
}

export interface TurnResult {
  conversationId: string;
  state: RuntimeState;
  action: CoordinatorAction;
  reply: string;
  resolution: ResolutionResult | null;
  conversation: RuntimeConversation;
  /** True only when this inbound turn explicitly granted community sharing consent. */
  communityConsentGranted: boolean;
  communityConsentAt: string | null;
  /** Present only on the explicit "did that help?" confirmation turn; null on every other turn. */
  outcomeConfirmation: OutcomeConfirmation | null;
  /** Set only on the turn that delivered the first useful result of a search task. */
  completedTask?: { taskId: string };
  /** Set when the person explicitly changed how often they hear from TrustHub; the caller persists it. */
  notificationPreference?: "off" | "reduced" | "on";
}
