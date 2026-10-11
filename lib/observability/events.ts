import type { TrustHubRuntimeEvent } from "@/types/runtime-event";
import { createHash } from "node:crypto";

export interface RuntimeEventRecorder { record(event: TrustHubRuntimeEvent): Promise<void>; }

export class RuntimeEventValidationError extends Error {
  constructor(message: string) { super(message); this.name = "RuntimeEventValidationError"; }
}

const SENSITIVE_ATTRIBUTE = /(text|body|phone|token|secret|coordinate|latitude|longitude|address|email)/i;
const EVENT_NAMES = new Set<TrustHubRuntimeEvent["name"]>([
  "webhook_authenticated", "inbound_normalized", "identity_resolved", "request_understood",
  "knowledge_lookup", "answer_resolved", "contribution_recorded", "community_help_planned",
  "agent_match_proposed", "handoff_status_changed", "notification_dispatched", "request_outcome_recorded",
]);
const EVENT_ACTORS = new Set<TrustHubRuntimeEvent["actor"]>(["system", "user", "provider", "trust_agent"]);
const EVENT_ENTITIES = new Set<TrustHubRuntimeEvent["entityType"]>(["conversation", "request", "contribution", "community_help", "agent_assignment", "notification"]);

/** Rejects sensitive payload fields before events reach an observability sink. */
export function validateRuntimeEvent(event: TrustHubRuntimeEvent): TrustHubRuntimeEvent {
  if (!event.id || event.id.length > 160 || !event.correlationId || event.correlationId.length > 160 || !event.entityId || event.entityId.length > 160 || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new RuntimeEventValidationError("Runtime events require stable IDs and a valid timestamp.");
  }
  if (!EVENT_NAMES.has(event.name) || !EVENT_ACTORS.has(event.actor) || !EVENT_ENTITIES.has(event.entityType)) {
    throw new RuntimeEventValidationError("Runtime event name, actor, or entity type is not supported.");
  }
  for (const [key, value] of Object.entries(event.attributes)) {
    if (SENSITIVE_ATTRIBUTE.test(key)) throw new RuntimeEventValidationError(`Sensitive runtime event attribute is prohibited: ${key}.`);
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
      throw new RuntimeEventValidationError(`Runtime event attribute must be scalar: ${key}.`);
    }
    if (typeof value === "string" && value.length > 160) throw new RuntimeEventValidationError(`Runtime event attribute is too long: ${key}.`);
  }
  return structuredClone(event);
}

/** Stable event key for retry-safe writes without storing the original source ID. */
export function createRuntimeEventId(name: TrustHubRuntimeEvent["name"], sourceEventId: string): string {
  const source = sourceEventId.trim();
  if (!source || source.length > 2048) throw new RuntimeEventValidationError("A stable source event ID is required.");
  return `event:${createHash("sha256").update(`${name}\0${source}`, "utf8").digest("hex")}`;
}

/** Local test recorder; production sinks remain intentionally unconfigured. */
export class InMemoryRuntimeEventRecorder implements RuntimeEventRecorder {
  readonly events: TrustHubRuntimeEvent[] = [];
  async record(event: TrustHubRuntimeEvent): Promise<void> { this.events.push(validateRuntimeEvent(event)); }
}
