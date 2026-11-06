import assert from "node:assert/strict";
import test from "node:test";
import { alreadyBeingAnswered, CLAIM_WINDOW_MS } from "../lib/whatsapp/webhook-claim.ts";

function fakeClient() {
  const rows = new Map<string, { occurred_at: string }>();
  let filter = "";
  return {
    from: () => ({
      insert: async (values: Record<string, unknown>) => {
        if (rows.has(String(values.id))) return { data: null, error: { code: "23505" } };
        rows.set(String(values.id), { occurred_at: String(values.occurred_at) });
        return { data: null, error: null };
      },
      select: () => ({ eq: (_column: string, value: unknown) => { filter = String(value); return { maybeSingle: async () => ({ data: rows.get(filter) ?? null, error: null }) }; } }),
    }),
  };
}

test("a retry that arrives while the first attempt is working gets no second reply", async () => {
  const client = fakeClient();
  assert.equal(await alreadyBeingAnswered(client, "wamid.1", 1_000_000), false);
  assert.equal(await alreadyBeingAnswered(client, "wamid.1", 1_020_000), true);
  assert.equal(await alreadyBeingAnswered(client, "wamid.2", 1_020_000), false);
});

test("a retry after the window can recover a failed attempt", async () => {
  const client = fakeClient();
  await alreadyBeingAnswered(client, "wamid.1", 1_000_000);
  assert.equal(await alreadyBeingAnswered(client, "wamid.1", 1_000_000 + CLAIM_WINDOW_MS + 1), false);
});

test("a database problem never blocks a reply", async () => {
  const broken = { from: () => { throw new Error("down"); } };
  assert.equal(await alreadyBeingAnswered(broken as never, "wamid.1"), false);
});
