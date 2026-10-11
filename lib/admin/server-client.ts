import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { AdminAuthClient } from "./authorization";
import type { AdminDataClient } from "./dashboard-data";

/** Privileged client for server-side admin reads only; it is never sent to or built in browser code. */
export function createAdminServerClient(environment: Record<string, string | undefined> = process.env): (AdminAuthClient & AdminDataClient) | null {
  const url = environment.SUPABASE_URL;
  const key = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }) as unknown as AdminAuthClient & AdminDataClient;
}
