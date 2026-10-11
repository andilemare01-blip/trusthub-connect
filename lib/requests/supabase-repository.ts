import type { CreateServiceRequest, RequestOutcome, ServiceRequest, ServiceRequestStatus } from "@/types/service-request";
import type { PendingRequestConfirmation, ServiceRequestRepository } from "./repository";
import { requireDatabaseBigintId, requireDatabaseUuid } from "../conversation-coordinator/persistence-mapping.ts";
import { requireData, SupabasePersistenceError, type SupabaseDataClient, type SupabaseRow } from "../supabase/data-client.ts";
import { createRuntimeEventId, type RuntimeEventRecorder } from "../observability/events.ts";
import { SupabaseRuntimeEventRecorder } from "../observability/supabase-recorder.ts";

const REQUEST_COLUMNS = "id,requester_id,community_id,title,description,status,resolved_at,created_at,conversation_id,requested_category,intent,area,source_channel,idempotency_key,community_consent_at,community_consent_version";
const OUTCOME_COLUMNS = "help_request_id,useful_answer_confirmed,match_confirmed,resolved_at,recorded_at";
const STATUSES = new Set<ServiceRequestStatus>(["open", "in_progress", "answered", "matched", "escalated_to_agent", "resolved", "unanswered", "cancelled"]);

function dateValue(value: unknown): string { return typeof value === "string" ? value : new Date().toISOString(); }

/**
 * One instant is not one string: the caller sends `Date#toISOString()`
 * (`2026-09-29T08:00:00.000Z`) while the database echoes the stored
 * `timestamptz` with an offset (`2026-09-29T08:00:00+00:00`). Idempotency must
 * compare the instant, not the incidental text each side produces. A value
 * that is not a parseable instant still compares exactly, so a genuine
 * mismatch is never masked.
 */
function sameInstant(left: unknown, right: unknown): boolean {
  const leftMs = Date.parse(String(left ?? ""));
  const rightMs = Date.parse(String(right ?? ""));
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return leftMs === rightMs;
  return String(left ?? "") === String(right ?? "");
}

export class SupabaseServiceRequestRepository implements ServiceRequestRepository {
  private readonly client: SupabaseDataClient;
  private readonly events: RuntimeEventRecorder;
  constructor(client: SupabaseDataClient, events?: RuntimeEventRecorder) {
    this.client = client;
    this.events = events ?? new SupabaseRuntimeEventRecorder(client);
  }

  async create(request: CreateServiceRequest): Promise<ServiceRequest> {
    if (!request.trustHubProfileId) throw new Error("A resolved TrustHub profile is required to record a request.");
    if (!request.communityConsentAt || !Number.isFinite(Date.parse(request.communityConsentAt))
      || !request.communityConsentVersion?.trim()) {
      throw new Error("Explicit, versioned requester consent is required before persistent community help processing.");
    }
    const idempotencyKey = request.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("A stable request idempotency key of at most 200 characters is required.");
    const profileId = requireDatabaseBigintId(request.trustHubProfileId, "help_requests requester profile");
    const communityId = requireDatabaseUuid(request.communityId, "help_requests.community_id");
    const conversationId = request.conversationId ? requireDatabaseBigintId(request.conversationId, "help_requests.conversation_id") : null;
    if (!request.communityKey?.trim()) throw new Error("A community-scoped request requires a resolved community key.");
    if (!request.requestText.trim()) throw new Error("A help request must include its request text.");
    if (request.status === "resolved" && !request.resolvedAt) throw new Error("Resolved help requests require a resolution timestamp.");
    if (request.status !== "resolved" && request.resolvedAt) throw new Error("Only resolved help requests may include a resolution timestamp.");

    const { data: profileData, error: profileError } = await this.client.from("profiles")
      .select("user_id").eq("id", profileId).maybeSingle();
    if (profileError) throw new SupabasePersistenceError("Resolve request owner: " + profileError.message, profileError.code);
    if (!profileData || Array.isArray(profileData)) throw new Error("The TrustHub profile for this request was not found.");
    const requesterId = (profileData as SupabaseRow).user_id;
    if (typeof requesterId !== "string") throw new Error("The TrustHub profile has no linked Auth user.");

    const payload: SupabaseRow = {
      requester_id: requesterId,
      community_id: communityId,
      title: request.requestedCategory ?? "TrustHub request",
      description: request.requestText,
      status: request.status,
      resolved_at: request.resolvedAt,
      conversation_id: conversationId,
      requested_category: request.requestedCategory,
      intent: request.intent,
      area: request.area ?? null,
      source_channel: request.sourceChannel ?? "web",
      idempotency_key: idempotencyKey,
      community_consent_at: request.communityConsentAt,
      community_consent_version: request.communityConsentVersion.trim(),
    };

    // ON CONFLICT DO NOTHING is atomic under concurrent retries. The unique
    // database constraint, not a check-then-insert, selects the winner.
    const result = await this.client.from("help_requests")
      .upsert(payload, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select(REQUEST_COLUMNS).maybeSingle();
    if (result.error && result.error.code !== "23505") {
      throw new SupabasePersistenceError("Create help request: " + result.error.message, result.error.code);
    }
    let row = result.data && !Array.isArray(result.data) ? result.data as SupabaseRow : null;
    if (!row) {
      const existing = await this.client.from("help_requests").select(REQUEST_COLUMNS)
        .eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing.error) throw new SupabasePersistenceError("Resolve idempotent help request: " + existing.error.message, existing.error.code);
      row = existing.data && !Array.isArray(existing.data) ? existing.data as SupabaseRow : null;
    }
    if (!row) throw new SupabasePersistenceError("Create help request: the idempotency key conflicted but its row could not be loaded.");
    this.assertSameRequest(row, payload);
    return this.mapRow(row, request.trustHubProfileId, request.communityKey);
  }

