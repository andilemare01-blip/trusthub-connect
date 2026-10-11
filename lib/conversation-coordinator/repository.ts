import type { RuntimeConversation } from "./types";

export interface RuntimeConversationRepository {
  get(conversationId: string): Promise<RuntimeConversation | null>;
  save(conversation: RuntimeConversation): Promise<void>;
  getByProviderMessageId?(providerMessageId: string): Promise<RuntimeConversation | null>;
}

/** Local-only persistence adapter. Replace this port after the approved schema/status mapping is resolved. */
export class InMemoryRuntimeConversationRepository implements RuntimeConversationRepository {
  private readonly records = new Map<string, RuntimeConversation>();

  async get(conversationId: string): Promise<RuntimeConversation | null> {
    const value = this.records.get(conversationId);
    return value ? structuredClone(value) : null;
  }

  async save(conversation: RuntimeConversation): Promise<void> {
    this.records.set(conversation.id, structuredClone(conversation));
  }

  async getByProviderMessageId(providerMessageId: string): Promise<RuntimeConversation | null> {
    for (const conversation of this.records.values()) {
      if (conversation.messages.some((message) => message.providerMessageId === providerMessageId)) return structuredClone(conversation);
    }
    return null;
  }
}


