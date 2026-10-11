import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalSearchRequest } from "../lib/whatsapp/intent-parser.ts";
import { detectContribution } from "../lib/contributions/detection.ts";
import { parseProfileCreationRequest, isProfileCreationIntent } from "../lib/identity/profile-intent.ts";

const cases: [string, string | null, string | null, string | null, string | null][] = [
  ["Find a driving school in Harare.", "driving school", "Harare", "driving_school", null],
  ["I need somewhere to learn driving.", "somewhere to learn driving", null, null, null],
  ["Any hair salons in Harare?", "hair salons", "Harare", "hair_salon", null],
  ["How about a car rental company?", "car rental company", null, null, "vehicle_hire"],
  ["What about car hire?", "car hire", null, null, "vehicle_hire"],
  ["I'm looking for a plumber in Harare", "plumber", "Harare", "plumber", null],
  ["I know a good plumber in Harare called Mr Moyo", "plumber", "Harare", "plumber", null],
  ["where can i learn to drive", "driving school", null, "driving_school", null],
  ["my tap is leaking", "plumber", null, "plumber", null],
  ["car hire in harare", "car hire", "harare", "vehicle_hire", null],
  ["rent a car in bulawayo", "rent a car", "bulawayo", "vehicle_hire", null],
  ["hairdresser in harare", "hairdresser", "harare", "hair_salon", null],
];

for (const [text, category, city, concept, altConcept] of cases) {
  test(`parser reads ${JSON.stringify(text)}`, () => {
    const request = parseLocalSearchRequest(text);
    assert.ok(request, "expected a request");
    assert.equal(request.category, category, `category for ${text}`);
    assert.equal(request.location?.city ?? null, city, `city for ${text}`);
    assert.equal(request.serviceConcept ?? null, concept ?? altConcept ?? null, `concept for ${text}`);
  });
}

test("a recommendation that names the person between the service and the place keeps both apart", () => {
  const contribution = detectContribution("I know a good plumber in Harare called Mr Moyo");
  assert.equal(contribution?.kind, "provider_recommendation");
  assert.equal(contribution?.category, "good plumber");
  assert.equal(contribution?.providerName, "Mr Moyo");
  assert.equal(contribution?.city, "Harare");
});

test("a search request is never stored as the sender's own capability", () => {
  for (const text of ["I'm looking for a plumber in Harare", "I am searching for a driving school in Harare"]) {
    assert.equal(detectContribution(text), null, text);
  }
});

test("a genuine self-declaration is still a contribution", () => {
  const contribution = detectContribution("I am a plumber in Harare");
  assert.equal(contribution?.kind, "capability_declaration");
  assert.equal(contribution?.category, "plumber");
  assert.equal(contribution?.city, "Harare");
});

test("profile creation intent is recognised and never falls through to the search fallback", () => {
  for (const text of [
    "I'd like to create my TrustHub profile.",
    "I want a TrustHub profile",
    "Create my TrustHub profile",
    "Sign up for TrustHub",
    "Join TrustHub",
  ]) {
    assert.equal(isProfileCreationIntent(text), true, text);
    const request = parseProfileCreationRequest(text);
    assert.ok(request, text);
  }
  assert.equal(isProfileCreationIntent("Find a driving school in Harare"), false);
  assert.equal(isProfileCreationIntent("I know a good plumber in Harare called Mr Moyo"), false);
});

test("profile creation intent does not invent a display name when none is offered", () => {
  const request = parseProfileCreationRequest("I'd like to create my TrustHub profile");
  assert.equal(request?.displayName, null);
});

test("profile creation intent reads an offered display name", () => {
  const request = parseProfileCreationRequest("I'm John, I'd like to create my TrustHub profile");
  assert.equal(request?.displayName, "John");
});