import { createHmac, timingSafeEqual } from "node:crypto";
import { tryNormalizePhoneNumber } from "../identity/phone-number.ts";
import type { WhatsAppInboundMessage, WhatsAppMediaMetadata } from "./provider.ts";

export function verifyMetaWebhookSignature(rawBody: string, signature: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const received = Buffer.from(signature.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.length <= 4096 ? value : undefined; }

function mediaMetadata(type: unknown, value: unknown): WhatsAppMediaMetadata[] {
  if (typeof type !== "string") return [];
  const content = object(value);
  if (!content) return [];
  const kindByType: Record<string, WhatsAppMediaMetadata["kind"]> = { audio: "voice", image: "photo", video: "video", document: "document", sticker: "sticker", location: "location" };
  const kind = kindByType[type];
  if (!kind) return [];
  if (kind === "location") {
    const latitude = Number(content.latitude);
    const longitude = Number(content.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ providerMediaId: `location:${latitude},${longitude}`, kind, latitude, longitude, ...(string(content.name) ? { locationName: string(content.name) } : {}), ...(string(content.address) ? { locationAddress: string(content.address) } : {}) }];
  }
  const id = string(content.id);
  if (!id) return [];
  return [{ providerMediaId: id, kind, ...(string(content.mime_type) ? { mimeType: string(content.mime_type) } : {}), ...(string(content.filename) ? { fileName: string(content.filename) } : {}), ...(string(content.caption) ? { caption: string(content.caption) } : {}), ...(string(content.sha256) ? { sha256: string(content.sha256) } : {}) }];
}

export async function parseMetaWhatsAppWebhook(payload: unknown, now: () => number = Date.now): Promise<WhatsAppInboundMessage | null> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid WhatsApp event.");
  const root = payload as { object?: unknown; entry?: unknown };
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) throw new Error("Unsupported WhatsApp event.");
  for (const entry of root.entry) {
    if (!entry || typeof entry !== "object" || !Array.isArray((entry as { changes?: unknown }).changes)) continue;
    for (const change of (entry as { changes: unknown[] }).changes) {
      const value = (change as { value?: { messages?: unknown; contacts?: unknown } })?.value;
      if (!value || !Array.isArray(value.messages) || !Array.isArray(value.contacts)) continue;
      for (const item of value.messages) {
        if (!item || typeof item !== "object") continue;
        const message = item as Record<string, unknown>;
        const type = message.type;
        if (typeof message.id !== "string" || !message.id || message.id.length > 256 || typeof message.from !== "string") continue;
        // Meta sends national digits; the stored identity is always E.164.
        const phone = tryNormalizePhoneNumber(String(message.from));
        if (!phone) continue;
        const seconds = Number(message.timestamp);
        const timestamp = Number.isFinite(seconds) && Math.abs(seconds) <= 8_640_000_000_000
          ? new Date(seconds * 1000).toISOString() : new Date(now()).toISOString();
        const textBody = object(message.text)?.body;
        const interactive = object(message.interactive);
        const buttonReply = object(interactive?.button_reply);
        const listReply = object(interactive?.list_reply);
        if (type === "text" && typeof textBody === "string" && textBody.length > 5000) throw new Error("WhatsApp text message exceeds the supported size.");
        const text = type === "text" && typeof textBody === "string" ? textBody : string(buttonReply?.id) ?? string(buttonReply?.title) ?? string(listReply?.id) ?? string(listReply?.title) ?? "";
        const media = mediaMetadata(type, message[type as string]);
        return { providerMessageId: message.id, senderPhoneNumber: phone, text, timestamp, media };
      }
    }
  }
  return null;
}

export interface MetaEventClassification {
  /** `status_update`: delivery/read receipts, not a person writing; `unusable_message`: a message arrived but could not be normalised. */
  kind: "status_update" | "unusable_message" | "no_content" | "malformed";
  statuses: number;
  messages: number;
  /** Why a present message was unusable: `missing_contacts` or `invalid_sender` or `missing_id`. */
  reason?: string;
}

/** Explains why an accepted webhook produced no message, using counts only: no content, numbers or signatures. */
export function classifyUnusableMetaEvent(payload: unknown): MetaEventClassification {
  const root = payload && typeof payload === "object" ? payload as { entry?: unknown } : null;
  if (!root || !Array.isArray(root.entry)) return { kind: "malformed", statuses: 0, messages: 0 };
  let statuses = 0;
  let messages = 0;
  let reason: string | undefined;
  for (const entry of root.entry) {
    const changes = entry && typeof entry === "object" ? (entry as { changes?: unknown }).changes : null;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown; statuses?: unknown; contacts?: unknown } })?.value;
      if (!value) continue;
      if (Array.isArray(value.statuses)) statuses += value.statuses.length;
      if (!Array.isArray(value.messages) || !value.messages.length) continue;
      messages += value.messages.length;
      if (!Array.isArray(value.contacts)) reason ??= "missing_contacts";
      for (const item of value.messages) {
        const message = item && typeof item === "object" ? item as Record<string, unknown> : {};
        if (typeof message.id !== "string" || !message.id) reason ??= "missing_id";
        else if (typeof message.from !== "string" || !tryNormalizePhoneNumber(message.from)) reason ??= "invalid_sender";
      }
    }
  }
  if (messages > 0) return { kind: "unusable_message", statuses, messages, ...(reason ? { reason } : {}) };
  if (statuses > 0) return { kind: "status_update", statuses, messages };
  return { kind: "no_content", statuses, messages };
}
