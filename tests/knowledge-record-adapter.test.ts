import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedRequest } from "../lib/answer-resolution/types.ts";
import { SupabaseKnowledgeRecordReader, type KnowledgeRecordReadClient, type KnowledgeRecordReadQuery } from "../lib/trusthub/knowledge-record-read-adapter.ts";
import type { SupabaseReadResponse } from "../lib/trusthub/supabase-types.ts";

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
    source_url: "https://directory.test/listing/12", source_license: null, source_retrieved_at: "2026-09-28T00:00:00.000Z", search_text: "example hardware tools local hardware supplies",
    knowledge_sources: { name: "TrustHub Community", source_type: "trusthub", reuse_status: "approved", attribution_required: false },
    ...overrides,
  };
}

class Query implements KnowledgeRecordReadQuery {
  private readonly rows: Record<string, unknown>[];
  private readonly filters: { method: "eq" | "ilike"; column: string; value: string }[] = [];
  private limitCount = 100;
  private readonly ors: { column: string; term: string }[][] = [];
  constructor(rows: Record<string, unknown>[]) { this.rows = rows; }
  or(filters: string): KnowledgeRecordReadQuery {
    this.ors.push(filters.split(",").map((clause) => {
      const match = /^(\w+)\.ilike\.(.*)$/.exec(clause)!;
      const [, column, pattern] = match;
      // Supports both the `*term*` narrowing form and the `%term%` search form.
      const term = (pattern.startsWith("*") ? pattern.slice(1, -1) : pattern.replace(/^%|%$/g, "")).replace(/\\([\\%_])/g, "$1");
      return { column, term: term.toLocaleLowerCase() };
    }));
    return this;
  }
  select(): KnowledgeRecordReadQuery { return this; }
  eq(column: string, value: string): KnowledgeRecordReadQuery { this.filters.push({ method: "eq", column, value }); return this; }
  ilike(column: string, value: string): KnowledgeRecordReadQuery { this.filters.push({ method: "ilike", column, value }); return this; }
  limit(count: number): KnowledgeRecordReadQuery { this.limitCount = count; return this; }
  then<TResult1 = SupabaseReadResponse, TResult2 = never>(
    onfulfilled?: ((value: SupabaseReadResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.rows.filter((item) => this.filters.every(({ method, column, value }) => {
      const actual = column.startsWith("knowledge_sources.")
        ? String((item.knowledge_sources as Record<string, unknown> | undefined)?.[column.split(".")[1]] ?? "")
        : String(item[column] ?? "");
      if (method === "eq") return actual.toLocaleLowerCase() === value.toLocaleLowerCase();
      const needle = value.replace(/^%|%$/g, "").replace(/\\([\\%_])/g, "$1").toLocaleLowerCase();
      return actual.toLocaleLowerCase().includes(needle);
    })).filter((item) => this.ors.every((clauses) => clauses.some(({ column, term }) => String(item[column] ?? "").toLocaleLowerCase().includes(term)))).slice(0, this.limitCount);
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

class Client implements KnowledgeRecordReadClient {
  private readonly rows: Record<string, unknown>[];
  constructor(rows: Record<string, unknown>[]) { this.rows = rows; }
  from() { return new Query(this.rows); }
}

test("discovery surfaces only locally matching business/service records from approved sources", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([
    row(),
    row({ id: "unapproved", knowledge_sources: { name: "Directory", source_type: "directory", reuse_status: "review" } }),
    row({ id: "wrong-city", city: "Harare" }),
    row({ id: "non-business", record_type: "facility" }),
    row({ id: "no-source", knowledge_sources: null }),
    row({ id: "service-record", record_type: "service", name: "Hardware delivery service", category: "retail", service_tags: ["hardware"] }),
  ]));
  const records = await reader.searchDiscoverable(request);
  assert.deepEqual(records.map((item) => item.sourceRecordId), ["knowledge-1", "service-record"]);
  assert.equal(records[0].verificationStatus, "potential");
  assert.equal(records[0].sourceMetadata?.reuse_status, "approved");
});

test("discovery preserves knowledge IDs, attribution, contact and service details without upgrading verification", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([row({ provenance_state: "VERIFIED", verification_status: "unverified" })]));
  const [record] = await reader.searchDiscoverable(request);
  assert.equal(record.id, "knowledge:knowledge-1");
  assert.equal(record.sourceRecordId, "knowledge-1");
  assert.equal(record.verificationStatus, "unknown");
  assert.equal(record.phone, "+263771234567");
  assert.equal(record.whatsapp, "+263771234567");
  assert.equal(record.website, "https://example.test");
  assert.equal(record.address, "1 Main Street");
  assert.deepEqual(record.serviceTags, ["hardware", "tools"]);
  assert.deepEqual(record.openingHours, { monday: "08:00-17:00" });
  assert.ok(record.provenance.includes("reuse_status:approved"));
});

