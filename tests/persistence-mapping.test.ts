import assert from "node:assert/strict";
import test from "node:test";
import { mapTurnToConversationMessageRow, mapTurnToConversationRow, requireDatabaseBigintId, requireDatabaseUuid, toPersistedConversationStatus } from "../lib/conversation-coordinator/persistence-mapping.ts";
import type { TurnResult } from "../lib/conversation-coordinator/types.ts";

const turn: TurnResult = {
  conversationId: "42", state: "human_handoff", action: "human_handoff_consented", reply: "Consent recorded.", resolution: null,
  communityConsentGranted: false, communityConsentAt: null, outcomeConfirmation: null,
  conversation: {
    id: "42", state: "human_handoff", pendingPermission: null, lastRequest: null, lastResolution: null,
    lastAction: "human_handoff_consented", updatedAt: "2026-09-27T10:00:00.000Z", transitions: [
      { from: "trust_agent_offer", to: "human_handoff", at: "2026-09-27T10:00:00.000Z", reason: "human_handoff_consented" },
    ],
    messages: [{ id: "local-message-id", conversationId: "42", channel: "web", direction: "outbound", sender: "system", text: "Consent recorded.", createdAt: "2026-09-27T10:00:00.000Z" }],
  },
};

test("keeps bigint identities as strings and maps detailed engine state to the coarse SQL status", () => {
  const row = mapTurnToConversationRow(turn, { channel: "web", whatsappIdentityId: null, profileId: "123", communityId: "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b", area: null });
  assert.equal(row.id, "42");
  assert.equal(row.profile_id, "123");
  assert.equal(row.community_id, "c5c4b06a-035a-4a49-8a9e-1ee22fb4938b");
  assert.equal(row.status, "open");
  assert.equal(toPersistedConversationStatus("waiting_for_agent"), "awaiting_agent");
  assert.equal(toPersistedConversationStatus("unresolved"), "open");
  assert.throws(() => requireDatabaseBigintId("9007199254740993x", "id"), /positive bigint/);
  assert.throws(() => requireDatabaseUuid("Zimbabwe:Harare", "community_id"), /UUID/);
});

test("stores outcome and state-transition details in the migration's message metadata field", () => {
  const row = mapTurnToConversationMessageRow(turn, 0);
  assert.equal(row.conversation_id, "42");
  assert.equal(row.content, "Consent recorded.");
  assert.equal(row.metadata.coordinator_state, "human_handoff");
  assert.equal(row.metadata.coordinator_action, "human_handoff_consented");
  assert.equal(row.metadata.transitions.length, 1);
  assert.equal(row.metadata.runtime_local_id, "local-message-id", "append deduplication must survive the mapping");
  assert.equal(row.provider_message_id, null, "a message with no provider ID must stay NULL, not an empty string");
  assert.equal(mapTurnToConversationMessageRow({ ...turn, conversation: { ...turn.conversation, messages: [{ ...turn.conversation.messages[0], providerMessageId: "wamid.abc" }] } }, 0).provider_message_id, "wamid.abc");
});
