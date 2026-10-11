import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseReadClient, SupabaseReadEnvironment } from "./supabase-types";
import { SupabaseConfigurationError } from "./supabase-types";
import { SupabaseTrustHubClient } from "./supabase-read-adapter";

function configuredCredentials(environment: SupabaseReadEnvironment): { url: string; serverKey: string } {
  const url = environment.SUPABASE_URL;
  const serverKey = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serverKey) {
    throw new SupabaseConfigurationError("TrustHub reads are unavailable: server-side SUPABASE_URL and SUPABASE_SECRET_KEY are required for authenticated-only reads.");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("unsupported protocol");
  } catch {
    throw new SupabaseConfigurationError("TrustHub reads are unavailable: SUPABASE_URL must be a valid HTTPS URL (HTTP is allowed for localhost).", "invalid_url");
  }
  return { url, serverKey };
}

/** Creates a read-only adapter using a server-only credential. Never export this from a client-facing barrel. */
export function createServerTrustHubClient(environment: SupabaseReadEnvironment = process.env): SupabaseTrustHubClient {
  const { url, serverKey } = configuredCredentials(environment);
  const client = createClient(url, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "trusthub-connect-server-read" } },
  }) as unknown as SupabaseReadClient;
  return new SupabaseTrustHubClient(client);
}
