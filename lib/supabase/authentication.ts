export interface VerifiedAuthUser { id: string; phone?: string | null; }
export interface AuthVerificationClient { auth: { getUser(jwt?: string): Promise<{ data: { user: VerifiedAuthUser | null }; error: { message: string } | null }>; }; }

export class AuthenticationRequiredError extends Error {
  constructor(message = "A valid authenticated Supabase user is required.") { super(message); this.name = "AuthenticationRequiredError"; }
}
export class SupabaseAuthenticationConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "SupabaseAuthenticationConfigurationError"; }
}

export function requireAuthenticatedEnvironment(environment: Record<string, string | undefined>): { url: string; publishableKey: string } {
  const url = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new SupabaseAuthenticationConfigurationError("Authenticated Supabase access is unavailable: configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for server-side caller validation.");
  try { const parsed = new URL(url); if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error(); }
  catch { throw new SupabaseAuthenticationConfigurationError("Authenticated Supabase access requires a valid HTTPS SUPABASE_URL (HTTP is allowed only for localhost). "); }
  return { url, publishableKey };
}

export async function requireAuthenticatedUser(accessToken: string | null | undefined, client: AuthVerificationClient): Promise<VerifiedAuthUser> {
  const token = accessToken?.trim();
  if (!token) throw new AuthenticationRequiredError();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) throw new AuthenticationRequiredError("The Supabase access token is invalid or expired.");
  return data.user;
}
