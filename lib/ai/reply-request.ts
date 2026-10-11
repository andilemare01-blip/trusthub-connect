import type { AIReplyRequest } from "./orchestrator.ts";

const MAX_HISTORY_TURNS = 20;
const MAX_MESSAGE_CHARS = 2000;

/**
 * A valid reply request carries a non-empty conversation id and
 * message; history is optional and bounded. Kept separate from the
 * route so the request contract is testable without the Next.js
 * runtime, and so invalid input is rejected before any provider or
 * database access.
 */
export function isReplyRequest(body: unknown): body is AIReplyRequest {
  if (body === null || typeof body !== "object") return false;
  const candidate = body as Partial<AIReplyRequest>;
  if (typeof candidate.conversationId !== "string" || candidate.conversationId.trim() === "") return false;
  if (typeof candidate.userMessage !== "string" || candidate.userMessage.trim() === "" || candidate.userMessage.length > MAX_MESSAGE_CHARS) return false;
  if (candidate.history === undefined) return true;
  if (!Array.isArray(candidate.history) || candidate.history.length > MAX_HISTORY_TURNS) return false;
  return candidate.history.every((turn) => (
    turn !== null && typeof turn === "object"
    && (turn.role === "user" || turn.role === "assistant")
    && typeof turn.text === "string"
  ));
}
