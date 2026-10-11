import assert from "node:assert/strict";
import test from "node:test";
import { InvalidPhoneNumberError, isE164PhoneNumber, normalizePhoneNumber, tryNormalizePhoneNumber } from "../lib/identity/phone-number.ts";
import { SupabaseIdentityResolver } from "../lib/identity/supabase-repository.ts";
import { parseMetaWhatsAppWebhook } from "../lib/whatsapp/meta-webhook.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

test("every spelling of one +263 number resolves to a single stored E.164 value", () => {
  const expected = "+263771234567";
  for (const input of [
    "+263771234567",
    "263771234567",
    "00263771234567",
    "+263 77 123 4567",
    "+263-77-123-4567",
    "  +263771234567  ",
    "(+263) 771 234 567",
  ]) {
    assert.equal(normalizePhoneNumber(input), expected, input);
    assert.equal(tryNormalizePhoneNumber(input), expected, input);
  }
  assert.ok(isE164PhoneNumber(normalizePhoneNumber("263771234567")));
});

test("an unusable number is rejected instead of being guessed at", () => {
  for (const input of ["", "not-a-number", "+", "26377", "+26377123456789012", "0771234567"]) {
    assert.equal(tryNormalizePhoneNumber(input), null, input);
    assert.throws(() => normalizePhoneNumber(input), InvalidPhoneNumberError, input);
  }
});

test("Meta national digits produce the same sender identity as an E.164 number", async () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Test" } }], messages: [{ from: "263771234567", id: "wamid.norm", type: "text", timestamp: "1750000000", text: { body: "Hi" } }] } }] }],
  };
  const parsed = await parseMetaWhatsAppWebhook(payload, () => 0);
  assert.equal(parsed?.senderPhoneNumber, "+263771234567");
  assert.equal(parsed?.providerMessageId, "wamid.norm");
});

test("a malformed sender is skipped without failing the delivery", async () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{}], messages: [{ from: "12", id: "wamid.bad", type: "text", timestamp: "1750000000", text: { body: "Hi" } }] } }] }],
  };
  assert.equal(await parseMetaWhatsAppWebhook(payload, () => 0), null);
});

/** Records what the fake database stores and reports a chosen unique violation. */
class UniqueConflictClient implements SupabaseDataClient {
  private readonly identities: SupabaseRow[];
  private readonly constraint: string;
  constructor(identities: SupabaseRow[], constraint: string) { this.identities = identities; this.constraint = constraint; }
  from(table: string): SupabaseQuery {
    const rows = this.identities;
    const constraint = this.constraint;
    const query: SupabaseQuery = {
      select: () => query,
      insert: () => query,
      update: () => query,
      upsert: () => query,
      ilike: () => query,
      eq: (column: string, value: unknown) => {
        const matching = rows.filter((row) => row[column] === value);
        return { ...query, single: () => Promise.resolve({ data: matching[0] ?? null, error: null }), maybeSingle: () => Promise.resolve({ data: matching[0] ?? null, error: null }), then: <T1 = SupabaseQueryResult, T2 = never>(ok?: ((value: SupabaseQueryResult) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) => Promise.resolve<SupabaseQueryResult>({ data: matching, error: null }).then(ok, bad) } as SupabaseQuery;
      },
      is: () => query,
      order: () => query,
      limit: () => query,
      single: () => Promise.resolve({
        data: null,
        error: { message: `duplicate key value violates unique constraint "${constraint}"`, code: "23505", details: `Key (${constraint})=(x) already exists.` },
      }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: <T1 = SupabaseQueryResult, T2 = never>(ok?: ((value: SupabaseQueryResult) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) => Promise.resolve<SupabaseQueryResult>({ data: [], error: null }).then(ok, bad),
    };
    void table;
    return query;
  }
}

test("a profile already linked to another number is not reported as a phone conflict", async () => {
  const resolver = new SupabaseIdentityResolver(new UniqueConflictClient([], "whatsapp_identities_profile_id_key"));
  await assert.rejects(
    () => resolver.linkPhoneToExistingProfile("+263771000555", "42"),
    /That TrustHub profile is already linked to a different WhatsApp number\./,
  );
});

test("a phone already linked to another identity keeps the phone conflict wording", async () => {
  const resolver = new SupabaseIdentityResolver(new UniqueConflictClient([
    { id: 9, phone_number: "+263771000555", profile_id: 77, linked_at: null, created_at: "2026-01-01T00:00:00Z" },
  ], "whatsapp_identities_phone_number_key"));
  await assert.rejects(
    () => resolver.linkPhoneToExistingProfile("+263771000555", "42"),
    /already linked to a different or unresolved identity/,
  );
});

test("a racing link for the same phone and profile returns the winning row instead of an error", async () => {
  const identities: SupabaseRow[] = [];
  let attempts = 0;
  const client: SupabaseDataClient = {
    from(table: string) {
      const query: SupabaseQuery = {
        select: () => query, update: () => query, upsert: () => query, is: () => query, order: () => query, limit: () => query,
        ilike: () => query,
      eq: (column: string, value: unknown) => {
          const matching = identities.filter((row) => row[column] === value);
          const shaped = { ...query, single: () => Promise.resolve({ data: matching[0] ?? null, error: null }), maybeSingle: () => Promise.resolve({ data: matching[0] ?? null, error: null }), then: <T1 = SupabaseQueryResult, T2 = never>(ok?: ((value: SupabaseQueryResult) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) => Promise.resolve<SupabaseQueryResult>({ data: matching, error: null }).then(ok, bad) } as SupabaseQuery;
          return shaped;
        },
        insert: () => {
          attempts += 1;
          if (attempts === 1) {
            // Another request wins the unique phone constraint first.
            identities.push({ id: 9, phone_number: "+263771000666", profile_id: 42, linked_at: null, created_at: "2026-01-01T00:00:00Z" });
            const raced = { ...query, select: () => raced, single: () => Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "whatsapp_identities_phone_number_key"', code: "23505" } }) } as SupabaseQuery;
            return raced;
          }
          return query;
        },
        single: () => Promise.resolve({ data: identities[0] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: identities[0] ?? null, error: null }),
        then: <T1 = SupabaseQueryResult, T2 = never>(ok?: ((value: SupabaseQueryResult) => T1 | PromiseLike<T1>) | null, bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) => Promise.resolve<SupabaseQueryResult>({ data: identities, error: null }).then(ok, bad),
      };
      void table;
      return query;
    },
  };
  const identity = await new SupabaseIdentityResolver(client).linkPhoneToExistingProfile("+263771000666", "42");
  assert.equal(identity.id, "9");
  assert.equal(identity.trustHubProfileId, "42");
  assert.equal(identities.length, 1, "a racing link never creates a second identity row");
});
