import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSeedCandidate, normalizeSeedCandidate } from "../lib/seed/candidate-evaluator.ts";
import type { SeedRecord } from "../types/seed.ts";

function seed(overrides: Partial<SeedRecord> = {}): SeedRecord {
  return {
    id: "osm-node-42", rawName: "ABC Hardware Pvt Ltd", rawCategory: "Hardware", rawAddress: "12 Mutare Road, Harare, Zimbabwe",
    latitude: -17.82, longitude: 31.05, country: "Zimbabwe", province: "Harare", phone: null, website: null,
    evidence: { source: "openstreetmap", sourceId: "node/42", sourceUrl: "https://openstreetmap.org/node/42", license: "ODbL", retrievedAt: "2026-09-28T12:00:00.000Z", payload: { tags: { name: "ABC Hardware Pvt Ltd" } } },
    ...overrides,
  };
}

test("a locality in the address controls over road names that resemble other cities", () => {
  const cases = [
    ["Mutare Road, Harare", "Harare"], ["Chinhoyi Street, Harare", "Harare"],
    ["Bulawayo Road, Gweru", "Gweru"], ["Esigodini Road, Bulawayo", "Bulawayo"],
  ];
  for (const [address, expected] of cases) assert.equal(normalizeSeedCandidate(seed({ rawAddress: address })).city, expected);
});

test("common Zimbabwe localities are retained only when explicitly present as locality evidence", () => {
  for (const city of ["Harare", "Bulawayo", "Victoria Falls", "Masvingo", "Marondera", "Ruwa", "Chitungwiza"]) {
    const candidate = normalizeSeedCandidate(seed({ city, rawAddress: `Market Road, ${city}` }));
    assert.equal(candidate.city, city);
    assert.equal(candidate.locationStatus, "resolved");
  }
  const unknown = normalizeSeedCandidate(seed({ city: null, rawAddress: "17 Unknown Lane" }));
  assert.equal(unknown.city, null);
  assert.equal(unknown.locationStatus, "unresolved");
  assert.ok(unknown.reviewReasons.includes("city_unresolved"));
  assert.equal(evaluateSeedCandidate(unknown, []).decision, "review");
});

test("external candidates retain source payload and are never upgraded to verified", () => {
  const original = seed({ evidence: { ...seed().evidence, provenanceState: "VERIFIED", verificationStatus: "verified" } });
  const candidate = normalizeSeedCandidate(original);
  assert.equal(candidate.evidence.source, "openstreetmap");
  assert.equal(candidate.evidence.sourceId, "node/42");
  assert.equal(candidate.evidence.sourceUrl, "https://openstreetmap.org/node/42");
  assert.equal(candidate.evidence.retrievedAt, original.evidence.retrievedAt);
  assert.deepEqual(candidate.evidence.payload, original.evidence.payload);
  assert.equal(candidate.provenanceState, "POTENTIAL");
  assert.equal(candidate.verificationStatus, "unverified");
  assert.ok(candidate.reviewReasons.includes("external_source_cannot_self_verify"));
});

test("seed matching is conservative, enriches only missing fields and preserves conflicts", () => {
  const candidate = normalizeSeedCandidate(seed({ phone: "+263 77 123 4567", website: "https://abc.example" }));
  const match = evaluateSeedCandidate(candidate, [{ id: "canonical-1", name: "ABC HARDWARE", city: "Harare", address: candidate.address, phone: null, website: null }]);
  assert.equal(match.decision, "enrich_candidate");
  assert.equal(match.matchedExistingBusinessId, "canonical-1");
  assert.equal(match.proposedEnrichment.phone, "+263 77 123 4567");
  assert.equal(match.proposedEnrichment.website, "https://abc.example");

  const conflict = evaluateSeedCandidate(candidate, [{ id: "canonical-2", name: "ABC Hardware", city: "Harare", phone: "+263771111111" }]);
  assert.equal(conflict.decision, "review");
  assert.deepEqual(conflict.conflicts, ["phone"]);
  assert.equal(conflict.proposedEnrichment.phone, undefined);

  const nameOnly = evaluateSeedCandidate(normalizeSeedCandidate(seed({ phone: null })), [{ id: "possible", name: "ABC Hardware", city: "Harare" }]);
  assert.equal(nameOnly.decision, "review");
  assert.ok(nameOnly.reviewReasons.includes("possible_duplicate_requires_review"));
});

test("community candidates remain declared and source record identity is a duplicate signal", () => {
  const candidate = normalizeSeedCandidate(seed({
    evidence: { source: "community", sourceId: "contribution-19", retrievedAt: "2026-09-28T12:00:00.000Z", provenanceState: "DECLARED" },
  }));
  assert.equal(candidate.provenanceState, "DECLARED");
  assert.equal(candidate.verificationStatus, "declared");
  const decision = evaluateSeedCandidate(candidate, [{ id: "existing", name: "A renamed record", city: "Bulawayo", source: "community", sourceId: "contribution-19" }]);
  assert.equal(decision.decision, "review");
  assert.ok(decision.matchingSignals.includes("source_record_id"));
  assert.ok(decision.reviewReasons.includes("canonical_field_conflicts_preserved"));
});
