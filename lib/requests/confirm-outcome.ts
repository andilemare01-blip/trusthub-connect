/** Server-side helper: it is called from the persistent turn entry point and writes through the existing repository seam. */
import type { OutcomeConfirmation } from "../conversation-coordinator/types";
import type { ServiceRequestRepository } from "./repository";

export type OutcomeConfirmationResult = "recorded" | "not_pending" | "no_request";

/**
 * Converts exactly one explicit requester confirmation into the persistent
 * `help_request_outcomes` record through the existing service-request
 * repository seam, so the coordinator never writes to Supabase directly.
 *
 * Idempotency: the outcome row is keyed by `help_request_id` (one current
 * outcome per request), the runtime event ID is derived from the recorded
 * facts, and a request that already carries a resolution timestamp (or is
 * resolved/cancelled) is never re-confirmed. A retried webhook therefore
 * cannot produce a second outcome or a second runtime event.
 */
export async function recordRequestOutcomeConfirmation(
  repository: ServiceRequestRepository,
  input: { conversationId: string; confirmation: OutcomeConfirmation },
): Promise<OutcomeConfirmationResult> {
  const pending = await repository.findPendingConfirmation(input.conversationId);
  if (!pending) return "no_request";
  if (pending.resolvedAt || pending.status === "resolved" || pending.status === "cancelled") return "not_pending";
  await repository.recordOutcome({
    serviceRequestId: pending.serviceRequestId,
    usefulAnswerConfirmed: input.confirmation.helpful,
    matchConfirmed: input.confirmation.helpful && input.confirmation.matchConfirmed,
    // Only an explicitly useful answer closes the request; a "no" records the
    // fact and leaves the existing lifecycle status untouched.
    resolvedAt: input.confirmation.helpful ? input.confirmation.confirmedAt : null,
  });
  return "recorded";
}