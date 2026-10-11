import type { AdminContext } from "@/types/admin";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`AuthorizationGateway.${method} is not connected yet. Role-based permissions are not implemented.`);
    this.name = "NotConnectedError";
  }
}

/**
 * Server-side authorization seam for the future OWNER/TRUST_AGENT-gated
 * admin system. `admin_users` currently has no role column (VERIFIED) — a
 * role-storage mechanism must be designed before this can be implemented.
 * The existing `/admin` UI remains an explicitly non-production skeleton.
 */
export interface AuthorizationGateway {
  getContextForRequest(bearerToken: string): Promise<AdminContext>;
}

class NotConnectedAuthorizationGateway implements AuthorizationGateway {
  async getContextForRequest(): Promise<AdminContext> {
    throw new NotConnectedError("getContextForRequest");
  }
}

/** TODO: role-specific permissions need a role-storage design; `authorizeAdminRequest` below covers membership only. */
export function createAuthorizationGateway(): AuthorizationGateway {
  return new NotConnectedAuthorizationGateway();
}

export interface AdminAuthClient {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }> };
  from(table: "admin_users"): { select(columns: string): { eq(column: string, value: string): { limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } } };
}

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; reason: "missing_token" | "invalid_token" | "not_admin" | "unavailable" };

/**
 * Server-side admin check: the caller must present a valid Supabase access token for a user listed in
 * `admin_users`. It is the same membership test TrustHub's own admin API uses; there is no separate login system.
 */
export async function authorizeAdminRequest(authorization: string | null | undefined, client: AdminAuthClient): Promise<AdminAuthResult> {
  const match = /^Bearer\s+(\S{20,4096})$/i.exec(authorization?.trim() ?? "");
  if (!match) return { ok: false, status: 401, reason: "missing_token" };
  let userId: string | undefined;
  try {
    const { data, error } = await client.auth.getUser(match[1]);
    if (error || !data.user?.id) return { ok: false, status: 401, reason: "invalid_token" };
    userId = data.user.id;
  } catch {
    return { ok: false, status: 503, reason: "unavailable" };
  }
  try {
    const { data, error } = await client.from("admin_users").select("user_id").eq("user_id", userId).limit(1);
    if (error) return { ok: false, status: 503, reason: "unavailable" };
    return data && data.length > 0 ? { ok: true, userId } : { ok: false, status: 403, reason: "not_admin" };
  } catch {
    return { ok: false, status: 503, reason: "unavailable" };
  }
}
