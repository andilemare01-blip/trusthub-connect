import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicUnderstandingProvider } from "../lib/ai/understanding.ts";
import { detectContribution } from "../lib/contributions/detection.ts";
import { SupabaseContributionRepository } from "../lib/contributions/supabase-repository.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

test("structured understanding reports deterministic status and extracts request, urgency and escalation", async () => {
  const provider = new DeterministicUnderstandingProvider();
  const parsed = await provider.understand("I urgently need a plumber in Bulawayo");
  assert.equal(parsed.aiProviderStatus, "unavailable");
  assert.equal(parsed.source, "deterministic");
  assert.equal(parsed.request?.location?.city, "Bulawayo");
  assert.equal(parsed.urgency, "urgent");
  assert.equal(parsed.answerability, "ready_to_search");

  const emergency = await provider.understand("Emergency, I need an ambulance now");
  assert.equal(emergency.urgency, "emergency");
  assert.equal(emergency.escalation, "human");
});

test("contribution detector preserves original provider recommendation and never verifies it", () => {
  const original = "I know a plumber called Tariro in Chiredzi. He fixed my tap.";
  const candidate = detectContribution(original);
  assert.deepEqual(candidate, {
    kind: "provider_recommendation", originalText: original, category: "plumber", providerName: "Tariro",
    city: "Chiredzi", area: null, verificationStatus: "declared",
  });
  assert.equal(detectContribution("Find a plumber in Chiredzi"), null);
});

test("a search for a service is never stored as the sender's own capability", async () => {
  for (const text of [
    "I'm looking for a plumber in Harare",
    "I am looking for a mechanic in Chinhoyi",
    "I am searching for a driving school in Harare",
  ]) {
    assert.equal(detectContribution(text), null, text);
    assert.equal((await new DeterministicUnderstandingProvider().understand(text)).contribution, null, text);
  }
  const understanding = await new DeterministicUnderstandingProvider().understand("I'm looking for a plumber in Harare");
  assert.equal(understanding.answerability, "ready_to_search");
  assert.equal(understanding.request?.category, "plumber");
  assert.equal(understanding.request?.location?.city, "Harare");
  // A genuine self-declaration is still a contribution.
  const capability = detectContribution("I am a plumber in Harare");
  assert.equal(capability?.kind, "capability_declaration");
  assert.equal(capability?.category, "plumber");
  assert.equal(capability?.city, "Harare");
});

test("a recommendation that names the place before the provider keeps both apart", () => {
  const candidate = detectContribution("I know a good plumber in Harare called Mr Moyo.");
  assert.equal(candidate?.kind, "provider_recommendation");
  assert.equal(candidate?.providerName, "Mr Moyo");
  assert.equal(candidate?.category, "good plumber");
  assert.equal(candidate?.city, "Harare");
  assert.equal(candidate?.verificationStatus, "declared");
});

class InsertQuery {
  payload: SupabaseRow | SupabaseRow[] | null = null;
  insert(values: SupabaseRow | SupabaseRow[]) { this.payload = values; return this; }
  select() { return this; }
  eq() { return this; }
  maybeSingle(): Promise<SupabaseQueryResult> { return Promise.resolve({ data: null, error: null }); }
  single(): Promise<SupabaseQueryResult> { return Promise.resolve({ data: { id: 91 }, error: null }); }
  then<TResult1 = SupabaseQueryResult, TResult2 = never>(onfulfilled?: ((value: SupabaseQueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

test("Supabase contribution adapter persists source linkage and keeps extracted claims declared", async () => {
  const query = new InsertQuery();
  const client: SupabaseDataClient = { from() { return query as unknown as SupabaseQuery; } };
  const candidate = detectContribution("I know a plumber called Tariro in Chiredzi.");
  assert.ok(candidate);
  const id = await new SupabaseContributionRepository(client).recordDetectedContribution({
    candidate, contributorProfileId: "42", communityId: "6618d246-a0df-4fc2-8cf2-8a9dfdd7a4e0", conversationId: "7", sourceMessageId: "18",
  });
  assert.equal(id, "91");
  assert.ok(query.payload && !Array.isArray(query.payload));
  assert.equal(query.payload.claim_text, candidate.originalText);
  assert.equal(query.payload.verification_status, "declared");
  assert.equal(query.payload.source_message_id, "18");
  assert.equal(query.payload.contributor_profile_id, "42");
});

test("Supabase contribution adapter returns the existing row after a duplicate source-message insert", async () => {
  class DuplicateQuery extends InsertQuery {
    override single() { return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } } satisfies SupabaseQueryResult); }
    override maybeSingle() { return Promise.resolve({ data: { id: 91 }, error: null } satisfies SupabaseQueryResult); }
  }
  const query = new DuplicateQuery();
  const client: SupabaseDataClient = { from() { return query as unknown as SupabaseQuery; } };
  const candidate = detectContribution("I know a plumber called Tariro in Chiredzi.");
  assert.ok(candidate);
  const id = await new SupabaseContributionRepository(client).recordDetectedContribution({
    candidate, contributorProfileId: "42", communityId: null, conversationId: "7", sourceMessageId: "18",
  });
  assert.equal(id, "91");
});
