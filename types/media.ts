/**
 * Incoming media/contribution types for TrustHub Connect.
 *
 * NOT a confirmed database schema. WhatsApp is only one channel that may
 * deliver these; the shapes are channel-agnostic on purpose.
 */

export type IncomingMediaType = "text" | "voice" | "photo" | "location" | "structured";

export interface IncomingMedia {
  id: string;
  conversationId: string;
  type: IncomingMediaType;
  receivedAt: string;
}

export interface VoiceContribution extends IncomingMedia {
  type: "voice";
  audioUrl: string;
  /** Populated once a transcription provider is connected (not yet — see lib/ai). */
  transcript: string | null;
}

export interface PhotoContribution extends IncomingMedia {
  type: "photo";
  imageUrl: string;
  caption: string | null;
}

export interface LocationContribution extends IncomingMedia {
  type: "location";
  latitude: number;
  longitude: number;
}

export interface StructuredContribution extends IncomingMedia {
  type: "structured";
  fields: Record<string, string>;
}
