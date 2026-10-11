import type { IncomingMedia } from "@/types/media";

export class WhatsAppMediaNotConnectedError extends Error {
  constructor(method: string) {
    super(`WhatsAppMediaHandler.${method} is not connected yet.`);
    this.name = "WhatsAppMediaNotConnectedError";
  }
}

/** Parses inbound WhatsApp media (voice/photo/location/structured) into channel-agnostic contribution shapes. Does not transcribe audio itself — see lib/ai. */
export interface WhatsAppMediaHandler {
  parseIncomingMedia(payload: unknown): Promise<IncomingMedia | null>;
}

class NotConnectedWhatsAppMediaHandler implements WhatsAppMediaHandler {
  async parseIncomingMedia(): Promise<IncomingMedia | null> {
    throw new WhatsAppMediaNotConnectedError("parseIncomingMedia");
  }
}

/** TODO: implement once a WhatsApp provider is chosen and approved. */
export function createWhatsAppMediaHandler(): WhatsAppMediaHandler {
  return new NotConnectedWhatsAppMediaHandler();
}
