import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import { SupabaseKnowledgeRecordReader, type KnowledgeRecordReadClient } from "../lib/trusthub/knowledge-record-read-adapter.ts";
import { createResilientDataClient } from "../lib/supabase/retry.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult } from "../lib/supabase/data-client.ts";

/**
 * Regression test for "s.or is not a function".
 *
 * The production wiring (conversation-coordinator/server-entry.ts) passes the
 * resilient Supabase client — `createResilientDataClient(createClient(...))` —
 * to `SupabaseKnowledgeRecordReader`. The resilient `RetryingQuery` previously
 * did not expose the PostgREST combined-OR builder method, so any discovery
 * request whose service concept produced database-narrowing terms threw
 * `TypeError: ...or is not a function` and the knowledge source was reported
 * as unavailable. This test drives the reader through the real resilient
 * wrapper (not a hand-written query that already has `.or`) to keep that
 * gap from returning silently.
 */

const request: NormalizedRequest = {
  text: "Find hardware services in Bulawayo", intent: "find_provider", category: "hardware",
  location: { country: "Zimbabwe", city: "Bulawayo" }, questionType: "business_discovery",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "knowledge-1", record_type: "business", name: "Example Hardware", country_code: "ZW", city: "Bulawayo", area: "CBD",
    category: "Hardware", subcategory: null, service_tags: ["hardware", "tools"], description: "Local hardware supplies",
    phone: "+263771234567", whatsapp: "+263771234567", website: "https://example.test", address: "1 Main Street",
    opening_hours: { monday: "08:00-17:00" }, provenance_state: "POTENTIAL", verification_status: "unverified", confidence: 0.4,
    operating_status: "open", claimed_status: "unclaimed", source_id: "source-trusthub", source_record_id: "upstream-12",
    source_url: "https://directory.test/listing/12", source_license: null, source_retrieved_at: "2026-09-28T00:00:00.000Z",
    search_text: "example hardware tools local hardware supplies",
    knowledge_sources: { name: "TrustHub Community", source_type: "trusthub", reuse_status: "approved", attribution_required: false },
    ...overrides,
  };
}

/** A query that implements the real builder surface (including `.or`) and records every filter applied. */
class RecordingQuery implements SupabaseQuery {
  readonly applied: string[] = [];
  private readonly rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[]) { this.rows = rows; }
  select(): SupabaseQuery { return this; }
  insert(): SupabaseQuery { return this; }
  update(): SupabaseQuery { return this; }
  upsert(): SupabaseQuery { return this; }
  eq(column: string, value: unknown): SupabaseQuery { this.applied.push(`eq:${column}=${String(value)}`); return this; }
  ilike(column: string, pattern: string): SupabaseQuery { this.applied.push(`ilike:${column}~${pattern}`); return this; }
  or(filters: string): SupabaseQuery { this.applied.push(`or:${filters}`); return this; }
  is(): SupabaseQuery { return this; }
  order(): SupabaseQuery { return this; }
  limit(): SupabaseQuery { return this; }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve({ data: null, error: null }); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve({ data: null, error: null }); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    // Apply the filters the adapter chained, so only matching rows are returned.
    const data = this.rows.filter((item) => this.applied.every((applied) => {
      const [method, rest] = applied.split(":") as ["eq" | "ilike" | "or", string];
      if (method === "eq") {
        const [column, value] = rest.split("=") as [string, string];
        const actual = column.startsWith("knowledge_sources.")
          ? String((item.knowledge_sources as Record<string, unknown> | undefined)?.[column.split(".")[1]] ?? "")
          : String(item[column] ?? "");
        return actual.toLocaleLowerCase() === value.toLocaleLowerCase();
      }
      if (method === "ilike") {
        const [column, pattern] = rest.split("~") as [string, string];
        const needle = pattern.replace(/^%|%$/g, "").replace(/\\\*/g, "").replace(/\\([\\%_])/g, "$1").toLocaleLowerCase();
        const actual = String(item[column] ?? "").toLocaleLowerCase();
        return pattern.includes("*") ? actual.includes(needle) : actual === needle;
      }
      // or: every clause group is an OR — a row matches when any clause's column contains its term.
      const clauses = rest.split(",");
      return clauses.some((clause) => {
        const [, column, term] = /^(\w+)\.ilike\.\*(.*)\*$/.exec(clause)!;
        return String(item[column] ?? "").toLocaleLowerCase().includes(term.toLocaleLowerCase());
      });
    }));
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

/** Builds a resilient client over a fake whose created query is captured for inspection. */
function resilientClient(rows: Record<string, unknown>[]): { client: KnowledgeRecordReadClient; queries: RecordingQuery[] } {
  const queries: RecordingQuery[] = [];
  const inner: SupabaseDataClient = { from: () => { const query = new RecordingQuery(rows); queries.push(query); return query; } };
  return { client: createResilientDataClient(inner) as unknown as KnowledgeRecordReadClient, queries };
}

test("the resilient client forwards the combined-OR narrowing filter instead of throwing", async () => {
  const { client, queries } = resilientClient([row(), row({ id: "other-city", city: "Harare" })]);
  const records = await new SupabaseKnowledgeRecordReader(client).searchDiscoverable(request);
  // "hardware" is a taxonomy concept, so the reader narrows with `.or(search_text.ilike.*hardware*)`.
  const orQuery = queries.find((query) => query.applied.some((applied) => applied.startsWith("or:")));
  assert.ok(orQuery, "the combined-OR narrowing filter must reach the underlying query");
  assert.ok(orQuery.applied.some((applied) => applied.startsWith("or:") && applied.includes("search_text.ilike.*hardware*")), "the OR filter must narrow on search_text for the hardware concept");
  assert.deepEqual(records.map((item) => item.sourceRecordId), ["knowledge-1"]);
});

test("a knowledge read through the resilient wrapper returns matching records for a known service concept", async () => {
  const { client } = resilientClient([row(), row({ id: "unapproved", knowledge_sources: { name: "Directory", source_type: "directory", reuse_status: "review" } }), row({ id: "wrong-city", city: "Harare" })]);
  const records = await new SupabaseKnowledgeRecordReader(client).searchDiscoverable(request);
  assert.deepEqual(records.map((item) => item.sourceRecordId), ["knowledge-1"]);
  assert.equal(records[0].verificationStatus, "potential");
  assert.equal(records[0].sourceMetadata?.reuse_status, "approved");
});

test("an unknown country never broadens the combined-OR query into another country's same-named city", async () => {
  const { client } = resilientClient([row()]);
  assert.deepEqual(await new SupabaseKnowledgeRecordReader(client).searchDiscoverable({ ...request, location: { country: "Unmapped Country", city: "Bulawayo" } }), []);
});
