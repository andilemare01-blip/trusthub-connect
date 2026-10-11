-- Add durable community consent and request idempotency to the canonical
-- help_requests table. The existing row is the help request; no parallel
-- community request table is introduced.
ALTER TABLE public.help_requests
  ADD COLUMN idempotency_key text,
  ADD COLUMN community_consent_at timestamptz,
  ADD COLUMN community_consent_version text;

ALTER TABLE public.help_requests
  ADD CONSTRAINT help_requests_idempotency_key_key UNIQUE (idempotency_key),
  ADD CONSTRAINT help_requests_idempotency_key_nonempty_check
    CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  ADD CONSTRAINT help_requests_community_consent_pair_check
    CHECK ((community_consent_at IS NULL) = (community_consent_version IS NULL)),
  ADD CONSTRAINT help_requests_community_consent_version_check
    CHECK (community_consent_version IS NULL OR length(btrim(community_consent_version)) BETWEEN 1 AND 80);

CREATE INDEX help_requests_consented_community_idx
  ON public.help_requests (community_id, created_at)
  WHERE community_consent_at IS NOT NULL;

COMMENT ON COLUMN public.help_requests.idempotency_key IS
  'Stable request creation key; Connect writes it for new requests and relies on the unique constraint for concurrent retries.';
COMMENT ON COLUMN public.help_requests.community_consent_at IS
  'Server-recorded timestamp for explicit requester consent to share/process this request in its community.';
COMMENT ON COLUMN public.help_requests.community_consent_version IS
  'Version identifier for the consent language shown to the requester.';

-- Authenticated users may join as ordinary members only. Privileged roles
-- are assigned by trusted server-side administration, never self-selected.
DROP POLICY IF EXISTS "Users can join communities" ON public.community_members;
CREATE POLICY "Users can join communities as members"
  ON public.community_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'member'
  );

-- Requesters retain access to their own rows. Other members can read only
-- rows whose requester gave explicit, versioned community-sharing consent.
DROP POLICY IF EXISTS "Authenticated users can view help requests" ON public.help_requests;
CREATE POLICY "Requesters can view own help requests"
  ON public.help_requests
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()));
CREATE POLICY "Members can view consented community help requests"
  ON public.help_requests
  FOR SELECT TO authenticated
  USING (
    community_consent_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_members AS member
      WHERE member.community_id = help_requests.community_id
        AND member.user_id = (SELECT auth.uid())
    )
  );

-- Persist one assignment per existing help request. Agent IDs retain the
-- current TrustAgent contract; no agent directory/role system is invented.
CREATE TABLE public.trust_agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  help_request_id uuid NOT NULL UNIQUE
    REFERENCES public.help_requests(id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (length(btrim(agent_id)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'accepted', 'declined', 'completed')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trust_agent_assignments ENABLE ROW LEVEL SECURITY;

-- One current, explicit outcome per help request. The server timestamp
-- supports audit/latency metrics; resolved_at is the confirmed outcome time.
CREATE TABLE public.help_request_outcomes (
  help_request_id uuid PRIMARY KEY
    REFERENCES public.help_requests(id) ON DELETE CASCADE,
  useful_answer_confirmed boolean NOT NULL DEFAULT false,
  match_confirmed boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.help_request_outcomes ENABLE ROW LEVEL SECURITY;

-- Validated low-sensitivity operational event sink. Writes remain server-only;
-- application validation rejects sensitive attribute names and values.
CREATE TABLE public.connect_runtime_events (
  id text PRIMARY KEY CHECK (length(btrim(id)) BETWEEN 1 AND 160),
  name text NOT NULL CHECK (name IN (
    'webhook_authenticated', 'inbound_normalized', 'identity_resolved',
    'request_understood', 'knowledge_lookup', 'answer_resolved',
    'contribution_recorded', 'community_help_planned', 'agent_match_proposed',
    'handoff_status_changed', 'notification_dispatched', 'request_outcome_recorded'
  )),
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'user', 'provider', 'trust_agent')),
  entity_type text NOT NULL CHECK (entity_type IN (
    'conversation', 'request', 'contribution', 'community_help',
    'agent_assignment', 'notification'
  )),
  entity_id text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(attributes) = 'object' AND octet_length(attributes::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connect_runtime_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX trust_agent_assignments_agent_status_idx
  ON public.trust_agent_assignments (agent_id, status, assigned_at DESC);
CREATE INDEX help_request_outcomes_recorded_at_idx
  ON public.help_request_outcomes (recorded_at DESC);
CREATE INDEX connect_runtime_events_entity_idx
  ON public.connect_runtime_events (entity_type, entity_id, occurred_at DESC);
