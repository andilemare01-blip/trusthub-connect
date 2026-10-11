export type TrustHubRuntimeEventName =
  | "webhook_authenticated" | "inbound_normalized" | "identity_resolved" | "request_understood"
  | "knowledge_lookup" | "answer_resolved" | "contribution_recorded" | "community_help_planned"
  | "agent_match_proposed" | "handoff_status_changed" | "notification_dispatched" | "request_outcome_recorded";

export interface TrustHubRuntimeEvent {
  id: string;
  name: TrustHubRuntimeEventName;
  occurredAt: string;
  correlationId: string;
  actor: "system" | "user" | "provider" | "trust_agent";
  entityType: "conversation" | "request" | "contribution" | "community_help" | "agent_assignment" | "notification";
  entityId: string;
  /** Safe, low-cardinality operational facts only; never store message text, phone numbers, tokens, or coordinates here. */
  attributes: Record<string, string | number | boolean | null>;
}
