-- Request lifecycle describes processing only. Outcomes and Trust Agent
-- assignments remain in their own persistent tables.
ALTER TABLE public.help_requests
  DROP CONSTRAINT IF EXISTS help_requests_connect_status_check;

ALTER TABLE public.help_requests
  ADD CONSTRAINT help_requests_connect_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled'));
