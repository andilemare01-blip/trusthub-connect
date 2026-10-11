import type { Conversation, ConversationMessage } from "@/types/conversation";

export class NotConnectedError extends Error {
  constructor(method: string) {
    super(`ConversationRepository.${method} is not connected yet.`);
    this.name = "NotConnectedError";
  }
}

/** Channel-agnostic conversation/message persistence — WhatsApp is only one channel (see types/conversation.ts's MessageChannel). */
export interface ConversationRepository {
  startConversation(conversation: Omit<Conversation, "id" | "startedAt" | "lastMessageAt">): Promise<Conversation>;
  appendMessage(message: Omit<ConversationMessage, "id" | "createdAt">): Promise<ConversationMessage>;
}

class NotConnectedConversationRepository implements ConversationRepository {
  async startConversation(): Promise<Conversation> {
    throw new NotConnectedError("startConversation");
  }

  async appendMessage(): Promise<ConversationMessage> {
    throw new NotConnectedError("appendMessage");
  }
}

/** TODO: implement once the Conversation/ConversationMessage schema is approved. Live messages are not stored yet. */
export function createConversationRepository(): ConversationRepository {
  return new NotConnectedConversationRepository();
}
