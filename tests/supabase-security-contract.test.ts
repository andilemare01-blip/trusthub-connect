import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Connect migration keeps new tables RLS-enabled with default-deny WhatsApp identity access", async () => {
  const sql = await readFile(new URL("../docs/TRUSTHUB_CONNECT_MIGRATION_001.sql", import.meta.url), "utf8");
  for (const table of ["whatsapp_identities", "conversations", "conversation_messages", "contributions"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /whatsapp_identities: service_role only[\s\S]*?No policy is added for anon\/authenticated/i);
  assert.doesNotMatch(sql, /CREATE POLICY\s+\w+\s+ON\s+whatsapp_identities/i);
  assert.doesNotMatch(sql, /CREATE POLICY\s+\w+[\s\S]*?ON\s+(?:whatsapp_identities|conversations|conversation_messages|contributions)[\s\S]*?FOR\s+(?:INSERT|UPDATE|DELETE)/i);
});

test("Connect security migration keeps outcome/assignment/event tables server-only and help-request reads consent-gated", async () => {
  const tables = ["trust_agent_assignments", "help_request_outcomes", "connect_runtime_events"];
  const sql = await readFile(new URL("../supabase/migrations/20260929114103_trusthub_connect_consent_requests_outcomes_audit.sql", import.meta.url), "utf8");
  const security = await readFile(new URL("../supabase/migrations/20260929114650_connect_help_requests_consent_outcomes_security.sql", import.meta.url), "utf8");
  for (const table of tables) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.doesNotMatch(security, new RegExp(`CREATE POLICY[^;]*?ON public\\.${table}`, "i"), `${table} must stay policy-free (default-deny) for browser roles`);
  }
  assert.match(security, /REVOKE ALL ON[\s\S]*?FROM anon, authenticated/i);
  assert.match(security, /GRANT ALL ON[\s\S]*?TO service_role/i);
  // Browser roles may only read their own or consented community requests.
  assert.doesNotMatch(security, /CREATE POLICY[^;]*?ON public\.help_requests[^;]*?FOR (?:INSERT|UPDATE|DELETE)/i);
  assert.match(security, /CREATE POLICY[^;]*?ON public\.help_requests[^;]*?FOR SELECT TO authenticated/i);
  // Consent evidence is insert-only: the application may never attach it to an
  // existing request afterwards, which is why the durable community-help
  // adapter can only reuse a request that already carries consent evidence.
  assert.match(security, /UPDATE' AND OLD\.community_consent_at IS NULL AND NEW\.community_consent_at IS NOT NULL/i);
  assert.match(security, /NEW\.idempotency_key IS NULL/i);
});
