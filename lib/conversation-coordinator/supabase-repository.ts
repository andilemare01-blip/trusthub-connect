import type { RuntimeConversationRepository } from "./repository";
import type { RuntimeConversation } from "./types";
import type { MessageChannel } from "../../types/conversation";
import type { RuntimeState } from "./types";
import type { WhatsAppDeliveryMetadata } from "../whatsapp/provider";
import { requireDatabaseBigintId, toPersistedConversationStatus } from "./persistence-mapping.ts";
import { requireData, requireRows, SupabasePersistenceError, type SupabaseDataClient, type SupabaseQueryResult, type SupabaseRow } from "../supabase/data-client.ts";
import { describeSupabaseFailure, runSupabaseOperation, supabaseFailureCode } from "../supabase/retry.ts";
import { diagnosticError, logWhatsAppDiagnostic } from "../whatsapp/diagnostics.ts";
import { isAssistantName } from "./wisdom-library.ts";

const CONVERSATION_FIELDS = "id,channel,whatsapp_identity_id,profile_id,community_id,area,status,started_at,last_message_at";
const MESSAGE_FIELDS = "id,conversation_id,channel,direction,sender,content,metadata,provider_message_id,created_at";

export interface StartPersistentConversation {
  channel: MessageChannel;
  whatsappIdentityId: string | null;
  profileId: string | null;
  communityId: string | null;
  area: string | null;
  /** Reuse the user's latest open session when processing a non-location follow-up such as consent. */
  reuseLatestOpenConversation?: boolean;
}

interface StoredSnapshot {
  state?: RuntimeState;
  pendingPermission?: "community" | "human" | null;
  lastRequest?: RuntimeConversation["lastRequest"];
  lastResolution?: RuntimeConversation["lastResolution"];
  lastAction?: RuntimeConversation["lastAction"];
  assistantName?: string;
  activeTask?: RuntimeConversation["activeTask"];
  transitions?: RuntimeConversation["transitions"];
}

function metadataRecord(value: unknown): SupabaseRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SupabaseRow : {};
}
function stringValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function conversationState(status: unknown): RuntimeState {
  if (status === "awaiting_agent") return "waiting_for_agent";
  if (status === "resolved") return "resolved";
  if (status === "abandoned") return "abandoned";
  return "ready_for_request";
}
function snapshotOf(conversation: RuntimeConversation): StoredSnapshot {
  return {
    state: conversation.state,
    pendingPermission: conversation.pendingPermission,
    lastRequest: conversation.lastRequest,
    lastResolution: conversation.lastResolution,
    lastAction: conversation.lastAction,
    ...(conversation.assistantName ? { assistantName: conversation.assistantName } : {}),
    ...(conversation.activeTask ? { activeTask: conversation.activeTask } : {}),
    transitions: conversation.transitions,
  };
}

export class SupabaseRuntimeConversationRepository implements RuntimeConversationRepository {
  private readonly client: SupabaseDataClient;
  private readonly correlationId?: string;

  constructor(client: SupabaseDataClient, correlationId?: string) { this.client = client; this.correlationId = correlationId; }

  /**
   * An insert is a POST, which the Supabase client never retries. The row may
   * already have been committed when the response was lost, so before repeating
   * it the session is looked up again: an existing open session for the same
   * identity/channel/community is the row this call intended to create.
   */
  private async findOpenConversation(input: StartPersistentConversation, scopeToCommunity = true): Promise<SupabaseQueryResult> {
    if (!input.whatsappIdentityId) return { data: null, error: null };
    const query = this.client.from("conversations").select("id")
      .eq("whatsapp_identity_id", input.whatsappIdentityId).eq("channel", input.channel)
      .eq("status", "open");
    if (scopeToCommunity) {
      if (input.communityId === null) query.is("community_id", null);
      else query.eq("community_id", input.communityId);
    }
    return await query.order("last_message_at", { ascending: false }).limit(1);
  }

  async createConversation(input: StartPersistentConversation): Promise<string> {
    if (input.profileId) requireDatabaseBigintId(input.profileId, "conversations.profile_id");
    if (input.whatsappIdentityId) requireDatabaseBigintId(input.whatsappIdentityId, "conversations.whatsapp_identity_id");
    let alreadyStored = false;
    const insert = await runSupabaseOperation(() => this.client.from("conversations").insert({
      channel: input.channel,
      whatsapp_identity_id: input.whatsappIdentityId,
      profile_id: input.profileId,
      community_id: input.communityId,
      area: input.area,
      status: "open",
    }).select("id").single(), {
      operation: "Create conversation",
      idempotent: false,
      retrySafe: async () => {
        alreadyStored = (await this.findOpenConversation(input)).data !== null;
        return alreadyStored;
      },
    });
    if (alreadyStored) {
      const existing = requireRows<{ id: unknown }>(await this.findOpenConversation(input), "Create conversation");
      return String(existing[0].id);
    }
    const row = requireData<{ id: unknown }>(insert, "Create conversation");
    return String(row.id);
  }

