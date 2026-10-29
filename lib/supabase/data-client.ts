import { describeSupabaseFailure, supabaseFailureCode } from "./retry.ts";

export type SupabaseRow = Record<string, unknown>;
export interface SupabaseQueryResult {
  data: SupabaseRow | SupabaseRow[] | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
}
export interface SupabaseQuery extends PromiseLike<SupabaseQueryResult> {
  select(columns?: string): SupabaseQuery;
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery;
  update(values: SupabaseRow): SupabaseQuery;
  upsert(values: SupabaseRow | SupabaseRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): SupabaseQuery;
  eq(column: string, value: unknown): SupabaseQuery;
  ilike(column: string, pattern: string): SupabaseQuery;
  is(column: string, value: null | boolean): SupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery;
  limit(count: number): SupabaseQuery;
  single(): PromiseLike<SupabaseQueryResult>;
  maybeSingle(): PromiseLike<SupabaseQueryResult>;
}
export interface SupabaseDataClient {
  from(table: string): SupabaseQuery;
  /** Database functions (Benita's search and facts). Optional so test doubles need not provide it. */
  rpc?(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export class SupabasePersistenceError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SupabasePersistenceError";
    this.code = code;
  }
}

export function requireData<T extends SupabaseRow>(result: SupabaseQueryResult, operation: string): T {
  if (result.error) throw new SupabasePersistenceError(describeSupabaseFailure(operation, result.error), supabaseFailureCode(result.error));
  if (!result.data || Array.isArray(result.data)) throw new SupabasePersistenceError(operation + ": expected one database row.");
  return result.data as T;
}
export function requireRows<T extends SupabaseRow>(result: SupabaseQueryResult, operation: string): T[] {
  if (result.error) throw new SupabasePersistenceError(describeSupabaseFailure(operation, result.error), supabaseFailureCode(result.error));
  if (!result.data) return [];
  return Array.isArray(result.data) ? result.data as T[] : [result.data as T];
}
