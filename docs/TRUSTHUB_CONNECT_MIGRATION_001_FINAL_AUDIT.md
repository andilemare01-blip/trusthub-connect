# TrustHub Connect Migration 001: applied verification

**Applied:** 2026-09-29 UTC 00:04:26  
**Project:** TrustHub (`bygtmzwsmwsibtruzbcc`)  
**Migration:** `trusthub_connect_migration_001`

The project owner authorized autonomous application of necessary, additive,
non-destructive migrations in the current build brief. Before applying this
migration, the live FK target types, `help_requests` RLS and policies, existing
table/column names, and absence of the Connect tables were inspected. The
migration creates no duplicate community/profile/business tables, does not
weaken existing RLS, and contains no destructive statements.

## Verification

- Supabase migration history includes `trusthub_connect_migration_001`.
- `whatsapp_identities`, `conversations`, `conversation_messages`, and
  `contributions` exist with RLS enabled.
- `whatsapp_identities` has no anon/authenticated policies. The other new
  tables have owner-scoped SELECT policies and no client write policies.
- `help_requests` has the seven additive Connect columns with the intended
  nullable types; its existing RLS configuration was not changed.
- The existing `communities` table was reused; the idempotent Harare and
  Chinhoyi bootstrap rows are part of the migration.
- No test/business/request/conversation data was inserted as part of
  verification.

The four new policies passed the intended owner-only access design. Supabase
performance advisors flag their `auth.uid()` expressions for per-row
reevaluation; this is a query-planning advisory, not an access-control defect.
No unrelated legacy policy or index findings were changed.

## Boundaries

This migration supplies persistence schema. It does not provision new Auth
users or create their canonical `profiles` rows. First-time WhatsApp senders
remain in the account-link-required response until the TrustHub Auth
provisioning and profile-creation path is confirmed and integrated. Existing
TrustHub `businesses` and `knowledge_records` remain separate.