  async findOrStartConversation(input: StartPersistentConversation): Promise<string> {
    if (input.whatsappIdentityId) {
      const found = await this.findOpenConversation(input, !input.reuseLatestOpenConversation);
      const rows = requireRows<{ id: unknown }>(found, "Find open conversation");
      if (rows[0]) return String(rows[0].id);
    }
    return this.createConversation(input);
  }

  async get(conversationId: string): Promise<RuntimeConversation | null> {
    const id = requireDatabaseBigintId(conversationId, "conversations.id");
    const { data: conversationData, error: conversationError } = await this.client.from("conversations")
      .select(CONVERSATION_FIELDS).eq("id", id).maybeSingle();
    if (conversationError) throw new SupabasePersistenceError(describeSupabaseFailure("Load conversation", conversationError), supabaseFailureCode(conversationError));
    if (!conversationData || Array.isArray(conversationData)) return null;
    const row = conversationData as SupabaseRow;
    const { data: messageData, error: messageError } = await this.client.from("conversation_messages")
      .select(MESSAGE_FIELDS).eq("conversation_id", id).order("created_at", { ascending: true });
    const messages = requireRows(messageData === null && !messageError ? { data: [], error: null } : { data: messageData as SupabaseRow[] | null, error: messageError }, "Load conversation messages");

    let snapshot: StoredSnapshot = {};
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const metadata = metadataRecord(messages[index].metadata);
      const candidate = metadata.coordinator_snapshot;
      if (candidate && typeof candidate === "object") { snapshot = candidate as StoredSnapshot; break; }
    }
    const mappedMessages = messages.map((message) => {
      const metadata = metadataRecord(message.metadata);
      return {
        id: stringValue(metadata.runtime_local_id, "db-message:" + String(message.id ?? "")),
        conversationId: id,
        channel: stringValue(message.channel, "system") as MessageChannel,
        direction: stringValue(message.direction, "inbound") as "inbound" | "outbound",
        sender: stringValue(message.sender, "system") as "user" | "ai_agent" | "trust_agent" | "system",
        text: stringValue(message.content),
        createdAt: stringValue(message.created_at),
        ...(typeof message.provider_message_id === "string" ? { providerMessageId: message.provider_message_id } : {}),
        ...(Array.isArray(metadata.whatsappMedia) || metadata.detectedContribution || metadata.understanding || metadata.communityConsentAt || metadata.outcomeConfirmation ? { metadata: {
          ...(Array.isArray(metadata.whatsappMedia) ? { whatsappMedia: metadata.whatsappMedia } : {}),
          ...(metadata.detectedContribution && typeof metadata.detectedContribution === "object" ? { detectedContribution: metadata.detectedContribution } : {}),
          ...(metadata.understanding && typeof metadata.understanding === "object" ? { understanding: metadata.understanding } : {}),
          ...(typeof metadata.communityConsentAt === "string" ? { communityConsentAt: metadata.communityConsentAt } : {}),
          ...(metadata.outcomeConfirmation && typeof metadata.outcomeConfirmation === "object" ? { outcomeConfirmation: metadata.outcomeConfirmation } : {}),
        } } : {}),
      };
    });
    return {
      id,
      state: snapshot.state ?? conversationState(row.status),
      pendingPermission: snapshot.pendingPermission ?? null,
      lastRequest: snapshot.lastRequest ?? null,
      lastResolution: snapshot.lastResolution ?? null,
      lastAction: snapshot.lastAction ?? null,
      ...(isAssistantName(snapshot.assistantName) ? { assistantName: snapshot.assistantName } : {}),
      ...(snapshot.activeTask && typeof snapshot.activeTask.seq === "number" ? { activeTask: { seq: snapshot.activeTask.seq, completed: snapshot.activeTask.completed === true } } : {}),
      messages: mappedMessages,
      transitions: snapshot.transitions ?? [],
      updatedAt: stringValue(row.last_message_at, stringValue(row.started_at)),
      persistence: {
        channel: stringValue(row.channel, "web") as MessageChannel,
        whatsappIdentityId: row.whatsapp_identity_id == null ? null : String(row.whatsapp_identity_id),
        profileId: row.profile_id == null ? null : String(row.profile_id),
        communityId: row.community_id == null ? null : String(row.community_id),
        area: row.area == null ? null : String(row.area),
      },
    };
  }

  async getByProviderMessageId(providerMessageId: string): Promise<RuntimeConversation | null> {
    const { data, error } = await this.client.from("conversation_messages").select("conversation_id")
      .eq("provider_message_id", providerMessageId).maybeSingle();
    if (error) throw new SupabasePersistenceError(describeSupabaseFailure("Find provider message", error), supabaseFailureCode(error));
    if (!data || Array.isArray(data)) return null;
    return this.get(String((data as SupabaseRow).conversation_id));
  }

  async getDatabaseMessageIdByProviderMessageId(providerMessageId: string): Promise<string | null> {
    const { data, error } = await this.client.from("conversation_messages").select("id")
      .eq("provider_message_id", providerMessageId).maybeSingle();
    if (error) throw new SupabasePersistenceError(describeSupabaseFailure("Resolve persisted inbound message ID", error), supabaseFailureCode(error));
    if (!data || Array.isArray(data)) return null;
    return String((data as SupabaseRow).id);
  }

  async recordOutboundDelivery(conversationId: string, delivery: WhatsAppDeliveryMetadata): Promise<void> {
    const id = requireDatabaseBigintId(conversationId, "conversations.id");
    const { data, error } = await this.client.from("conversation_messages").select("id,metadata")
      .eq("conversation_id", id).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new SupabasePersistenceError(describeSupabaseFailure("Find outbound message for delivery update", error), supabaseFailureCode(error));
    if (!data || Array.isArray(data)) throw new SupabasePersistenceError("No persisted outbound message is available for delivery update.");
    const row = data as SupabaseRow;
    const metadata = { ...metadataRecord(row.metadata), delivery: { providerMessageId: delivery.providerMessageId, status: delivery.status, acceptedAt: delivery.acceptedAt } };
    const { error: updateError } = await this.client.from("conversation_messages").update({ metadata, provider_message_id: delivery.providerMessageId })
      .eq("id", String(row.id));
    if (updateError) throw new SupabasePersistenceError(describeSupabaseFailure("Persist outbound delivery metadata", updateError), supabaseFailureCode(updateError));
  }

  private async persistedLocalIds(conversationId: string): Promise<Set<string>> {
    const { data, error } = await this.client.from("conversation_messages")
      .select("metadata").eq("conversation_id", conversationId);
    const rows = requireRows(data === null && !error ? { data: [], error: null } : { data: data as SupabaseRow[] | null, error }, "Read persisted message keys");
    return new Set(rows.map((row) => stringValue(metadataRecord(row.metadata).runtime_local_id)));
  }

  async save(conversation: RuntimeConversation): Promise<void> {
    const conversationId = requireDatabaseBigintId(conversation.id, "conversations.id");
    const localIds = await this.persistedLocalIds(conversationId);
    const snapshot = snapshotOf(conversation);
    for (const message of conversation.messages) {
      if (localIds.has(message.id)) continue;
      const metadata = { ...metadataRecord(message.metadata), runtime_local_id: message.id, coordinator_snapshot: snapshot };
      const startedAt = Date.now();
      if (this.correlationId) {
        logWhatsAppDiagnostic(this.correlationId, "conversation_messages_persistence", { outcome: "attempted", direction: message.direction });
      }
      // A lost response must not append the same logical message twice, so a
      // repeat is only sent when the stored row is confirmed absent.
      let alreadyStored = false;
      let insert: SupabaseQueryResult;
      try {
        insert = await runSupabaseOperation(() => this.client.from("conversation_messages").insert({
          conversation_id: conversationId,
          channel: message.channel,
          direction: message.direction,
          sender: message.sender,
          content: message.text,
          metadata,
          provider_message_id: message.providerMessageId ?? null,
          created_at: message.createdAt,
        }), {
          operation: "Append conversation message",
          idempotent: false,
          retrySafe: async () => {
            alreadyStored = (await this.persistedLocalIds(conversationId)).has(message.id);
            return alreadyStored;
          },
        });
      } catch (error) {
        if (this.correlationId) {
          logWhatsAppDiagnostic(this.correlationId, "conversation_messages_persistence", {
            outcome: "failed",
            direction: message.direction,
            ...diagnosticError(error),
            durationMs: Date.now() - startedAt,
          });
        }
        throw error;
      }
      if (alreadyStored) {
        if (this.correlationId) {
          logWhatsAppDiagnostic(this.correlationId, "conversation_messages_persistence", {
            outcome: "skipped",
            direction: message.direction,
            reason: "already_persisted",
            durationMs: Date.now() - startedAt,
          });
        }
        continue;
      }
      if (insert.error && !(message.providerMessageId && insert.error.code === "23505")) {
        if (this.correlationId) {
          logWhatsAppDiagnostic(this.correlationId, "conversation_messages_persistence", {
            outcome: "failed",
            direction: message.direction,
            ...diagnosticError(insert.error),
            durationMs: Date.now() - startedAt,
          });
        }
        throw new SupabasePersistenceError(describeSupabaseFailure("Append conversation message", insert.error), supabaseFailureCode(insert.error));
      }
      if (this.correlationId) {
        logWhatsAppDiagnostic(this.correlationId, "conversation_messages_persistence", {
          outcome: insert.error ? "skipped" : "passed",
          direction: message.direction,
          durationMs: Date.now() - startedAt,
        });
      }
    }
    const { error } = await this.client.from("conversations").update({
      status: toPersistedConversationStatus(conversation.state),
      last_message_at: conversation.updatedAt,
    }).eq("id", conversationId);
    if (error) throw new SupabasePersistenceError(describeSupabaseFailure("Update conversation", error), supabaseFailureCode(error));
  }
}
