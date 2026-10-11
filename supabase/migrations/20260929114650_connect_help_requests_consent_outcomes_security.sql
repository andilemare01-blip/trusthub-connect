-- Replace every prior broad INSERT policy so authenticated users can create
-- only their own ordinary community membership. Existing SELECT policies
-- remain intact so members can use the existing community directory.
DO $migration$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'community_members'
      AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.community_members', policy_row.policyname);
  END LOOP;
END
$migration$;

CREATE POLICY "Connect users join as ordinary members"
  ON public.community_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND role = 'member');

-- Remove permissive catch-all SELECT policies. Requesters can see their own
-- requests; community members can see only requests with recorded consent.
DO $migration$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'help_requests'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.help_requests', policy_row.policyname);
  END LOOP;
END
$migration$;

CREATE POLICY "Connect requesters read own help requests"
  ON public.help_requests
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()));

CREATE POLICY "Connect members read consented community requests"
  ON public.help_requests
  FOR SELECT TO authenticated
  USING (
    community_consent_at IS NOT NULL
    AND community_consent_version IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.community_members AS member
      WHERE member.community_id = help_requests.community_id
        AND member.user_id = (SELECT auth.uid())
    )
  );

-- Keep pre-existing rows readable/updatable while requiring durable consent
-- and a stable retry key for every newly inserted community help request.
CREATE OR REPLACE FUNCTION public.connect_require_help_request_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.idempotency_key IS NULL
    OR length(btrim(NEW.idempotency_key)) NOT BETWEEN 1 AND 200
    OR NEW.community_consent_at IS NULL
    OR NEW.community_consent_version IS NULL
    OR length(btrim(NEW.community_consent_version)) NOT BETWEEN 1 AND 80
  ) THEN
    RAISE EXCEPTION 'new help requests require an idempotency key and versioned community consent evidence'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.community_consent_at IS NOT NULL AND (
    NEW.community_consent_at IS NULL OR NEW.community_consent_version IS NULL
  ) THEN
    RAISE EXCEPTION 'community consent evidence cannot be removed from a help request'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.community_consent_at IS NULL AND NEW.community_consent_at IS NOT NULL THEN
    RAISE EXCEPTION 'community consent evidence must be recorded atomically when creating the request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER connect_help_request_evidence_guard
  BEFORE INSERT OR UPDATE ON public.help_requests
  FOR EACH ROW EXECUTE FUNCTION public.connect_require_help_request_evidence();

-- Tables in the companion migration have no browser policies. Explicitly
-- restrict their table privileges to the server role as well as relying on
-- default-deny RLS.
REVOKE ALL ON public.trust_agent_assignments, public.help_request_outcomes,
  public.connect_runtime_events FROM anon, authenticated;
GRANT ALL ON public.trust_agent_assignments, public.help_request_outcomes,
  public.connect_runtime_events TO service_role;

REVOKE ALL ON FUNCTION public.connect_require_help_request_evidence() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.connect_require_help_request_evidence() IS
  'Requires consent evidence and an idempotency key on newly inserted community help requests; preserves legacy rows.';
-- The verified live check constraint omits states required by the current
-- ServiceRequest and outcome contracts. Preserve the legacy values while
-- allowing those application states in the same existing column.
ALTER TABLE public.help_requests DROP CONSTRAINT IF EXISTS help_requests_status_check;

ALTER TABLE public.help_requests
  ADD CONSTRAINT help_requests_connect_status_check
  CHECK (status IN (
    'open', 'in_progress', 'answered', 'matched', 'escalated_to_agent',
    'resolved', 'unanswered', 'cancelled'
  ));

