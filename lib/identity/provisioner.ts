import type { IdentityProvisionRequest, TrustHubProfile } from "@/types/identity";

export class IdentityProvisionerNotConnectedError extends Error {
  constructor(method: string) {
    super(`IdentityProvisioner.${method} is not connected yet. Profile provisioning must reuse TrustHub's own profile creation path — not a shadow table.`);
    this.name = "IdentityProvisionerNotConnectedError";
  }
}

/** Creates a minimal, real TrustHub profile for a WhatsApp-first user with no existing account. Must never create a separate WhatsApp-only identity store. */
export interface IdentityProvisioner {
  provisionProfile(request: IdentityProvisionRequest): Promise<TrustHubProfile>;
}

class NotConnectedIdentityProvisioner implements IdentityProvisioner {
  async provisionProfile(): Promise<TrustHubProfile> {
    throw new IdentityProvisionerNotConnectedError("provisionProfile");
  }
}

/** TODO: implement once Supabase Auth provisioning capability (IMPLEMENTATION_PREREQUISITES.md item 4) is confirmed and approved. */
export function createIdentityProvisioner(): IdentityProvisioner {
  return new NotConnectedIdentityProvisioner();
}
