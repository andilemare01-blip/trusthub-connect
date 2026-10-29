import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "./data-client.ts";

/**
 * Transport resilience for Supabase/PostgREST access.
 *
 * A failing Supabase call has two completely different causes:
 *
 *  - a **transport** failure — the request never produced a database answer
 *    (DNS, TLS, socket reset, timeout). PostgREST reports nothing, so the
 *    error carries no SQLSTATE and the underlying operating-system cause is
 *    only present in `details` (for example `getaddrinfo ENOTFOUND`,
 *    `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`).
 *  - a **database** failure — the request reached the database and was
 *    rejected or returned no rows. It always carries a code such as `23505`,
 *    `23514`, `42703` or `PGRST205`.
 *
 * Only the first kind is safe to retry, and even then only when repeating the
 * request cannot create a second row. Everything else is returned to the
 * caller unchanged so `requireData`/`requireRows` still fail loudly.
 */

export type SupabaseFailureKind = "transport" | "database";

export interface ClassifiedSupabaseFailure {
  kind: SupabaseFailureKind;
  code: string | null;
  cause: string | null;
}

const TRANSPORT_MESSAGE_MARKERS = ["fetch failed", "network error", "socket hang up", "other side closed", "terminated"];

function text(value: unknown): string { return typeof value === "string" ? value : ""; }

export function classifySupabaseFailure(error: unknown): ClassifiedSupabaseFailure {
  const raw = (error ?? {}) as { message?: unknown; code?: unknown; details?: unknown };
  const message = text(raw.message).trim();
  const code = text(raw.code).trim();
  const details = text(raw.details).replace(/\s+/g, " ");
  const cause = /Caused by:\s*([\s\S]*?)(?=\s+at\s|\s+Error:|$)/.exec(details)?.[1]?.trim() ?? null;
  const transport = cause !== null
    || (!code && TRANSPORT_MESSAGE_MARKERS.some((marker) => message.toLowerCase().includes(marker)));
  return { kind: transport ? "transport" : "database", code: code || null, cause };
}

/** Preserves the database/transport distinction that a bare `error.message` loses. */
export function describeSupabaseFailure(operation: string, error: unknown): string {
  const failure = classifySupabaseFailure(error);
  const message = text((error as { message?: unknown } | null)?.message).trim() || "unknown Supabase failure";
  const detail = failure.kind === "transport"
    ? ` [transport failure${failure.cause ? `: ${failure.cause}` : ""}]`
    : failure.code ? ` [database code ${failure.code}]` : "";
  return `${operation}: ${message}${detail}`;
}

export function supabaseFailureCode(error: unknown): string | undefined {
  return classifySupabaseFailure(error).code ?? undefined;
}

export interface SupabaseRetryOptions {
  /** Human-readable operation label used in the error and in retry logs. Never includes row data. */
  operation: string;
  /** True when repeating the exact request cannot change the stored outcome. */
  idempotent?: boolean;
  /**
   * For a non-idempotent write: answers "has this write in fact already been
   * applied?" before a retry is sent. Returning true stops the retry loop, so
   * a lost response can never produce a second row.
   */
  retrySafe?: () => Promise<boolean>;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; cause: string | null; operation: string }) => void;
}

/**
 * Executes a Supabase query, retrying only transport failures. The query
 * builder is re-awaited, which re-issues the identical HTTP request.
 */
export async function runSupabaseOperation<T extends SupabaseQueryResult>(
  execute: () => PromiseLike<T>,
  options: SupabaseRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const idempotent = options.idempotent !== false;
  const maxAttempts = Math.max(1, options.attempts ?? (idempotent ? 3 : 2));
  const baseDelayMs = options.baseDelayMs ?? 150;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const result = await execute();
    if (!result.error) return result;
    const failure = classifySupabaseFailure(result.error);
    if (failure.kind !== "transport" || attempt >= maxAttempts) return result;
    if (options.retrySafe && await options.retrySafe()) {
      options.onRetry?.({ attempt, delayMs: 0, cause: failure.cause, operation: options.operation });
      return result;
    }
    const delayMs = baseDelayMs * 2 ** (attempt - 1);
    options.onRetry?.({ attempt, delayMs, cause: failure.cause, operation: options.operation });
    await sleep(delayMs);
  }
}

/**
 * Columns this schema declares UNIQUE (migration 001/002). An insert carrying
 * one of them cannot succeed twice, so a repeated request either succeeds
 * normally or is rejected with `23505`, which the existing callers already
 * classify as "already stored".
 */
const GUARDED_UNIQUE_COLUMNS = new Set([
  "id",
  "provider_message_id",
  "phone_number",
  "profile_id",
  "source_message_id",
  "idempotency_key",
  "help_request_id",
]);

