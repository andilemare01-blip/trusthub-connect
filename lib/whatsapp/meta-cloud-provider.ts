import "server-only";
import type { WhatsAppDeliveryMetadata, WhatsAppInboundMessage, WhatsAppProvider, OutboundWhatsAppMessage } from "./provider";
import { parseMetaWhatsAppWebhook, verifyMetaWebhookSignature } from "./meta-webhook";
import { diagnosticError, logWhatsAppDiagnostic } from "./diagnostics";

type Env = Record<string, string | undefined>;

/** Meta WhatsApp Cloud API transport. All credentials are read at runtime on the server. */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  private readonly env: Env;

  constructor(env: Env = process.env) { this.env = env; }

  isWebhookConfigured(): boolean { return !!this.env.WHATSAPP_APP_SECRET; }

  isSendConfigured(): boolean {
    return !!(this.env.WHATSAPP_ACCESS_TOKEN && this.env.WHATSAPP_PHONE_NUMBER_ID && this.env.WHATSAPP_GRAPH_API_VERSION);
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    return verifyMetaWebhookSignature(rawBody, signature, this.env.WHATSAPP_APP_SECRET);
  }

  parseIncomingWebhook(payload: unknown): Promise<WhatsAppInboundMessage | null> { return parseMetaWhatsAppWebhook(payload); }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<WhatsAppDeliveryMetadata> {
    const requestId = message.correlationId ?? "unknown";
    const startedAt = Date.now();
    logWhatsAppDiagnostic(requestId, "meta_outbound_send", { outcome: "attempted" });
    const token = this.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = this.env.WHATSAPP_PHONE_NUMBER_ID;
    const version = this.env.WHATSAPP_GRAPH_API_VERSION;
    if (!token || !phoneNumberId || !version) {
      const error = new Error("WhatsApp Cloud API configuration is incomplete.");
      logWhatsAppDiagnostic(requestId, "meta_outbound_response", { outcome: "failed", ...diagnosticError(error), durationMs: Date.now() - startedAt });
      throw error;
    }
    let payload: any;
    if (message.interactive?.type === "button" && message.interactive.buttons?.length) {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.toPhoneNumber.replace(/^\+/, ""),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.interactive.body || message.text },
          action: {
            buttons: message.interactive.buttons.slice(0, 3).map((btn) => ({
              type: "reply",
              reply: { id: btn.id, title: btn.title.slice(0, 20) }
            }))
          }
        }
      };
      if (message.interactive.header) payload.interactive.header = { type: "text", text: message.interactive.header };
      if (message.interactive.footer) payload.interactive.footer = { text: message.interactive.footer };
    } else if (message.interactive?.type === "list" && message.interactive.sections?.length) {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.toPhoneNumber.replace(/^\+/, ""),
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.interactive.body || message.text },
          action: {
            button: message.interactive.buttonText || "Select",
            sections: message.interactive.sections
          }
        }
      };
      if (message.interactive.header) payload.interactive.header = { type: "text", text: message.interactive.header };
      if (message.interactive.footer) payload.interactive.footer = { text: message.interactive.footer };
    } else {
      payload = { messaging_product: "whatsapp", recipient_type: "individual", to: message.toPhoneNumber.replace(/^\+/, ""), type: "text", text: { body: message.text } };
    }
    logWhatsAppDiagnostic(requestId, "meta_outbound_send", {
      outcome: "attempted",
      messageType: payload.type,
      payloadFields: Object.keys(payload),
      graphApiVersion: version.slice(0, 20),
      phoneNumberIdPresent: true,
      phoneNumberIdLength: phoneNumberId.length,
      phoneNumberIdLast4: phoneNumberId.slice(-4),
    });
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
    } catch (error) {
      logWhatsAppDiagnostic(requestId, "meta_outbound_response", { outcome: "failed", ...diagnosticError(error), durationMs: Date.now() - startedAt });
      throw error;
    }
    const data: unknown = await response.json().catch(() => null);
    const metaError = data && typeof data === "object" && data !== null && "error" in data
      && typeof data.error === "object" && data.error !== null ? data.error as { code?: unknown; message?: unknown; type?: unknown; error_subcode?: unknown; fbtrace_id?: unknown } : null;
    if (!response.ok) {
      const error = new Error(`WhatsApp provider rejected send (${response.status}).`);
      logWhatsAppDiagnostic(requestId, "meta_outbound_response", {
        outcome: "failed",
        httpStatus: response.status,
        ...(typeof metaError?.code === "string" || typeof metaError?.code === "number" ? { metaErrorCode: String(metaError.code).slice(0, 100) } : {}),
        ...(typeof metaError?.message === "string" ? { metaErrorMessage: diagnosticError(new Error(metaError.message)).errorMessage } : {}),
        ...(typeof metaError?.type === "string" ? { metaErrorType: metaError.type.slice(0, 100) } : {}),
        ...(typeof metaError?.error_subcode === "string" || typeof metaError?.error_subcode === "number" ? { metaErrorSubcode: String(metaError.error_subcode).slice(0, 100) } : {}),
        ...(typeof metaError?.fbtrace_id === "string" ? { metaFbtraceId: metaError.fbtrace_id.slice(0, 100) } : {}),
        ...diagnosticError(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    const messages = data && typeof data === "object" ? (data as { messages?: { id?: unknown }[] }).messages : undefined;
    const id = messages?.[0]?.id;
    if (typeof id !== "string") {
      const error = new Error("WhatsApp provider returned no message identifier.");
      logWhatsAppDiagnostic(requestId, "meta_outbound_response", { outcome: "failed", httpStatus: response.status, ...diagnosticError(error), durationMs: Date.now() - startedAt });
      throw error;
    }
    logWhatsAppDiagnostic(requestId, "meta_outbound_response", { outcome: "passed", httpStatus: response.status, durationMs: Date.now() - startedAt });
    return { providerMessageId: id, status: "accepted", acceptedAt: new Date().toISOString() };
  }
}
