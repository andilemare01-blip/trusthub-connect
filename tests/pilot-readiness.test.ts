import assert from "node:assert/strict";
import test from "node:test";
import { PolicyAnswerResolver } from "../lib/answer-resolution/resolver.ts";
import type { AnswerSource, EvidenceItem, NormalizedRequest } from "../lib/answer-resolution/types.ts";
import { ConversationCoordinator, type CityValidator } from "../lib/conversation-coordinator/coordinator.ts";
import { InMemoryRuntimeConversationRepository } from "../lib/conversation-coordinator/repository.ts";
import { ASSISTANT_NAMES, WisdomLibrary } from "../lib/conversation-coordinator/wisdom-library.ts";
import { createAnswerGenerator } from "../lib/answer-resolution/response-generator.ts";
import { AiAnswerGenerator } from "../lib/ai/answer-generator.ts";
import { readAiConfig, DEFAULT_OPENROUTER_MODEL, type AiConfigStatus } from "../lib/ai/config.ts";
import { AiGateway } from "../lib/ai/gateway.ts";
import { InMemoryAiSpendLedger, RuntimeEventAiSpendLedger } from "../lib/ai/spend-ledger.ts";
import { AiAssistedUnderstandingProvider, DeterministicUnderstandingProvider, createConversationUnderstandingProvider, redactForAi } from "../lib/ai/understanding.ts";
import { FREE_SEARCH_TASKS, InMemorySearchTaskLedger, RuntimeEventSearchTaskLedger, usageStatusFrom } from "../lib/usage/search-tasks.ts";
import type { SupabaseDataClient, SupabaseQuery, SupabaseQueryResult, SupabaseRow } from "../lib/supabase/data-client.ts";

const library = WisdomLibrary.load();
const school: EvidenceItem = { id: "ev-1", claim: "TrustHub lists Safe Roads Driving School in Harare.", source: "trusthub", sourceLabel: "TrustHub business record", verificationStatus: "observed", confidence: "medium", retrievedAt: "2026-01-01T00:00:00.000Z", sourceRecordId: "biz-1", businessDetails: { phone: "+263 77 123 4567" } } as EvidenceItem;
const validate: CityValidator = async (city) => ["harare", "bulawayo"].includes(city.toLowerCase());

function stack(found: EvidenceItem[] = [school], calls: string[] = []) {
  const trusthub: AnswerSource = { async search(request: NormalizedRequest) { calls.push(`search:${request.category}`); return { matchStatus: found.length ? "matched" : "none", evidence: found }; } };
  const repository = new InMemoryRuntimeConversationRepository();
  const coordinator = new ConversationCoordinator(repository, new PolicyAnswerResolver({ trusthub }), () => "2026-01-01T00:00:00.000Z", undefined, library, validate);
  return { repository, coordinator, calls };
}
async function say(c: ConversationCoordinator, id: string, text: string, n: number) {
  const understanding = await new DeterministicUnderstandingProvider().understand(text);
  return c.handleTurn({ conversationId: id, channel: "whatsapp", text, request: understanding.request ?? undefined, understanding, providerMessageId: `${id}-${n}` });
}

const enabled = (overrides: Record<string, string> = {}): AiConfigStatus => readAiConfig({ OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_MODEL: "test-model", OPENROUTER_INPUT_USD_PER_MILLION_TOKENS: "1", OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS: "2", ...overrides });
function fakeFetch(content: string, usage: unknown = { prompt_tokens: 100, completion_tokens: 50 }, status = 200) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    requests.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status });
  }) as unknown as typeof fetch;
  return { impl, requests };
}

