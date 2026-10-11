import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalSearchRequest } from "../lib/whatsapp/intent-parser.ts";

test("search parser derives service and city from text without a hard-coded city catalogue", () => {
  const parsed = parseLocalSearchRequest("Find a plumber in Chitungwiza");
  assert.equal(parsed?.category, "plumber");
  assert.equal(parsed?.location?.city, "Chitungwiza");
  assert.equal(parsed?.questionType, "business_discovery");
});

test("search parser preserves multi-word city and explicit country", () => {
  const parsed = parseLocalSearchRequest("Where can I find hardware in Victoria Falls, Zimbabwe?");
  assert.equal(parsed?.category, "hardware");
  assert.equal(parsed?.location?.city, "Victoria Falls");
  assert.equal(parsed?.location?.country, "Zimbabwe");
});

test("recommendation requests remain distinct from basic business discovery", () => {
  const parsed = parseLocalSearchRequest("Can you recommend a good electrician near Norton?");
  assert.equal(parsed?.category, "electrician");
  assert.equal(parsed?.location?.city, "Norton");
  assert.equal(parsed?.questionType, "provider_recommendation");
  assert.equal(parsed?.intent, "find_provider");
});

test("search without a city asks the resolver to clarify location; greetings stay unclassified", () => {
  assert.equal(parseLocalSearchRequest("I need a mechanic")?.location?.city, null);
  assert.equal(parseLocalSearchRequest("Hi"), undefined);
});

test("a store that sells something is read as a shop search for that thing", () => {
  // "cells" is an ordinary misspelling of "sells".
  const parsed = parseLocalSearchRequest("a store that cells phones in Harare");
  assert.equal(parsed?.category, "phone shop");
  assert.equal(parsed?.serviceConcept, "electronics");
  assert.equal(parsed?.location?.city, "Harare");
  assert.equal(parsed?.location?.country, "Zimbabwe");
  assert.equal(parsed?.questionType, "business_discovery");
});

test("a shop that has or sells something is read as a shop search", () => {
  for (const text of ["a store that sells phones in Harare", "a shop that has phones in Harare", "a dealer that carries phones in Harare"]) {
    const parsed = parseLocalSearchRequest(text);
    assert.equal(parsed?.category, "phone shop", text);
    assert.equal(parsed?.serviceConcept, "electronics", text);
    assert.equal(parsed?.location?.city, "Harare", text);
  }
});

test("a store that sells a known service keeps that service as the category", () => {
  const parsed = parseLocalSearchRequest("a store that sells hardware in Bulawayo");
  assert.equal(parsed?.category, "hardware shop");
  assert.equal(parsed?.serviceConcept, "hardware");
  assert.equal(parsed?.location?.city, "Bulawayo");
});

test("a store that sells something unknown still reads the item as the category", () => {
  const parsed = parseLocalSearchRequest("a store that sells gizmos in Harare");
  assert.equal(parsed?.category, "gizmos");
  assert.equal(parsed?.location?.city, "Harare");
});
