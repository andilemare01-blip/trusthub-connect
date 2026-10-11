import type { OutboundWhatsAppMessage, WhatsAppDeliveryMetadata, WhatsAppInboundMessage, WhatsAppProvider } from "./provider";

export interface FakeWhatsAppProviderBehavior { parseError?: Error; sendError?: Error; }

/** Test/local-only deterministic fake. It accepts only the explicitly normalized local payload contract. */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly delivered: { message: OutboundWhatsAppMessage; metadata: WhatsAppDeliveryMetadata }[] = [];
  private inboundCounter = 0;
  private outboundCounter = 0;
  private readonly now: () => string;
  private readonly behavior: FakeWhatsAppProviderBehavior;
  constructor(now: () => string = () => new Date().toISOString(), behavior: FakeWhatsAppProviderBehavior = {}) { this.now = now; this.behavior = behavior; }

  async parseIncomingWebhook(payload: unknown): Promise<WhatsAppInboundMessage | null> {
    if (this.behavior.parseError) throw this.behavior.parseError;
    if (!payload || typeof payload !== "object") throw new Error("Invalid local WhatsApp payload.");
    const input = payload as Record<string, unknown>;
    if (typeof input.senderPhoneNumber !== "string" || !/^\+[1-9]\d{7,14}$/.test(input.senderPhoneNumber)) throw new Error("A valid E.164 senderPhoneNumber is required.");
    if (typeof input.text !== "string") throw new Error("Text must be a string.");
    const id = typeof input.providerMessageId === "string" ? input.providerMessageId : `local-in-${++this.inboundCounter}`;
    const timestamp = typeof input.timestamp === "string" && !Number.isNaN(Date.parse(input.timestamp)) ? input.timestamp : this.now();
    return { providerMessageId: id, senderPhoneNumber: input.senderPhoneNumber, text: input.text, timestamp, media: [] };
  }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<WhatsAppDeliveryMetadata> {
    if (this.behavior.sendError) throw this.behavior.sendError;
    const metadata = { providerMessageId: `local-out-${++this.outboundCounter}`, status: "accepted" as const, acceptedAt: this.now() };
    this.delivered.push({ message: structuredClone(message), metadata });
    return metadata;
  }
}

export function createFakeWhatsAppProvider(now?: () => string, behavior?: FakeWhatsAppProviderBehavior) { return new FakeWhatsAppProvider(now, behavior); }