class EventTable implements SupabaseDataClient {
  readonly rows: SupabaseRow[] = [];
  from(): SupabaseQuery {
    const rows = this.rows;
    let operation: "select" | "upsert" = "select";
    let payload: SupabaseRow = {};
    const filters: [string, unknown][] = [];
    let max = Infinity;
    const run = (): SupabaseQueryResult => {
      if (operation === "upsert") { if (!rows.some((row) => row.id === payload.id)) rows.push({ ...payload }); return { data: null, error: null }; }
      return { data: rows.filter((row) => filters.every(([key, value]) => row[key] === value)).slice(0, max), error: null };
    };
    const query: SupabaseQuery = {
      select: () => query, insert: () => query, update: () => query, ilike: () => query, is: () => query, order: () => query,
      upsert: (values) => { operation = "upsert"; payload = values as SupabaseRow; return query; },
      eq: (column, value) => { filters.push([column, value]); return query; },
      limit: (count) => { max = count; return query; },
      single: () => Promise.resolve(run()), maybeSingle: () => Promise.resolve(run()),
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return query;
  }
}

test("1. a first-time anonymous user gets a useful sourced answer without any profile", async () => {
  const { coordinator } = stack();
  const result = await say(coordinator, "1", "I need a driving school in Harare", 0);
  assert.equal(result.state, "answer_found");
  assert.match(result.reply, /Safe Roads Driving School/);
  assert.match(result.reply, /TrustHub business record; observed; confidence: medium/);
});

test("3. a location followed by a service category continues the original search", async () => {
  const { coordinator, calls } = stack();
  const first = await say(coordinator, "3", "Harare", 0);
  assert.equal(first.state, "clarification_needed");
  assert.match(first.reply, /What type of business or service/);
  assert.equal(calls.length, 0);
  const second = await say(coordinator, "3", "a driving school", 1);
  assert.equal(second.state, "answer_found");
  assert.equal(second.conversation.lastRequest?.category, "driving school");
  assert.equal(second.conversation.lastRequest?.location?.city, "Harare");
  assert.deepEqual(calls, ["search:driving school"]);
  assert.doesNotMatch(second.reply, /trying to find or sort out/);
});

test("3b. a request made while a clarification is pending keeps the city already given", async () => {
  const { coordinator } = stack();
  await say(coordinator, "3b", "Harare", 0);
  const result = await say(coordinator, "3b", "I need a driving school", 1);
  assert.equal(result.conversation.lastRequest?.location?.city, "Harare");
  assert.equal(result.state, "answer_found");
});

test("4. assistant name is assigned once per conversation and drawn from the ten-name family", async () => {
  const { coordinator } = stack();
  const names = new Set<string | undefined>();
  for (const id of ["11", "12", "13", "14", "15"]) {
    const a = await say(coordinator, id, "Harare", 0);
    const b = await say(coordinator, id, "a driving school", 1);
    // The same conversation keeps the same name across messages and restarts.
    assert.equal(a.conversation.assistantName, b.conversation.assistantName);
    assert.equal(b.conversation.lastRequest?.location?.city, "Harare");
    names.add(b.conversation.assistantName);
  }
  // Every assigned name is one of the ten family members.
  for (const name of names) {
    assert.ok(name != null);
    assert.ok(ASSISTANT_NAMES.includes(name as (typeof ASSISTANT_NAMES)[number]));
  }
  // The assistant does not introduce itself as Wisdom on every new conversation.
  assert.notEqual(names.size, 1);
  assert.ok([...names].some((name) => name !== "Wisdom"));
});

test("8. a multi-message search completes exactly one task; a new search starts the next one", async () => {
  const { coordinator } = stack();
  const taskIds: string[] = [];
  for (const [index, text] of ["Harare", "a driving school", "do they have a phone number?", "thanks"].entries()) {
    const result = await say(coordinator, "8", text, index);
    if (result.completedTask) taskIds.push(result.completedTask.taskId);
  }
  assert.deepEqual(taskIds, ["8:1"]);
  const again = await say(coordinator, "8", "I need a plumber in Harare", 9);
  assert.equal(again.completedTask?.taskId, "8:2");
});

test("9. failed, empty and clarification-only turns never complete a task", async () => {
  const { coordinator } = stack([]);
  for (const [index, text] of ["Harare", "a driving school", "I need a plumber in Harare"].entries()) {
    assert.equal((await say(coordinator, "9", text, index)).completedTask, undefined, text);
  }
});

test("10. a duplicate webhook delivery adds no message, no task and no second reply", async () => {
  const { coordinator, repository } = stack();
  const first = await say(coordinator, "10", "I need a driving school in Harare", 0);
  const stored = (await repository.get("10"))!.messages.length;
  const again = await say(coordinator, "10", "I need a driving school in Harare", 0);
  assert.equal(again.completedTask, undefined);
  assert.equal(again.reply, first.reply);
  assert.equal((await repository.get("10"))!.messages.length, stored);
});

test("8b/10b. task completion is idempotent in the persistent ledger and tied to the identity", async () => {
  const table = new EventTable();
  const ledger = new RuntimeEventSearchTaskLedger(table);
  for (let attempt = 0; attempt < 3; attempt += 1) await ledger.recordCompleted({ identityId: "77", taskId: "8:1", at: "2026-01-01T00:00:00.000Z" });
  await ledger.recordCompleted({ identityId: "77", taskId: "8:2", at: "2026-01-01T00:00:00.000Z" });
  await ledger.recordCompleted({ identityId: "78", taskId: "9:1", at: "2026-01-01T00:00:00.000Z" });
  assert.equal(await ledger.completedCount("77"), 2);
  assert.equal(await ledger.completedCount("78"), 1);
  const memory = new InMemorySearchTaskLedger();
  await memory.recordCompleted({ identityId: "1", taskId: "t" }); await memory.recordCompleted({ identityId: "1", taskId: "t" });
  assert.equal(await memory.completedCount("1"), 1);
});

test("usage status separates free, completed and purchased credits and grants nothing unverified", () => {
  assert.deepEqual(usageStatusFrom(0), { completedTasks: 0, freeTasksAllowed: FREE_SEARCH_TASKS, freeTasksUsed: 0, freeTasksRemaining: 3, tasksBeyondFreeAllowance: 0, purchasedCreditsRemaining: 0 });
  assert.deepEqual(usageStatusFrom(5), { completedTasks: 5, freeTasksAllowed: 3, freeTasksUsed: 3, freeTasksRemaining: 0, tasksBeyondFreeAllowance: 2, purchasedCreditsRemaining: 0 });
});

test("AI configuration is off unless a key is present; a free model and zero pricing are the defaults", () => {
  assert.deepEqual(readAiConfig({}), { enabled: false, reason: "missing_api_key" });
  // A key alone is enough: the default model is a free OpenRouter model and free pricing is zero.
  const keyOnly = readAiConfig({ OPENROUTER_API_KEY: "k" });
  assert.ok(keyOnly.enabled, "a key alone should enable the default free configuration");
  if (keyOnly.enabled) {
    assert.equal(keyOnly.config.model, DEFAULT_OPENROUTER_MODEL);
    assert.equal(keyOnly.config.inputUsdPerMillion, 0);
    assert.equal(keyOnly.config.outputUsdPerMillion, 0);
    assert.equal(keyOnly.config.baseUrl, "https://openrouter.ai/api/v1");
  }
  // An explicit paid-style model id is honoured, but free pricing is still the default.
  const explicit = readAiConfig({ OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "openai/gpt-4o" });
  assert.ok(explicit.enabled, "an explicit model id should be honoured");
  if (explicit.enabled) assert.equal(explicit.config.model, "openai/gpt-4o");
  // Unknown pricing is no longer required: free defaults to zero and explicit prices are honoured.
  const priced = readAiConfig({ OPENROUTER_API_KEY: "k", OPENROUTER_INPUT_USD_PER_MILLION_TOKENS: "2.5", OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS: "10" });
  assert.ok(priced.enabled, "explicit per-million prices should be honoured");
  if (priced.enabled) {
    assert.equal(priced.config.inputUsdPerMillion, 2.5);
    assert.equal(priced.config.outputUsdPerMillion, 10);
  }
  assert.deepEqual(readAiConfig({ OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "http://insecure" }), { enabled: false, reason: "insecure_base_url" });
  const status = enabled();
  assert.ok(status.enabled && status.config.spendLimitMicroUsd === 50_000_000);
});

test("gateway: one bounded call, cost from reported usage, no retry on failure, repeat keys never re-call", async () => {
  const ledger = new InMemoryAiSpendLedger();
  const ok = fakeFetch("hello");
  const gateway = new AiGateway(enabled(), ledger, ok.impl);
  const first = await gateway.complete({ key: "k1", purpose: "t", system: "s", user: "u" });
  assert.ok(first.ok && first.costMicroUsd === 100 * 1 + 50 * 2);
  assert.equal(ok.requests[0].body.max_tokens, 300);
  assert.equal(ok.requests[0].body.model, "test-model");
  assert.equal((await gateway.complete({ key: "k1", purpose: "t", system: "s", user: "u" })).ok, false);
  assert.equal(ok.requests.length, 1);
  const broken = fakeFetch("x", {}, 500);
  const failing = new AiGateway(enabled(), new InMemoryAiSpendLedger(), broken.impl);
  const failure = await failing.complete({ key: "k2", purpose: "t", system: "s", user: "u" });
  assert.equal(failure.ok, false);
  if (!failure.ok) {
    // A 5xx is an upstream failure, distinct from a 4xx the provider rejected.
    assert.equal(failure.reason, "upstream");
    // A non-2xx response carries the provider's own body so a 400 is diagnosable.
    assert.equal(failure.providerMessage, '{"choices":[{"message":{"content":"x"}}],"usage":{}}');
  }
  assert.equal(broken.requests.length, 1);
});

test("gateway: provider status maps to a distinct, diagnosable failure reason", async () => {
  const cases: [number, string][] = [
    [400, "unavailable"],
    [401, "invalid_credentials"],
    [402, "model_access"],
    [403, "model_access"],
    [404, "model_access"],
    [429, "rate_limited"],
    [500, "upstream"],
    [503, "upstream"],
  ];
  for (const [status, reason] of cases) {
    const fake = fakeFetch("err", {}, status);
    const gateway = new AiGateway(enabled(), new InMemoryAiSpendLedger(), fake.impl);
    const failure = await gateway.complete({ key: `k-${status}`, purpose: "t", system: "s", user: "u" });
    assert.equal(failure.ok, false, `status ${status}`);
    if (!failure.ok) assert.equal(failure.reason, reason, `status ${status}`);
  }
});

test("gateway: missing usage is charged at the worst case, and the spend ceiling stops further calls", async () => {
  const ledger = new InMemoryAiSpendLedger();
  const noUsage = fakeFetch("hello", null);
  const gateway = new AiGateway(enabled({ AI_SPEND_LIMIT_USD: "0.001" }), ledger, noUsage.impl);
  const first = await gateway.complete({ key: "a", purpose: "t", system: "s", user: "u" });
  assert.ok(first.ok);
  assert.equal(ledger.entries[0].estimated, true);
  assert.ok(ledger.entries[0].costMicroUsd >= 300 * 2);
  const second = await gateway.complete({ key: "b", purpose: "t", system: "s", user: "u" });
  assert.deepEqual(second, { ok: false, reason: "budget_exhausted" });
  assert.equal(noUsage.requests.length, 1);
});

test("gateway: an unreadable spend ledger stops optional AI instead of guessing", async () => {
  const broken = { totalMicroUsd: async () => { throw new Error("db down"); }, hasCall: async () => false, record: async () => undefined };
  const sent = fakeFetch("hi");
  const result = await new AiGateway(enabled(), broken, sent.impl).complete({ key: "z", purpose: "t", system: "s", user: "u" });
  assert.deepEqual(result, { ok: false, reason: "ledger_unavailable" });
  assert.equal(sent.requests.length, 0);
});

test("persistent spend ledger sums recorded cost, ignores other events and refuses a full page it cannot verify", async () => {
  const table = new EventTable();
  const ledger = new RuntimeEventAiSpendLedger(table);
  await ledger.record({ key: "one", purpose: "interpret", model: "m", inputTokens: 10, outputTokens: 5, costMicroUsd: 1234, estimated: false, at: "2026-01-01T00:00:00.000Z" });
  await ledger.record({ key: "one", purpose: "interpret", model: "m", inputTokens: 10, outputTokens: 5, costMicroUsd: 1234, estimated: false, at: "2026-01-01T00:00:00.000Z" });
  assert.equal(await ledger.totalMicroUsd(), 1234);
  assert.equal(await ledger.hasCall("one"), true);
  assert.equal(await ledger.hasCall("two"), false);
  for (let index = 0; index < 1000; index += 1) table.rows.push({ id: `x${index}`, name: "request_understood", actor: "provider", attributes: { kind: "ai_call", costMicroUsd: 1 } });
  await assert.rejects(() => ledger.totalMicroUsd(), /cannot be verified/);
});

test("5. existing data is searched before AI is called; deterministic parsing needs no AI at all", async () => {
  const sent = fakeFetch(JSON.stringify({ is_search: true, category: "x", city: "Harare", area: null, wants_recommendation: false }));
  const provider = new AiAssistedUnderstandingProvider(new AiGateway(enabled(), new InMemoryAiSpendLedger(), sent.impl));
  const understood = await provider.understand("I need a driving school in Harare", { idempotencyKey: "m1" });
  assert.equal(understood.aiProviderStatus, "not_needed");
  assert.equal(sent.requests.length, 0);

  const order: string[] = [];
  const grounded = createAnswerGenerator();
  const spy = { async generate(resolution: Parameters<typeof grounded.generate>[0]) { order.push("generate"); return grounded.generate(resolution); } };
  const aiSent = fakeFetch("Safe Roads Driving School in Harare. Source: TrustHub business record, observed. Phone: +263 77 123 4567.");
  const instrumented = { ...aiSent, impl: ((url: string, init: { body: string }) => { order.push("ai"); return aiSent.impl(url, init as never); }) as unknown as typeof fetch };
  const trusthub: AnswerSource = { async search() { order.push("search"); return { matchStatus: "matched", evidence: [school] }; } };
  const repository = new InMemoryRuntimeConversationRepository();
  const coordinator = new ConversationCoordinator(repository, new PolicyAnswerResolver({ trusthub }), () => "2026-01-01T00:00:00.000Z", new AiAnswerGenerator(spy, new AiGateway(enabled(), new InMemoryAiSpendLedger(), instrumented.impl), "m2"), library, validate);
  await say(coordinator, "5", "I need a driving school in Harare", 0);
  assert.deepEqual(order, ["search", "generate", "ai"]);
});

test("7. AI presentation keeps source and verification status, and falls back if it drops or invents facts", async () => {
  const resolution = { status: "answered", evidence: [school], provenance: ["trusthub"], confidence: "medium", uncertainty: null, sourceAttempts: [], nextAction: "answer" } as never;
  const good = new AiAnswerGenerator(createAnswerGenerator(), new AiGateway(enabled(), new InMemoryAiSpendLedger(), fakeFetch("Safe Roads Driving School, Harare (TrustHub business record, observed). Call +263 77 123 4567.").impl), "k-good");
  assert.match((await good.generate(resolution)).text, /observed/);
  const grounded = (await createAnswerGenerator().generate(resolution)).text;
  for (const [index, output] of ["Safe Roads Driving School is great, call them.", "Safe Roads (TrustHub business record, observed) call +263 77 999 0000", "Safe Roads (TrustHub business record, verified) +263 77 123 4567"].entries()) {
    const generator = new AiAnswerGenerator(createAnswerGenerator(), new AiGateway(enabled(), new InMemoryAiSpendLedger(), fakeFetch(output).impl), `k-bad-${index}`);
    const text = (await generator.generate(resolution)).text;
    if (index < 2) assert.equal(text, grounded, output);
  }
  const unverified = { ...school, verificationStatus: "potential", sourceLabel: "OpenStreetMap" } as EvidenceItem;
  const potential = { status: "partially_answered", evidence: [unverified], provenance: ["openstreetmap"], confidence: "low", uncertainty: "This is unverified.", sourceAttempts: [], nextAction: "answer" } as never;
  const kept = await new AiAnswerGenerator(createAnswerGenerator(), new AiGateway(enabled(), new InMemoryAiSpendLedger(), fakeFetch("Try Safe Roads (OpenStreetMap, potential).").impl), "k-pot").generate(potential);
  assert.match(kept.text, /potential/);
  assert.match(kept.text, /This is unverified\./);
});

test("6. AI unavailable, misconfigured or over budget still gives deterministic help and never crashes", async () => {
  const unavailable = await createConversationUnderstandingProvider(undefined, {}).understand("who restores antique gramophones around Avondale", { idempotencyKey: "a" });
  assert.equal(unavailable.aiProviderStatus, "unavailable");
  const full = new InMemoryAiSpendLedger(); await full.record({ key: "old", purpose: "t", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 50_000_000, estimated: false, at: "x" });
  const sent = fakeFetch("{}");
  const blocked = await new AiAssistedUnderstandingProvider(new AiGateway(enabled(), full, sent.impl)).understand("who restores antique gramophones around Avondale", { idempotencyKey: "b" });
  assert.equal(blocked.aiProviderStatus, "fallback");
  assert.equal(sent.requests.length, 0);
  const throwing = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
  const failed = await new AiAssistedUnderstandingProvider(new AiGateway(enabled(), new InMemoryAiSpendLedger(), throwing)).understand("who restores antique gramophones around Avondale", { idempotencyKey: "c" });
  assert.equal(failed.aiProviderStatus, "fallback");
  const { coordinator } = stack();
  const result = await say(coordinator, "6", "I need a driving school in Harare", 0);
  assert.equal(result.state, "answer_found");
});

test("AI interpretation accepts only a well-formed search and produces a request the resolver can use", async () => {
  const sent = fakeFetch(JSON.stringify({ is_search: true, category: "mechanic", city: "Harare", area: "Avondale", wants_recommendation: true }));
  const provider = new AiAssistedUnderstandingProvider(new AiGateway(enabled(), new InMemoryAiSpendLedger(), sent.impl));
  const result = await provider.understand("who restores antique gramophones around Avondale", { idempotencyKey: "d" });
  assert.equal(result.aiProviderStatus, "used");
  assert.equal(result.request?.category, "mechanic");
  assert.equal(result.request?.questionType, "provider_recommendation");
  assert.equal(result.answerability, "ready_to_search");
  const garbage = await new AiAssistedUnderstandingProvider(new AiGateway(enabled(), new InMemoryAiSpendLedger(), fakeFetch("not json").impl)).understand("who restores antique gramophones around Avondale", { idempotencyKey: "e" });
  assert.equal(garbage.aiProviderStatus, "fallback");
  assert.equal(garbage.request, null);
});

test("11. nothing private reaches the model: numbers and emails are redacted and no ids or history are sent", async () => {
  const sent = fakeFetch(JSON.stringify({ is_search: false }));
  const provider = new AiAssistedUnderstandingProvider(new AiGateway(enabled(), new InMemoryAiSpendLedger(), sent.impl));
  await provider.understand("my car broke down, call me on +263 77 123 4567 or joe@example.com who can fix it", { idempotencyKey: "wamid.SECRET-ID" });
  const body = JSON.stringify(sent.requests[0].body);
  assert.doesNotMatch(body, /263 77|123 4567|joe@|example\.com|wamid|SECRET-ID/);
  assert.equal(redactForAi("call +263771234567 now"), "call [number] now");
  assert.equal(sent.requests[0].body.messages instanceof Array && (sent.requests[0].body.messages as unknown[]).length, 2);
});
