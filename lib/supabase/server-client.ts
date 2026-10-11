import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseReadEnvironment } from "../trusthub/supabase-types";
import { SupabaseConfigurationError } from "../trusthub/supabase-types";
import type { SupabaseDataClient } from "./data-client";
import { createResilientDataClient } from "./retry";

export function createSupabaseServerClient(environment: SupabaseReadEnvironment = process.env): SupabaseDataClient {
  const url = environment.SUPABASE_URL;
  const key = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new SupabaseConfigurationError("Server persistence is unavailable: set SUPABASE_URL and server-only SUPABASE_SECRET_KEY.");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("unsupported protocol");
  } catch {
    throw new SupabaseConfigurationError("Server persistence is unavailable: SUPABASE_URL must be a valid HTTPS URL (HTTP is allowed for localhost).", "invalid_url");
  }
// Supabase sends every write as a POST, and postgrest-js only retries
  // GET/HEAD/OPTIONS. The wrapper repeats transport failures for writes that a
  // UNIQUE guard makes safe to repeat, and preserves the operating-system
  // cause (ECONNRESET, ENOTFOUND, UND_ERR_*) that a bare message drops.
  return createResilientDataClient(createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }) as unknown as SupabaseDataClient);
}
