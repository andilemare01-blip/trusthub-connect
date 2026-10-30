import assert from "node:assert/strict";
import test from "node:test";
import { AiGateway } from "../lib/ai/gateway.ts";
import { readAiConfig } from "../lib/ai/config.ts";
import { InMemoryAiSpendLedger } from "../lib/ai/spend-ledger.ts";

test("when every configured free model is retired, Wisdom finds today's free models and answers anyway", async () => {
  const called: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      return new Response(JSON.stringify({ data: [
        { id: "vendor/safety-guard:free", created: 30 },
        { id: "vendor/brand-new-chat:free", created: 20 },
        { id: "vendor/paid-model", created: 25 },
      ] }), { status: 200 });
    }
    const model = JSON.parse(String(init?.body)).model as string;
    called.push(model);
    if (model !== "vendor/brand-new-chat:free") return new Response(JSON.stringify({ error: { message: "This model is unavailable for free." } }), { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Hello from a fresh model" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), { status: 200 });
  }) as typeof fetch;
  const status = readAiConfig({ OPENROUTER_API_KEY: "test-key-not-real" });
  assert.ok(status.enabled);
  if (status.enabled) assert.equal(status.config.model, "openrouter/free");
  const gateway = new AiGateway(status, new InMemoryAiSpendLedger(), fetchImpl);
  const result = await gateway.complete({ key: "k1", purpose: "t", system: "s", user: "u" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(called.at(-1), "vendor/brand-new-chat:free");
  assert.ok(!called.includes("vendor/safety-guard:free"), "safety and paid models are never picked");
});
