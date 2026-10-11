/**
 * Contact/connection-flow types for TrustHub Connect.
 *
 * NOT a confirmed database schema. Models the consent-based "can you
 * contact this one for me?" flow — private contact details must never be
 * exposed without the provider's consent.
 */

export interface ContactRequest {
  id: string;
  serviceRequestId: string;
  candidateBusinessOrProviderId: string;
  requestedByProfileId: string;
  createdAt: string;
}

export type ProviderConsentDecision = "pending" | "accepted" | "declined";

export interface ProviderConsent {
  contactRequestId: string;
  decision: ProviderConsentDecision;
  decidedAt: string | null;
}

export type ConnectionOutcomeStatus = "pending" | "connected" | "declined" | "expired";

export interface ConnectionRequest {
  id: string;
  contactRequestId: string;
  status: ConnectionOutcomeStatus;
  createdAt: string;
}

export interface ConnectionOutcome {
  connectionRequestId: string;
  status: ConnectionOutcomeStatus;
  resolvedAt: string | null;
}