  /**
   * Reads the request a conversation is currently awaiting an explicit outcome
   * confirmation for. This is the only read the confirmation flow needs: the
   * lifecycle state itself stays owned by `recordOutcome`.
   */
  async findPendingConfirmation(conversationId: string): Promise<PendingRequestConfirmation | null> {
    const id = requireDatabaseBigintId(conversationId, "help_requests.conversation_id");
    const { data, error } = await this.client.from("help_requests")
      .select("id,status,resolved_at").eq("conversation_id", id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new SupabasePersistenceError("Load help request awaiting confirmation: " + error.message, error.code);
    if (!data || Array.isArray(data)) return null;
    const row = data as SupabaseRow;
    const status = String(row.status);
    if (!STATUSES.has(status as ServiceRequestStatus)) throw new SupabasePersistenceError("The database returned a help-request status outside the current contract.");
    return {
      serviceRequestId: String(row.id),
      status: status as ServiceRequestStatus,
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    };
  }

  async recordOutcome(outcome: RequestOutcome): Promise<void> {
    const id = requireDatabaseUuid(outcome.serviceRequestId, "help_request_outcomes.help_request_id");
    const result = await this.client.from("help_request_outcomes").upsert({
      help_request_id: id,
      useful_answer_confirmed: outcome.usefulAnswerConfirmed,
      match_confirmed: outcome.matchConfirmed,
      resolved_at: outcome.resolvedAt,
    }, { onConflict: "help_request_id" }).select(OUTCOME_COLUMNS).single();
    if (result.error) throw new SupabasePersistenceError("Record help request outcome: " + result.error.message, result.error.code);
    requireData<SupabaseRow>(result, "Record help request outcome");

    // Keep the existing lifecycle constraint: only an explicitly confirmed
    // resolution closes a request; answer/match facts remain in the outcome row.
    if (outcome.resolvedAt) {
      // The live `help_requests_connect_status_check` constrains this column to
      // the processing lifecycle only ('open', 'in_progress', 'resolved',
      // 'cancelled'); the confirmed answer/match facts are recorded in
      // `help_request_outcomes` above, which is where they are kept.
      const status: ServiceRequestStatus = "resolved";
      const update = await this.client.from("help_requests").update({ status, resolved_at: outcome.resolvedAt }).eq("id", id);
      if (update.error) throw new SupabasePersistenceError("Update resolved help request: " + update.error.message, update.error.code);
    }
    const occurredAt = outcome.resolvedAt ?? new Date().toISOString();
    await this.events.record({
      id: createRuntimeEventId("request_outcome_recorded", `${id}:${outcome.usefulAnswerConfirmed}:${outcome.matchConfirmed}:${outcome.resolvedAt ?? "pending"}`),
      name: "request_outcome_recorded",
      occurredAt,
      correlationId: id,
      actor: "user",
      entityType: "request",
      entityId: id,
      attributes: { usefulAnswerConfirmed: outcome.usefulAnswerConfirmed, matchConfirmed: outcome.matchConfirmed },
    });
  }

  private assertSameRequest(row: SupabaseRow, payload: SupabaseRow): void {
    const same = String(row.requester_id) === String(payload.requester_id)
      && String(row.community_id) === String(payload.community_id)
      && String(row.conversation_id ?? "") === String(payload.conversation_id ?? "")
      && String(row.description) === String(payload.description)
      && String(row.area ?? "") === String(payload.area ?? "")
      && String(row.requested_category ?? "") === String(payload.requested_category ?? "")
      && String(row.intent ?? "") === String(payload.intent ?? "")
      && String(row.source_channel ?? "") === String(payload.source_channel ?? "")
      && sameInstant(row.community_consent_at, payload.community_consent_at)
      && String(row.community_consent_version ?? "") === String(payload.community_consent_version ?? "");
    if (!same) throw new SupabasePersistenceError("The request idempotency key is already bound to a different logical request.", "idempotency_conflict");
  }

  private mapRow(row: SupabaseRow, profileId: string, communityKey: string): ServiceRequest {
    const status = String(row.status);
    if (!STATUSES.has(status as ServiceRequestStatus)) throw new SupabasePersistenceError("The database returned a help-request status outside the current contract.");
    const createdAt = dateValue(row.created_at);
    const resolvedAt = typeof row.resolved_at === "string" ? row.resolved_at : null;
    // Same definition as aggregateOutcomeMetrics: the row's resolved_at is the
    // explicit resolution timestamp, so the per-request metric equals
    // resolved_at - created_at and is never negative or invented.
    const startedAt = Date.parse(createdAt);
    const endedAt = resolvedAt === null ? Number.NaN : Date.parse(resolvedAt);
    const timeToUsefulAnswerSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
      ? (endedAt - startedAt) / 1000
      : null;
    return {
      id: String(row.id),
      conversationId: row.conversation_id == null ? null : String(row.conversation_id),
      trustHubProfileId: profileId,
      communityKey,
      communityId: String(row.community_id),
      area: typeof row.area === "string" ? row.area : null,
      sourceChannel: typeof row.source_channel === "string" ? row.source_channel as ServiceRequest["sourceChannel"] : "web",
      requestedCategory: typeof row.requested_category === "string" ? row.requested_category : null,
      requestText: String(row.description ?? ""),
      intent: (row.intent ?? null) as ServiceRequest["intent"],
      status: status as ServiceRequestStatus,
      createdAt,
      resolvedAt,
      timeToUsefulAnswerSeconds,
      communityConsentAt: typeof row.community_consent_at === "string" ? row.community_consent_at : null,
      communityConsentVersion: typeof row.community_consent_version === "string" ? row.community_consent_version : null,
    };
  }
}
