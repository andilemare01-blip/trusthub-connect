import "server-only";
import { createAdminServerClient } from "../admin/server-client";

/** Checks an email and password against TrustHub accounts and returns the user id, or null. */
export async function passwordUser(email: string, password: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null) as { user?: { id?: string } } | null;
  return body?.user?.id ?? null;
}

type Created = { data: { user: { id: string } | null }; error: { message: string; code?: string; status?: number } | null };
type AdminAuth = { auth: { admin: { createUser(input: { email: string; password: string; email_confirm: boolean; user_metadata: Record<string, string> }): Promise<Created> } } };

/** Makes the account for a new agent applicant. An existing account joins with its own correct password. */
export async function accountFor(email: string, password: string, name: string): Promise<string | null> {
  const client = createAdminServerClient() as unknown as AdminAuth | null;
  if (!client) return null;
  const made = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, purpose: "agent" } });
  if (made.data.user?.id) return made.data.user.id;
  return passwordUser(email, password);
}
