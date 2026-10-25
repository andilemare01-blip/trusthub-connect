import type { ConversationMessage } from "@/types/conversation";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`WhatsAppProvider.${method} is not connected yet. No WhatsApp provider credentials have been configured.`);
    this.name = "NotConnectedError";
  }
}

export interface OutboundWhatsAppMessage { 
  toPhoneNumber: string; 
  text: string; 
  correlationId?: string;
  interactive?: WhatsAppInteractiveMessage;
}

export interface WhatsAppInteractiveButton {
  id: string;
  title: string;
}

export interface WhatsAppInteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppInteractiveMessage {
  type: "button" | "list";
  header?: string;
  body?: string;
  footer?: string;
  buttonText?: string; // for list
  buttons?: WhatsAppInteractiveButton[]; // for button type (max 3)
  sections?: Array<{ title?: string; rows: WhatsAppInteractiveListRow[] }>; // for list
}
export interface WhatsAppInboundMessage {
  providerMessageId: string;
  senderPhoneNumber: string;
  text: string;
  timestamp: string;
  media: WhatsAppMediaMetadata[];
}
export interface WhatsAppMediaMetadata {
  providerMediaId: string;
  kind: "voice" | "photo" | "video" | "document" | "sticker" | "location" | "unknown";
  mimeType?: string;
  fileName?: string;
  caption?: string;
  sha256?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  locationAddress?: string;
}
export interface WhatsAppDeliveryMetadata { providerMessageId: string; status: "accepted" | "delivered" | "failed"; acceptedAt: string; }

/** Replaceable transport surface. Live implementations must validate provider signatures and auth. */
export interface WhatsAppProvider {
  sendMessage(message: OutboundWhatsAppMessage): Promise<WhatsAppDeliveryMetadata | void>;
  parseIncomingWebhook(payload: unknown): Promise<WhatsAppInboundMessage | null>;
  verifyWebhookSignature?(rawBody: string, signature: string | null): Promise<boolean> | boolean;
}

class NotConnectedWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(): Promise<WhatsAppDeliveryMetadata> { throw new NotConnectedError("sendMessage"); }
  async parseIncomingWebhook(): Promise<WhatsAppInboundMessage | null> { throw new NotConnectedError("parseIncomingWebhook"); }
}

export function createWhatsAppProvider(): WhatsAppProvider { return new NotConnectedWhatsAppProvider(); }

/** Compatibility helper for the existing normalized conversation message shape. */
export function toConversationMessage(message: WhatsAppInboundMessage, conversationId: string): ConversationMessage {
  return { id: message.providerMessageId, providerMessageId: message.providerMessageId, conversationId, channel: "whatsapp", direction: "inbound", sender: "user", text: message.text, createdAt: message.timestamp };
}
