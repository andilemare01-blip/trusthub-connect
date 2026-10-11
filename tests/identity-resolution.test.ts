import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseIdentityResolver } from "../lib/identity/supabase-repository.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

class Query implements SupabaseQuery {
  private readonly rows: SupabaseRow[];
  private readonly filters = new Map<string, unknown>();
  constructor(rows: SupabaseRow[]) { this.rows = rows; }
  select() { return this; }
  insert(value: SupabaseRow | SupabaseRow[]) { this.rows.push(...(Array.isArray(value) ? value : [value])); return this; }
  update() { return this; }
  upsert() { return this; }
  ilike() { return this; }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }
  private matches() { return this.rows.filter((row) => [...this.filters].every(([key, value]) => row[key] === value)); }
  single(): PromiseLike<SupabaseQueryResult> { return Promise.resolve({ data: this.matches()[0] ?? null, error: null }); }
  maybeSingle(): PromiseLike<SupabaseQueryResult> { return Promise.resolve({ data: this.matches()[0] ?? null, error: null }); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(ok?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null, bad?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.matches(), error: null }).then(ok, bad);
  }
}

function clientWith(rows: Record<string, SupabaseRow[]>): SupabaseDataClient {
  return { from(table: string) { return new Query(rows[table] ?? []) as SupabaseQuery; } };
}

test("returning WhatsApp phone resolves the linked canonical TrustHub profile", async () => {
  const resolver = new SupabaseIdentityResolver(clientWith({
    whatsapp_identities: [{ id: 8, phone_number: "+263771234567", profile_id: 42, linked_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }],
    profiles: [{ id: "42", user_id: "auth-user", name: "Tariro", location: "Harare", trust_level: "member", trust_points: 0, joined_at: "2026-01-01T00:00:00Z" }],
  }));
  const result = await resolver.resolveByPhoneNumber("+263771234567");
  assert.equal(result.status, "linked_existing_profile");
  assert.equal(result.profile?.id, "42");
  assert.equal(result.whatsAppIdentity?.id, "8");
});

test("new phone remains unresolved and does not invent or create a parallel identity", async () => {
  const data = { whatsapp_identities: [], profiles: [] };
  const result = await new SupabaseIdentityResolver(clientWith(data)).resolveByPhoneNumber("+263771234567");
  assert.equal(result.status, "unresolved");
  assert.equal(result.profile, null);
  assert.equal(data.whatsapp_identities.length, 0);
  assert.equal(data.profiles.length, 0);
});

test("a repeated link for the same phone and canonical profile is idempotent; a different profile is rejected", async () => {
  const data = {
    whatsapp_identities: [],
    profiles: [
      { id: "42", user_id: "auth-42", name: "Tariro", location: null, trust_level: null, trust_points: null, joined_at: "2026-01-01T00:00:00Z" },
      { id: "43", user_id: "auth-43", name: "Tariro", location: null, trust_level: null, trust_points: null, joined_at: "2026-01-01T00:00:00Z" },
    ],
  };
  const resolver = new SupabaseIdentityResolver(clientWith(data));

  const first = await resolver.linkPhoneToExistingProfile("+263771234567", "42");
  const repeated = await resolver.linkPhoneToExistingProfile("+263771234567", "42");
  assert.equal(repeated.id, first.id);
  assert.equal(data.whatsapp_identities.length, 1);
  await assert.rejects(resolver.linkPhoneToExistingProfile("+263771234567", "43"), /already linked to a different/);
  assert.equal(data.whatsapp_identities.length, 1);
});

test("an existing profile with a matching display name is not guessed from an unverified phone", async () => {
  const resolver = new SupabaseIdentityResolver(clientWith({
    whatsapp_identities: [],
    profiles: [{ id: "42", user_id: "auth-42", name: "Tariro", location: null, trust_level: null, trust_points: null, joined_at: "2026-01-01T00:00:00Z" }],
  }));
  const result = await resolver.resolveByPhoneNumber("+263771234567");
  assert.equal(result.status, "unresolved");
  assert.equal(result.profile, null);
  assert.equal(result.whatsAppIdentity, null);
});

test("an identity query failure is reported instead of becoming an unresolved identity", async () => {
  const resolver = new SupabaseIdentityResolver({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: null, error: { message: "database unavailable", code: "08006" } }),
      } as never;
    },
  });

  await assert.rejects(
    resolver.resolveByPhoneNumber("+263771234567"),
    (error: unknown) => error instanceof Error
      && error.message === "Resolve WhatsApp identity: database unavailable",
  );
});
