import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterAIOrchestrator } from "../lib/ai/orchestrator.ts";
import { AiGateway } from "../lib/ai/gateway.ts";
import { readAiConfig } from "../lib/ai/config.ts";
import { InMemoryAiSpendLedger } from "../lib/ai/spend-ledger.ts";
import { isReplyRequest } from "../lib/ai/reply-request.ts";

const config = readAiConfig({
  OPENROUTER_API_KEY: "test-key-not-real",
  OPENROUTER_MODEL: "test-model",
  OPENROUTER_INPUT_USD_PER_MILLION_TOKENS: "1",
  OPENROUTER_OUTPUT_USD_PER_MILLION_TOKENS: "2",
});

function fakeFetch(content: string, status = 200) {
  return (async () => new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    { status },
  )) as unknown as typeof fetch;
}

const reply = { conversationId: "c1", userMessage: "I need a plumber in Harare", history: [] };

test("a successful model response is returned as an AI-sourced reply", async () => {
  const orchestrator = new OpenRouterAIOrchestrator(new AiGateway(config, new InMemoryAiSpendLedger(), fakeFetch("Here is a plumber.")));
  const result = await orchestrator.generateReply(reply);
  assert.equal(result.source, "ai");
  assert.equal(result.text, "Here is a plumber.");
  assert.equal(result.shouldEscalateToAgent, false);
  assert.equal(result.diagnostic, undefined);
});

test("a provider failure returns a safe fallback that is never reported as an AI answer", async () => {
  const orchestrator = new OpenRouterAIOrchestrator(new AiGateway(config, new InMemoryAiSpendLedger(), fakeFetch("boom", 503)));
  const result = await orchestrator.generateReply(reply);
  assert.equal(result.source, "fallback");
  assert.equal(result.diagnostic?.reason, "upstream");
  // The fallback is a fixed, useful message — not the provider error and
  // not the user's private message.
  assert.ok(result.text.length > 0);
  assert.doesNotMatch(result.text, /boom/);
  assert.doesNotMatch(result.text, /plumber in Harare/);
});

test("the failure reason distinguishes credentials, rate limits, model access and upstream errors", async () => {
  const cases: [number, string][] = [
    [400, "unavailable"],
    [401, "invalid_credentials"],
    [402, "model_access"],
    [403, "model_access"],
    [404, "model_access"],
    [429, "rate_limited"],
    [500, "upstream"],
  ];
  for (const [status, reason] of cases) {
    const orchestrator = new OpenRouterAIOrchestrator(new AiGateway(config, new InMemoryAiSpendLedger(), fakeFetch("err", status)));
    const result = await orchestrator.generateReply(reply);
    assert.equal(result.source, "fallback", `status ${status}`);
    assert.equal(result.diagnostic?.reason, reason, `status ${status}`);
  }
});

test("a timeout is reported as a timeout, not a silent success", async () => {
  const timedOut = (async () => { throw new Error("The operation was aborted"); }) as unknown as typeof fetch;
  const orchestrator = new OpenRouterAIOrchestrator(new AiGateway(config, new InMemoryAiSpendLedger(), timedOut));
  const result = await orchestrator.generateReply(reply);
  assert.equal(result.source, "fallback");
  assert.equal(result.diagnostic?.reason, "timeout");
});

test("a valid reply request is accepted with optional, bounded history", () => {
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hello" }), true);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hello", history: [] }), true);
  assert.equal(isReplyRequest({
    conversationId: "c", userMessage: "hello",
    history: [{ role: "user", text: "earlier" }, { role: "assistant", text: "reply" }],
  }), true);
});

test("empty, malformed and incomplete requests are rejected", () => {
  assert.equal(isReplyRequest(null), false);
  assert.equal(isReplyRequest("string"), false);
  assert.equal(isReplyRequest({}), false);
  assert.equal(isReplyRequest({ conversationId: "c" }), false);
  assert.equal(isReplyRequest({ userMessage: "hello" }), false);
  assert.equal(isReplyRequest({ conversationId: "", userMessage: "hello" }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "  " }), false);
  assert.equal(isReplyRequest({ conversationId: 1, userMessage: "hello" }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: 2 }), false);
});

test("oversized messages and malformed history are rejected", () => {
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "x".repeat(2001) }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hi", history: "no" }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hi", history: [{ role: "other", text: "x" }] }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hi", history: [{ role: "user" }] }), false);
  assert.equal(isReplyRequest({ conversationId: "c", userMessage: "hi", history: new Array(21).fill({ role: "user", text: "x" }) }), false);
});
