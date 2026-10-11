import type { IdentityResolutionResult } from "@/types/identity";

export class IdentityResolverNotConnectedError extends Error {
  constructor(method: string) {
    super(`IdentityResolver.${method} is not connected yet. No identity linking mechanism has been approved (see IMPLEMENTATION_PREREQUISITES.md items 1, 4, 6).`);
    this.name = "IdentityResolverNotConnectedError";
  }
}

/** Resolves an inbound WhatsApp phone number to a TrustHub identity — never creates a permanent isolated WhatsApp-only identity. */
export interface IdentityResolver {
  resolveByPhoneNumber(phoneNumber: string): Promise<IdentityResolutionResult>;
}

class NotConnectedIdentityResolver implements IdentityResolver {
  async resolveByPhoneNumber(): Promise<IdentityResolutionResult> {
    throw new IdentityResolverNotConnectedError("resolveByPhoneNumber");
  }
}

/** TODO: implement once the Supabase Auth capability facts in IMPLEMENTATION_PREREQUISITES.md item 4 are confirmed. */
export function createIdentityResolver(): IdentityResolver {
  return new NotConnectedIdentityResolver();
}
