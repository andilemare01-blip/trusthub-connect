import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseMetaWhatsAppWebhook, verifyMetaWebhookSignature } from "../lib/whatsapp/meta-webhook.ts";
import { authorizeWhatsAppWebhook } from "../lib/whatsapp/webhook-auth.ts";
import { handleMetaWebhookVerification } from "../lib/whatsapp/webhook-verification.ts";

test("Meta webhook verification returns the exact challenge as plain text", async () => {
  const response = handleMetaWebhookVerification(new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": "test-token",
    "hub.challenge": "challenge+with=reserved%chars",
  }), "test-token");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(await response.text(), "challenge+with=reserved%chars");
});

test("Meta webhook verification rejects invalid and incomplete requests", () => {
  const validShape = { "hub.mode": "subscribe", "hub.challenge": "challenge" };
  assert.equal(handleMetaWebhookVerification(new URLSearchParams({ ...validShape, "hub.verify_token": "wrong" }), "test-token").status, 403);
  assert.equal(handleMetaWebhookVerification(new URLSearchParams({ ...validShape, "hub.verify_token": "test-token" }), "test-token").status, 200);
  assert.equal(handleMetaWebhookVerification(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "test-token" }), "test-token").status, 403);
  assert.equal(handleMetaWebhookVerification(new URLSearchParams({ ...validShape, "hub.verify_token": "test-token" }), undefined).status, 503);
});

test("Meta webhook signature must match the exact raw body", () => {
  const secret = "test-secret";
  const body = '{"object":"whatsapp_business_account"}';
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature(body, signature, secret), true);
  assert.equal(verifyMetaWebhookSignature(`${body} `, signature, secret), false);
  assert.equal(verifyMetaWebhookSignature(body, null, secret), false);
});

test("webhook authorization verifies signatures before checking outbound configuration", () => {
  let sendConfigurationChecked = false;
  const provider = {
    isWebhookConfigured: () => true,
    verifyWebhookSignature: (_body: string, signature: string | null) => signature === "valid",
    isSendConfigured: () => { sendConfigurationChecked = true; return false; },
  };
  assert.equal(authorizeWhatsAppWebhook(provider, "raw", "invalid"), "unauthorized");
  assert.equal(sendConfigurationChecked, false);
  assert.equal(authorizeWhatsAppWebhook(provider, "raw", "valid"), "outbound_unavailable");
  assert.equal(sendConfigurationChecked, true);
});

test("Meta text webhook normalizes the provider ID, E.164 number and timestamp", async () => {
  const incoming = await parseMetaWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{}], messages: [{ id: "wamid.test", from: "263771234567", timestamp: "1790000000", type: "text", text: { body: "Hi" } }] } }] }],
  });
  assert.deepEqual(incoming, {
    providerMessageId: "wamid.test", senderPhoneNumber: "+263771234567", text: "Hi",
    timestamp: new Date(1790000000 * 1000).toISOString(), media: [],
  });
});

test("Meta media webhook records safe metadata without pretending to transcribe or read it", async () => {
  const incoming = await parseMetaWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{}], messages: [{ id: "wamid.voice", from: "263771234567", timestamp: "1790000000", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg" } }] } }] }],
  });
  assert.equal(incoming?.text, "");
  assert.deepEqual(incoming?.media, [{ providerMediaId: "media-1", kind: "voice", mimeType: "audio/ogg" }]);
});
