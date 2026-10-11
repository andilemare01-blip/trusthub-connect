import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicAnswerGenerator } from "../lib/answer-resolution/response-generator.ts";
import type { ResolutionResult } from "../lib/answer-resolution/types.ts";

const resolution: ResolutionResult = {
  status: "partially_answered", evidence: [{
    id: "knowledge-123", claim: "TrustHub lists Example Plumbing in Bulawayo.", source: "trusthub",
    sourceLabel: "TrustHub knowledge record", verificationStatus: "potential", confidence: "medium",
    retrievedAt: "2026-09-29T08:00:00.000Z", sourceRecordId: "record-123", provenanceDetails: ["source:community", "reuse_status:approved"],
  }], provenance: ["trusthub"], confidence: "medium", uncertainty: "The listing is not verified.", sourceAttempts: [],
  nextAction: "answer",
};

test("deterministic answer generation preserves evidence IDs, provenance and confidence", async () => {
  const answer = await new DeterministicAnswerGenerator().generate(resolution);
  assert.deepEqual(answer.evidenceIds, ["knowledge-123"]);
  assert.deepEqual(answer.provenance, ["trusthub"]);
  assert.equal(answer.confidence, "medium");
  assert.equal(answer.uncertainty, resolution.uncertainty);
  assert.match(answer.text, /TrustHub knowledge record; potential; confidence: medium/);
  assert.match(answer.text, /not verified/);
});

test("unresolved answers do not invent a provider or claim external facts", async () => {
  const answer = await new DeterministicAnswerGenerator().generate({
    ...resolution, status: "unresolved", evidence: [], provenance: [], confidence: "unknown", uncertainty: null,
  });
  assert.deepEqual(answer.evidenceIds, []);
  assert.equal(answer.confidence, "unknown");
  assert.match(answer.text, /haven't found enough reliable information/);
  assert.doesNotMatch(answer.text, /Example Plumbing|Bulawayo|\+?\d{7,}/);
});

test("clarification output comes only from the resolver question", async () => {
  const question = "Which city should I search?";
  const answer = await new DeterministicAnswerGenerator().generate({
    ...resolution, status: "clarification_needed", evidence: [], provenance: [], confidence: "unknown",
    clarificationQuestion: question, nextAction: "clarify",
  });
  assert.equal(answer.text, question);
  assert.deepEqual(answer.evidenceIds, []);
});
