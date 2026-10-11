import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthenticationRequiredError,
  SupabaseAuthenticationConfigurationError,
  requireAuthenticatedEnvironment,
  requireAuthenticatedUser,
} from "../lib/supabase/authentication.ts";

test("authenticated caller requires an access token before checking configuration", async () => {
  await assert.rejects(
    requireAuthenticatedUser("  ", { auth: { async getUser() { throw new Error("must not be called"); } } }),
    AuthenticationRequiredError,
  );
});

test("authenticated Supabase configuration accepts only the public client key", () => {
  assert.deepEqual(requireAuthenticatedEnvironment({
    SUPABASE_URL: "https://trusthub.example",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    SUPABASE_SECRET_KEY: "server-only-key",
  }), { url: "https://trusthub.example", publishableKey: "publishable-test-key" });
  assert.throws(() => requireAuthenticatedEnvironment({ SUPABASE_URL: "https://trusthub.example" }), SupabaseAuthenticationConfigurationError);
  assert.throws(() => requireAuthenticatedEnvironment({ SUPABASE_URL: "http://remote.example", SUPABASE_PUBLISHABLE_KEY: "publishable-test-key" }), SupabaseAuthenticationConfigurationError);
});

test("authenticated caller rejects an invalid or expired token", async () => {
  await assert.rejects(requireAuthenticatedUser("expired-token", {
    auth: { async getUser(token) { assert.equal(token, "expired-token"); return { data: { user: null }, error: { message: "expired" } }; } },
  }), AuthenticationRequiredError);
});

test("authenticated caller returns only the user verified by Supabase Auth", async () => {
  const expected = { id: "auth-user-1", phone: "+263771234567" };
  const user = await requireAuthenticatedUser("valid-token", {
    auth: { async getUser(token) { assert.equal(token, "valid-token"); return { data: { user: expected }, error: null }; } },
  });
  assert.deepEqual(user, expected);
});
