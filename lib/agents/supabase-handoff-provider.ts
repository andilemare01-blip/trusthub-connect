import type { AgentAssignment, AgentAssignmentStatus } from "@/types/agent";
import type { SupabaseDataClient, SupabaseRow } from "../supabase/data-client";
import { requireDatabaseUuid } from "../conversation-coordinator/persistence-mapping";
import { SupabasePersistenceError } from "../supabase/data-client";
import type { TrustAgentHandoffProvider } from "./handoff";
import { createRuntimeEventId, type RuntimeEventRecorder } from "../observability/events";
import { SupabaseRuntimeEventRecorder } from "../observability/supabase-recorder";

const FIELDS = "id,help_request_id,agent_id,status,assigned_at,updated_at";
const ASSIGNMENT_STATUSES = new Set<AgentAssignmentStatus>(["assigned", "accepted", "declined", "completed"]);

/** Server-side persistent handoff state; agent eligibility remains the registry's responsibility. */
export class SupabaseTrustAgentHandoffProvider implements TrustAgentHandoffProvider {
  private readonly events: RuntimeEventRecorder;
  private readonly client: SupabaseDataClient;
  constructor(client: SupabaseDataClient, events?: RuntimeEventRecorder) {
    this.client = client;
    this.events = events ?? new SupabaseRuntimeEventRecorder(client);
  }

  async requestHandoff(input: { serviceRequestId: string; agentId: string; communityKey: string }): Promise<AgentAssignment> {
    const requestId = requireDatabaseUuid(input.serviceRequestId, "trust_agent_assignments.help_request_id");
    const agentId = input.agentId.trim();
    if (!agentId || agentId.length > 160) throw new Error("A valid Trust Agent ID is required.");
    const inserted = await this.client.from("trust_agent_assignments").upsert({
      help_request_id: requestId,
      agent_id: agentId,
      status: "assigned",
    }, { onConflict: "help_request_id", ignoreDuplicates: true }).select(FIELDS).maybeSingle();
    if (inserted.error && inserted.error.code !== "23505") {
      throw new SupabasePersistenceError("Create Trust Agent assignment: " + inserted.error.message, inserted.error.code);
    }
    let row = inserted.data && !Array.isArray(inserted.data) ? inserted.data as SupabaseRow : null;
    if (!row) {
      const existing = await this.client.from("trust_agent_assignments").select(FIELDS)
        .eq("help_request_id", requestId).maybeSingle();
      if (existing.error) throw new SupabasePersistenceError("Load Trust Agent assignment: " + existing.error.message, existing.error.code);
      row = existing.data && !Array.isArray(existing.data) ? existing.data as SupabaseRow : null;
    }
    if (!row) throw new SupabasePersistenceError("Trust Agent assignment conflict could not be resolved.");
    const request = await this.client.from("help_requests").update({ status: "in_progress" }).eq("id", requestId);
    if (request.error) throw new SupabasePersistenceError("Mark help request in progress: " + request.error.message, request.error.code);
    const assignment = this.mapRow(row);
    await this.events.record({
      id: createRuntimeEventId("agent_match_proposed", assignment.id),
      name: "agent_match_proposed",
      occurredAt: assignment.assignedAt,
      correlationId: requestId,
      actor: "system",
      entityType: "agent_assignment",
      entityId: assignment.id,
      attributes: { status: assignment.status },
    });
    return assignment;
  }

  async getStatus(assignmentId: string): Promise<AgentAssignmentStatus | null> {
    const id = requireDatabaseUuid(assignmentId, "trust_agent_assignments.id");
    const result = await this.client.from("trust_agent_assignments").select("status").eq("id", id).maybeSingle();
    if (result.error) throw new SupabasePersistenceError("Load Trust Agent assignment status: " + result.error.message, result.error.code);
    if (!result.data || Array.isArray(result.data)) return null;
    const status = String((result.data as SupabaseRow).status);
    if (!ASSIGNMENT_STATUSES.has(status as AgentAssignmentStatus)) throw new SupabasePersistenceError("Database returned an unsupported Trust Agent assignment status.");
    return status as AgentAssignmentStatus;
  }

  async acknowledge(assignmentId: string, status: Extract<AgentAssignmentStatus, "accepted" | "declined" | "completed">): Promise<void> {
    const id = requireDatabaseUuid(assignmentId, "trust_agent_assignments.id");
    const occurredAt = new Date().toISOString();
    const result = await this.client.from("trust_agent_assignments").update({ status, updated_at: occurredAt }).eq("id", id);
    if (result.error) throw new SupabasePersistenceError("Update Trust Agent assignment status: " + result.error.message, result.error.code);
    await this.events.record({
      id: createRuntimeEventId("handoff_status_changed", `${id}:${status}:${occurredAt}`),
      name: "handoff_status_changed",
      occurredAt,
      correlationId: id,
      actor: "trust_agent",
      entityType: "agent_assignment",
      entityId: id,
      attributes: { status },
    });
  }

  private mapRow(row: SupabaseRow): AgentAssignment {
    const status = String(row.status);
    if (!ASSIGNMENT_STATUSES.has(status as AgentAssignmentStatus)) throw new SupabasePersistenceError("Database returned an unsupported Trust Agent assignment status.");
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      serviceRequestId: String(row.help_request_id),
      status: status as AgentAssignmentStatus,
      assignedAt: String(row.assigned_at),
    };
  }
}