test("an unsupported country name does not broaden into another country's same-named city", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([row()]));
  assert.deepEqual(await reader.searchDiscoverable({ ...request, location: { country: "Unmapped Country", city: "Bulawayo" } }), []);
});

test("discovery remains city-local across target Zimbabwe cities and reports sparse or unknown locations as empty", async () => {
  for (const city of ["Harare", "Bulawayo", "Victoria Falls", "Masvingo", "Marondera", "Ruwa", "Chitungwiza"]) {
    const reader = new SupabaseKnowledgeRecordReader(new Client([row({ id: `record-${city}`, city })]));
    const results = await reader.searchDiscoverable({ ...request, location: { country: "Zimbabwe", city } });
    assert.deepEqual(results.map((result) => result.city), [city]);
  }

  const sparseReader = new SupabaseKnowledgeRecordReader(new Client([row()]));
  assert.deepEqual(await sparseReader.searchDiscoverable({ ...request, location: { country: "Zimbabwe", city: "Gweru" } }), []);
  assert.deepEqual(await sparseReader.searchDiscoverable({ ...request, location: { country: "Zimbabwe", city: "Unknown Place" } }), []);
});

test("a record whose search_text was never populated is still discoverable by its own fields", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([
    row({ id: "no-search-text", search_text: null, name: "Bulawayo Hardware Store", category: null, subcategory: null, description: null }),
    row({ id: "unrelated", search_text: null, name: "Bulawayo Bakery", category: "Food", description: "bread and cakes" }),
  ]));
  const records = await reader.searchDiscoverable(request);
  // The hardware store matches by name even with no search_text; the bakery does not.
  assert.deepEqual(records.map((item) => item.sourceRecordId), ["no-search-text"]);
});

test("the alternate ZI country code is normalised to Zimbabwe and still matches", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([
    row({ id: "zi-record", country_code: "ZI" }),
    row({ id: "zw-record", country_code: "ZW" }),
    row({ id: "za-record", country_code: "ZA" }),
  ]));
  const records = await reader.searchDiscoverable(request);
  // Both ZI and ZW are Zimbabwe; the South African row is excluded.
  assert.deepEqual(records.map((item) => item.sourceRecordId).sort(), ["zi-record", "zw-record"]);
});

test("records that match the service in their name rank ahead of weaker field matches", async () => {
  const reader = new SupabaseKnowledgeRecordReader(new Client([
    row({ id: "by-description", search_text: null, name: "Bulawayo General Store", category: null, description: "sells hardware" }),
    row({ id: "by-name", search_text: null, name: "Bulawayo Hardware", category: null, description: null }),
  ]));
  const records = await reader.searchDiscoverable(request);
  assert.equal(records.length, 2);
  // The exact category/name match (score 100) outranks the description-only match (score 30).
  assert.equal(records[0].sourceRecordId, "by-name");
  assert.equal(records[1].sourceRecordId, "by-description");
});
