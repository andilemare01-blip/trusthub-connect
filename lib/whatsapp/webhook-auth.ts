export interface WebhookAuthenticator {
  isWebhookConfigured(): boolean;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  isSendConfigured(): boolean;
}

export type WebhookAuthorization = "verification_unavailable" | "unauthorized" | "outbound_unavailable" | "authorized";

/** Authenticate raw provider bytes before exposing outbound configuration or parsing the payload. */
export function authorizeWhatsAppWebhook(provider: WebhookAuthenticator, rawBody: string, signature: string | null): WebhookAuthorization {
  if (!provider.isWebhookConfigured()) return "verification_unavailable";
  if (!provider.verifyWebhookSignature(rawBody, signature)) return "unauthorized";
  if (!provider.isSendConfigured()) return "outbound_unavailable";
  return "authorized";
}
