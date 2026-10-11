export interface SupabaseReadEnvironment {
  [key: string]: string | undefined;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface SupabaseReadResponse {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface SupabaseReadQuery extends PromiseLike<SupabaseReadResponse> {
  select(columns: string): SupabaseReadQuery;
  eq(column: string, value: string): SupabaseReadQuery;
  ilike(column: string, pattern: string): SupabaseReadQuery;
  or(filters: string): SupabaseReadQuery;
  limit(count: number): SupabaseReadQuery;
}

/** Narrow read-only surface used by this adapter and deterministic fake clients in tests. */
export interface SupabaseReadClient {
  from(table: "businesses" | "communities"): SupabaseReadQuery;
}

export class SupabaseConfigurationError extends Error {
  readonly reason: "configuration_missing" | "invalid_url";

  constructor(message: string, reason: "configuration_missing" | "invalid_url" = "configuration_missing") {
    super(message);
    this.name = "SupabaseConfigurationError";
    this.reason = reason;
  }
}
