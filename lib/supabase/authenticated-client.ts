import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AuthenticationRequiredError, requireAuthenticatedEnvironment, requireAuthenticatedUser, type VerifiedAuthUser } from "./authentication";
import type { SupabaseReadClient, SupabaseReadEnvironment } from "../trusthub/supabase-types";
import { SupabaseTrustHubClient } from "../trusthub/supabase-read-adapter";
import type { KnowledgeRecordReadClient } from "../trusthub/knowledge-record-read-adapter";

export interface AuthenticatedSupabaseCaller { user: VerifiedAuthUser; trustHub: SupabaseTrustHubClient; knowledgeRecords: KnowledgeRecordReadClient; }
export async function createAuthenticatedSupabaseCaller(accessToken: string | null | undefined, environment: SupabaseReadEnvironment = process.env): Promise<AuthenticatedSupabaseCaller> {
  if (!accessToken?.trim()) throw new AuthenticationRequiredError();
  const { url, publishableKey } = requireAuthenticatedEnvironment(environment);
  const client = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${accessToken.trim()}` } } });
  const user = await requireAuthenticatedUser(accessToken, client);
  return {
    user,
    trustHub: new SupabaseTrustHubClient(client as unknown as SupabaseReadClient),
    knowledgeRecords: client as unknown as KnowledgeRecordReadClient,
  };
}
export { AuthenticationRequiredError };
