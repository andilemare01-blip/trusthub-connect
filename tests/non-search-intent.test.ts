import assert from "node:assert/strict";
import test from "node:test";
import { recognizeNonSearchIntent } from "../lib/conversation-coordinator/intents.ts";

test("add_business intent: 'I want to add a business in Harare'", () => {
  const result = recognizeNonSearchIntent("I want to add a business in Harare");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "add_business");
  assert.equal(result?.questionType, "add_business");
  assert.equal(result?.request.intent, "add_business");
});

test("add_business intent: 'Can I add my shop to TrustHub?'", () => {
  const result = recognizeNonSearchIntent("Can I add my shop to TrustHub?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "add_business");
  assert.equal(result?.questionType, "add_business");
});

test("add_business intent: 'This business is missing from your directory'", () => {
  const result = recognizeNonSearchIntent("This business is missing from your directory");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "add_business");
});

test("add_business intent: 'How do I list my business?'", () => {
  const result = recognizeNonSearchIntent("How do I list my business?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "add_business");
});

test("add_business intent: Shona 'ndoda kuisa bhizimisi'", () => {
  const result = recognizeNonSearchIntent("ndoda kuisa bhizimisi");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "add_business");
});

test("review_write intent: 'I want to write a review'", () => {
  const result = recognizeNonSearchIntent("I want to write a review");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "review_experience");
  assert.equal(result?.questionType, "review_write");
  assert.equal(result?.request.intent, "review_experience");
});

test("review_write intent: 'Can I leave a review for this place?'", () => {
  const result = recognizeNonSearchIntent("Can I leave a review for this place?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "review_experience");
  assert.equal(result?.questionType, "review_write");
});

test("review_write intent: 'I just used this service and want to share my experience'", () => {
  const result = recognizeNonSearchIntent("I just used this service and want to share my experience");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "review_experience");
});

test("review_write intent: 'How do I rate a business?'", () => {
  const result = recognizeNonSearchIntent("How do I rate a business?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "review_experience");
});

test("review_write intent: Shona 'ndinoda kureview'", () => {
  const result = recognizeNonSearchIntent("ndinoda kureview");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "review_experience");
});

test("review_read intent: 'What do people say about Sunrise Guest House?'", () => {
  const result = recognizeNonSearchIntent("What do people say about Sunrise Guest House?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "get_reviews");
  assert.equal(result?.questionType, "reputation");
  assert.equal(result?.request.category, "sunrise guest house");
});

test("review_read intent: 'Are there reviews for that hotel?'", () => {
  const result = recognizeNonSearchIntent("Are there reviews for that hotel?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "get_reviews");
  assert.equal(result?.questionType, "reputation");
});

test("review_read intent: 'Show me experiences for the driving school'", () => {
  const result = recognizeNonSearchIntent("Show me experiences for the driving school");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "get_reviews");
  assert.equal(result?.request.category, "driving school");
});

test("review_read intent: Shona 'vanhu vanoti review'", () => {
  const result = recognizeNonSearchIntent("vanhu vanoti review");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "get_reviews");
});

test("profile_creation intent: 'I want to create a TrustHub profile'", () => {
  const result = recognizeNonSearchIntent("I want to create a TrustHub profile");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "profile_creation");
  assert.equal(result?.questionType, "profile_creation");
});

test("profile_creation intent: 'How do I join TrustHub?'", () => {
  const result = recognizeNonSearchIntent("How do I join TrustHub?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "profile_creation");
});

test("profile_creation intent: Shona 'ndinoda trusthub profile'", () => {
  const result = recognizeNonSearchIntent("ndinoda trusthub profile");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "profile_creation");
});

test("accommodation intent: 'I need a place to stay'", () => {
  const result = recognizeNonSearchIntent("I need a place to stay");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "find_business");
  assert.equal(result?.questionType, "business_discovery");
  assert.equal(result?.request.category, "accommodation");
});

test("accommodation intent: 'Where can I stay in Harare?'", () => {
  const result = recognizeNonSearchIntent("Where can I stay in Harare?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "find_business");
  assert.equal(result?.request.category, "accommodation");
});

test("accommodation intent: 'Looking for cheap accommodation for tonight'", () => {
  const result = recognizeNonSearchIntent("Looking for cheap accommodation for tonight");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "find_business");
  assert.equal(result?.request.category, "accommodation");
});

test("accommodation intent: Shona 'ndinoda kugara'", () => {
  const result = recognizeNonSearchIntent("ndinoda kugara");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "find_business");
  assert.equal(result?.request.category, "accommodation");
});

test("recruitment intent: job seeker 'I'm looking for a job'", () => {
  const result = recognizeNonSearchIntent("I'm looking for a job");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "job_seeker");
  assert.equal(result?.questionType, "recruitment");
});

test("recruitment intent: job seeker 'I need work in Harare'", () => {
  const result = recognizeNonSearchIntent("I need work in Harare");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "job_seeker");
});

test("recruitment intent: employer 'we need two drivers'", () => {
  const result = recognizeNonSearchIntent("we need two drivers");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "employer_recruiting");
});

test("recruitment intent: employer 'I'm looking for a plumber to hire'", () => {
  const result = recognizeNonSearchIntent("I'm looking for a plumber to hire");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "employer_recruiting");
});

test("recruitment intent: vacancy search 'do you have vacancies?'", () => {
  const result = recognizeNonSearchIntent("do you have vacancies?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "vacancy_search");
});

test("recruitment intent: vacancy create 'I want to advertise a vacancy'", () => {
  const result = recognizeNonSearchIntent("I want to advertise a vacancy");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "vacancy_create");
});

test("recruitment intent: candidate search 'can you find someone with accounting experience?'", () => {
  const result = recognizeNonSearchIntent("can you find someone with accounting experience?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "candidate_search");
});

test("recruitment intent: recruitment status 'what happened to my application?'", () => {
  const result = recognizeNonSearchIntent("what happened to my application?");
  assert.ok(result, "expected recognized intent");
  assert.equal(result?.intent, "recruitment_status");
});

test("a service search is not mistaken for recruitment", () => {
  for (const text of ["I need a plumber", "any hair salons in Bulawayo?", "find a driving school in Harare"]) {
    const result = recognizeNonSearchIntent(text);
    assert.equal(result, null, `expected null for service request: ${text}`);
  }
});

test("search requests are not recognized as non-search intents", () => {
  for (const text of [
    "Find a driving school in Harare",
    "I'm looking for a plumber",
    "Any hair salons in Bulawayo?",
    "Where is the nearest pharmacy?",
  ]) {
    const result = recognizeNonSearchIntent(text);
    assert.equal(result, null, `expected null for search request: ${text}`);
  }
});

test("greetings are not recognized as non-search intents", () => {
  for (const text of ["Hi", "Hello", "Hey", "Mhoro"]) {
    const result = recognizeNonSearchIntent(text);
    assert.equal(result, null, `expected null for greeting: ${text}`);
  }
});

test("thanks/goodbye are not recognized as non-search intents", () => {
  for (const text of ["Thanks", "Thank you", "Bye", "Goodbye", "Tatenda"]) {
    const result = recognizeNonSearchIntent(text);
    assert.equal(result, null, `expected null for thanks/goodbye: ${text}`);
  }
});