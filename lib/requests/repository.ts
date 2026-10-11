import type { CreateServiceRequest, RequestOutcome, ServiceRequest, ServiceRequestStatus } from "@/types/service-request";
import { createSupabaseServerClient } from "../supabase/server-client";
import { SupabaseServiceRequestRepository } from "./supabase-repository";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`ServiceRequestRepository.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/**
 * Persistence seam for service requests. Before this is implemented, the
 * existing `public.help_requests` table must be inspected — it may already
 * cover this need in whole or in part (see
 * TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md Section 9).
 */
export interface ServiceRequestRepository {
  create(request: CreateServiceRequest): Promise<ServiceRequest>;
  recordOutcome(outcome: RequestOutcome): Promise<void>;
  findPendingConfirmation(conversationId: string): Promise<PendingRequestConfirmation | null>;
}

/** The `help_requests` row a conversation is currently awaiting an explicit outcome confirmation for. */
export interface PendingRequestConfirmation {
  serviceRequestId: string;
  status: ServiceRequestStatus;
  /** Non-null once an explicit confirmation has already closed the request. */
  resolvedAt: string | null;
}

/** Server-only production adapter over the existing public.help_requests table. */
export function createServiceRequestRepository(): ServiceRequestRepository {
  return new SupabaseServiceRequestRepository(createSupabaseServerClient());
}
