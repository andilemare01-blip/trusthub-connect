import type { ConnectionOutcome, ConnectionRequest, ContactRequest, ProviderConsent } from "@/types/connection";

export class ConnectionCoordinatorNotConnectedError extends Error {
  constructor(method: string) {
    super(`ConnectionCoordinator.${method} is not connected yet. Private contact details must never be exposed without provider consent.`);
    this.name = "ConnectionCoordinatorNotConnectedError";
  }
}

/** Consent-based "can you contact this one for me?" flow — does not expose private contact info until the provider consents. */
export interface ConnectionCoordinator {
  requestContact(request: Omit<ContactRequest, "id" | "createdAt">): Promise<ContactRequest>;
  recordProviderConsent(consent: ProviderConsent): Promise<void>;
  getOutcome(connectionRequestId: string): Promise<ConnectionOutcome | null>;
}

class NotConnectedConnectionCoordinator implements ConnectionCoordinator {
  async requestContact(): Promise<ContactRequest> {
    throw new ConnectionCoordinatorNotConnectedError("requestContact");
  }

  async recordProviderConsent(): Promise<void> {
    throw new ConnectionCoordinatorNotConnectedError("recordProviderConsent");
  }

  async getOutcome(): Promise<ConnectionOutcome | null> {
    throw new ConnectionCoordinatorNotConnectedError("getOutcome");
  }
}

/** TODO: implement once the contact/connection consent workflow is designed and approved. Never implements live WhatsApp calling. */
export function createConnectionCoordinator(): ConnectionCoordinator {
  return new NotConnectedConnectionCoordinator();
}

// Referenced for documentation purposes only, to keep the ConnectionRequest type reachable from this module's public surface.
export type { ConnectionRequest };
