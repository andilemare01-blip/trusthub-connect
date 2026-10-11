-- Applied as trusthub_connect_migration_002 on 2026-09-29.
-- Idempotency key for one detected community contribution per inbound message.
-- The column is nullable, so existing/manual contributions remain supported.
ALTER TABLE public.contributions
  ADD CONSTRAINT contributions_source_message_id_key UNIQUE (source_message_id);