function insertIsRepeatable(values: SupabaseRow | SupabaseRow[] | undefined, options?: { onConflict?: string; ignoreDuplicates?: boolean }): boolean {
  if (options?.ignoreDuplicates) return true;
  const first = Array.isArray(values) ? values[0] : values;
  if (!first || typeof first !== "object") return false;
  return Object.keys(first).some((column) => GUARDED_UNIQUE_COLUMNS.has(column));
}

type WideSupabaseQuery = SupabaseQuery & {
  neq(column: string, value: unknown): SupabaseQuery;
  in(column: string, values: readonly unknown[]): SupabaseQuery;
  gte(column: string, value: string): SupabaseQuery;
  not(column: string, operator: string, value: unknown): SupabaseQuery;
};

class RetryingQuery implements SupabaseQuery {
  private readonly inner: SupabaseQuery;
  private readonly repeatable: boolean;

  constructor(inner: SupabaseQuery, repeatable: boolean) {
    this.inner = inner;
    this.repeatable = repeatable;
  }

  private next(inner: SupabaseQuery, repeatable: boolean): RetryingQuery { return new RetryingQuery(inner, repeatable); }

  select(columns?: string): SupabaseQuery { return this.next(this.inner.select(columns), this.repeatable); }
  insert(values: SupabaseRow | SupabaseRow[]): SupabaseQuery { return this.next(this.inner.insert(values), insertIsRepeatable(values)); }
  update(values: SupabaseRow): SupabaseQuery { return this.next(this.inner.update(values), true); }
  upsert(values: SupabaseRow | SupabaseRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): SupabaseQuery {
    return this.next(this.inner.upsert(values, options), insertIsRepeatable(values, options));
  }
  eq(column: string, value: unknown): SupabaseQuery { return this.next(this.inner.eq(column, value), this.repeatable); }
  // Read filters. Each must be forwarded: a missing one throws "... is not a function" in production,
  // and the caller's catch turns that into a generic apology.
  neq(column: string, value: unknown): SupabaseQuery { return this.next(this.wide().neq(column, value), this.repeatable); }
  in(column: string, values: readonly unknown[]): SupabaseQuery { return this.next(this.wide().in(column, values), this.repeatable); }
  gte(column: string, value: string): SupabaseQuery { return this.next(this.wide().gte(column, value), this.repeatable); }
  not(column: string, operator: string, value: unknown): SupabaseQuery { return this.next(this.wide().not(column, operator, value), this.repeatable); }
  /** The real PostgREST builder has these filters; the narrow SupabaseQuery view omits them, as it does `or`. */
  private wide(): WideSupabaseQuery { return this.inner as WideSupabaseQuery; }
  ilike(column: string, pattern: string): SupabaseQuery { return this.next(this.inner.ilike(column, pattern), this.repeatable); }
  /**
   * Forwards the combined-OR filter unchanged: a read filter, so it
   * stays repeatable. The real PostgREST builder supports `or`; the
   * narrow `SupabaseQuery` view deliberately omits it, so the inner
   * query is widened here. Without this, knowledge-discovery
   * narrowing fails with "s.or is not a function".
   */
  or(filters: string): SupabaseQuery {
    const inner = this.inner as SupabaseQuery & { or(filters: string): SupabaseQuery };
    return this.next(inner.or(filters), this.repeatable);
  }
  is(column: string, value: null | boolean): SupabaseQuery { return this.next(this.inner.is(column, value), this.repeatable); }
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery { return this.next(this.inner.order(column, options), this.repeatable); }
  limit(count: number): SupabaseQuery { return this.next(this.inner.limit(count), this.repeatable); }
  single(): PromiseLike<SupabaseQueryResult> { return this.execute(this.inner.single()); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return this.execute(this.inner.maybeSingle()); }

  then<TResult1 = SupabaseQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  /**
   * `single()` and `maybeSingle()` mark the underlying builder; the marker must
   * be applied before the request is issued or the row shape changes.
   */
  private execute(inner: PromiseLike<SupabaseQueryResult> = this.inner): Promise<SupabaseQueryResult> {
    return runSupabaseOperation(() => inner, {
      operation: "supabase.query",
      idempotent: this.repeatable,
      // A write this schema cannot guard is never repeated: the caller's own
      // duplicate handling is its only safe recovery, not a second POST.
      ...(this.repeatable ? {} : { attempts: 1 }),
    });
  }
}

/**
 * Wraps a Supabase client so every query in the server runtime retries
 * transport failures. Inserts without a UNIQUE guard are never repeated: they
 * keep the original single attempt and report their cause instead.
 */
export function createResilientDataClient(client: SupabaseDataClient): SupabaseDataClient {
  return { from: (table: string) => new RetryingQuery(client.from(table), true) };
}