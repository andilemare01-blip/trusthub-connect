# TrustHub Connect Migration 002 audit

**Applied:** 2026-09-29  
**Migration:** `trusthub_connect_migration_002`

The migration adds only `UNIQUE (source_message_id)` to the new
`contributions` table. The column remains nullable, retaining support for
contributions without an inbound WhatsApp message. Before apply, the table
had zero rows and zero non-null source-message references. Verification
confirmed the named unique constraint exists in PostgreSQL.

This supplies retry-safe idempotency for WhatsApp contributions tied to a
persisted inbound message. It does not add or modify tables, policies, grants,
or existing production data.
