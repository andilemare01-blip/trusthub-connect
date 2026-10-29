-- Allows the `ai_call_failed` runtime event, which records why an AI provider
-- attempt failed (reason, model, HTTP status). Additive: it only widens the
-- allowed names; existing rows are untouched.
alter table public.connect_runtime_events drop constraint connect_runtime_events_name_check;
alter table public.connect_runtime_events add constraint connect_runtime_events_name_check check (
  name = any (array[
    'webhook_authenticated'::text, 'inbound_normalized'::text, 'identity_resolved'::text, 'request_understood'::text,
    'knowledge_lookup'::text, 'answer_resolved'::text, 'contribution_recorded'::text, 'community_help_planned'::text,
    'agent_match_proposed'::text, 'handoff_status_changed'::text, 'notification_dispatched'::text,
    'request_outcome_recorded'::text, 'ai_call_failed'::text
  ])
);
