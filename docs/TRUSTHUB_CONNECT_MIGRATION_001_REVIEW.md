# TrustHub Connect — Migration 001 SQL Review

Review of `docs/TRUSTHUB_CONNECT_MIGRATION_001.sql` against
`docs/TRUSTHUB_CONNECT_FINAL_MIGRATION_SPEC.md`. This is a document review
only. The SQL file has **not** been executed, no Supabase connection was
made, no database object was created/altered/dropped, no data was
changed, no credential was added, and neither the existing TrustHub
project nor TrustHub SOS was touched while producing this review.

---

## 1. Every specification item is represented

| Spec item | Represented in SQL? |
|---|---|
| A1 `conversation_messages.provider_message_id` (nullable, unique) | ✅ `provider_message_id text NULL` + `UNIQUE` constraint |
| A2 `contributions.source_message_id` (nullable FK → `conversation_messages`) | ✅ present, `ON DELETE SET NULL` |
| A3 Community bootstrap (Harare, Chinhoyi) | ✅ idempotent `INSERT ... WHERE NOT EXISTS` on `(name, city, country)` |
| B1 RLS `INSERT` narrowed to `service_role`-only on the 4 new tables + `help_requests` additions | ✅ for the 4 new tables (no INSERT/UPDATE/DELETE policy granted to any other role); **not** re-applied to `help_requests` itself, since its existing RLS state is unverified (correct per spec Section J's own caveat and this task's instruction #6) |
| B2 `help_requests` cross-column check (`resolved`/`resolved_at`) | ✅ `help_requests_resolved_at_check` added via `ALTER TABLE ... ADD CONSTRAINT` |
| B3 Missing indexes (`contributions.related_conversation_id`, `contributions.related_help_request_id`, `help_requests(community_id, requested_category)`) | ✅ all three present |
| B4 `contributions.subject_type` (`NOT NULL CHECK`) | ✅ present, matches the 4 allowed values |
| B5 `help_requests.escalated_to_profile_id` | ✅ correctly **absent** — DEFERRED per spec, not added |
| B6 `area` normalization convention | ✅ not a schema change — the SQL adds plain `text` columns only, with a comment noting the application-layer convention lives outside this file; no `CHECK`/trigger was invented for it (correctly matches "documented, not enforced") |
| C `help_requests` extension (7 columns, not a new `service_requests` table) | ✅ exactly 7 columns added via `ALTER TABLE`; no `service_requests` table created |
| D Matching columns on `help_requests` (no `matches` table) | ✅ `matched_business_id`, `matched_contribution_id`; no `matches` table |
| E `area` as free text (no `community_areas` table) | ✅ plain `text` columns; no `community_areas` table |
| F Identity (real phone number, no synthetic placeholder, no parallel identity system) | ✅ see Section 8 below — verified directly |
| G `conversations`/`conversation_messages` | ✅ both created, exact column sets |
| H `contributions` full column set | ✅ all 19 columns present, matching the spec's list exactly |
| I No `KnowledgeGap`/outreach subsystem | ✅ none created |
| J RLS conceptual model | ✅ implemented for the 4 new tables (see Section 6); `help_requests` intentionally left untouched |
| K Existing-table reuse statement | ✅ see Section 7 below |
| L Final table set (4 new tables + 1 extended) | ✅ exactly 4 `CREATE TABLE` + 1 `ALTER TABLE help_requests` |
| M Migration order | ✅ tables created in the exact documented dependency order; `help_requests` altered only after `conversations`/`contributions` exist; indexes alongside their tables; RLS after all tables exist; bootstrap DML last |
| N Rollback considerations | Not part of this file by design — a separate, explicit operation per Section N; this file contains no destructive statements (see Section 3) |

## 2. No unapproved schema object exists

Grep-level check of every `CREATE TABLE` in the file: exactly
`whatsapp_identities`, `conversations`, `conversation_messages`,
`contributions`. No `service_requests`, `community_areas`, `matches`,
`knowledge_gaps`, any outreach table (`community_outreach`,
`outreach_recipients`, `outreach_responses`), any provider/capability
table, a duplicate `notifications` table, a duplicate `profiles` table, or
a duplicate `communities` table appears anywhere in the file — confirmed
by direct inspection of every `CREATE TABLE`/`ALTER TABLE` statement.

## 3. No destructive statement exists

The file contains no `DROP`, `TRUNCATE`, or `DELETE` statement anywhere.
The only DML is a single, guarded `INSERT ... WHERE NOT EXISTS` (community
bootstrap). All schema changes are additive: 4 new tables, and 7 new
*nullable* columns plus 3 new constraints and 4 new indexes on the one
existing table touched (`help_requests`). No existing column is renamed,
retyped, or dropped anywhere in the file.

## 4. All FK types — match, with one explicitly flagged, unresolved exception

- `whatsapp_identities.profile_id`, `conversations.profile_id`,
  `contributions.contributor_profile_id`/`reviewed_by_profile_id` →
  `profiles.id`: type `bigint`, matching the **VERIFIED** live type of
  `profiles.id`. ✅ Confirmed match.
- `conversations.whatsapp_identity_id` → `whatsapp_identities.id`;
  `conversation_messages.conversation_id` → `conversations.id`;
  `contributions.related_conversation_id`/`source_message_id`/
  `help_requests.conversation_id` → `conversations.id`/
  `conversation_messages.id`: all reference brand-new tables created
  earlier in this same file, so their types are self-consistent by
  construction (all `bigint`). ✅ Confirmed match.
- `contributions.related_help_request_id` → `help_requests.id`: typed
  `uuid`, matching the **VERIFIED** live type of `help_requests.id`
  (`uuid`). ✅ Confirmed match.
- `conversations.community_id`, `contributions.community_id`,
  `contributions.business_id`, `help_requests.matched_business_id` →
  `communities.id`/`businesses.id`: typed `bigint`, **NOT independently
  verified** against the live schema — this assumption was carried
  forward from the Final Migration Spec (which itself flags this exact
  gap in Section C, criterion 5, and lists it as approval-checklist item
  12). The SQL file marks every one of these four lines with an inline
  `-- MUST VERIFY` comment and repeats the warning in the file header. **If
  `communities.id`/`businesses.id` turn out to be `uuid` in the live
  database, this file cannot be executed as-is** — those four FK column
  types would need to change from `bigint` to `uuid` first. This is the
  one place FK types are *not* independently confirmed to match; it is
  documented, not silently assumed away.

## 5. All existing-table alterations are explicitly documented

Only one existing table is altered: `help_requests`. The `ALTER TABLE`
block adds exactly 7 nullable columns
(`conversation_id, requested_category, intent, area, matched_business_id,
matched_contribution_id, source_channel`), 3 constraints
(`help_requests_intent_check`, `help_requests_source_channel_check`,
`help_requests_resolved_at_check`), and 4 indexes. Two `COMMENT ON COLUMN`
statements record, inside the database's own metadata, that these columns
were added by this migration — so a future reader of the live schema
(without this file in hand) can still tell these columns are additive.
Every pre-existing `help_requests` column (`id, community_id,
requester_id, title, description, status, latitude, longitude,
created_at, resolved_at`) is left completely untouched — none appears on
either side of any `ALTER TABLE` statement in this file. No other
existing table (`profiles`, `businesses`, `communities`, `notifications`,
`admin_users`, `business_information_updates`, etc.) is altered anywhere
in the file.

## 6. All RLS policies are explicitly listed

RLS is enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on exactly
the 4 new tables. Policies created:

| Table | Policy | Operation | Effect |
|---|---|---|---|
| `whatsapp_identities` | *(none)* | — | Default-deny for everyone except `service_role` (which bypasses RLS entirely) — matches the spec's "`service_role` only for all operations." |
| `conversations` | `conversations_select_own` | `SELECT` | Owning profile only |
| `conversation_messages` | `conversation_messages_select_own` | `SELECT` | Owning profile only, via parent conversation |
| `contributions` | `contributions_select_own` | `SELECT` | Contributor only, own rows |

No `INSERT`/`UPDATE`/`DELETE` policy is created for any role other than
`service_role` on any of the 4 new tables — consistent with B1's decision
that all writes in Migration 1 happen server-side only.
`help_requests`'s RLS is **not modified at all** by this file (no
`ALTER TABLE help_requests ENABLE/DISABLE ROW LEVEL SECURITY`, no
`CREATE POLICY` referencing `help_requests`) — this is intentional and
matches this task's explicit instruction not to modify RLS on existing
tables except where the spec explicitly requires it; the spec does not
require it (it explicitly defers this to a verification step, approval
checklist items 9 and 11). `reviews`/`business_hours`'s RLS-disabled
finding is untouched, per instruction #7 — no statement in this file
references either table.

## 7. Community bootstrap is safe and idempotent

The `INSERT INTO communities ... WHERE NOT EXISTS (...)` statement only
inserts a `(name, city, country)` combination that is not already present.
Running this file twice against the same database inserts the two rows
once and is a no-op the second time — no duplicate rows, no error, no
`ON CONFLICT` dependency on a unique constraint that does not exist
(`communities` has no unique constraint on these columns — VERIFIED — so
the explicit `WHERE NOT EXISTS` guard is the correct mechanism, exactly as
the Final Migration Spec specifies). No other row in `communities` is
touched, updated, or removed. This is the only data-modifying statement in
the entire file.

## 8. Identity-related schema does not create a parallel permanent user system

- `whatsapp_identities` has no columns representing a name, password,
  session, or any other identity attribute beyond a phone number and a
  nullable link to `profiles.id` — it is structurally incapable of
  standing in as an identity on its own; it is a pure link/mapping table.
- No new `auth`-schema object is created anywhere in this file — the file
  never touches `auth.users` or any other `auth.*` table. Provisioning a
  Supabase Auth user (via `auth.admin.createUser`) is explicitly an
  **application-layer** operation (Final Migration Spec Section F,
  "APPLICATION REQUIREMENT"), not a migration/DDL concern, and does not
  appear in this SQL file at all — correctly, since it cannot be expressed
  as DDL.
- The canonical identity chain remains `auth.users` → `profiles` →
  `whatsapp_identities` (mapping only), exactly as specified — no table in
  this file could be mistaken for a second, competing identity store.
- No synthetic/placeholder identifier of any kind appears in this file —
  `whatsapp_identities.phone_number` is a plain `text` column intended to
  hold the real, application-normalized E.164 phone number; the SQL layer
  has no opinion on where that value comes from, consistent with the
  corrected Section F design (the actual `auth.admin.createUser({ phone,
  phone_confirm: true })` call and the explicit `profiles` row creation
  both happen in application code, not in this file).

## Summary

The generated SQL file faithfully implements the approved Final Migration
Specification: 4 new tables, 1 additive extension to `help_requests`, RLS
for the 4 new tables only, and a safe, idempotent community bootstrap — no
more, no less. The one open risk carried over from the specification
itself (the `communities.id`/`businesses.id` type assumption) is preserved
as an explicit, inline, unresolved warning rather than silently assumed
away or silently "fixed" by guessing. This file **must not be executed**
until that assumption is verified and until every item in the Final
Migration Specification's "FINAL HUMAN APPROVAL REQUIRED" checklist is
explicitly signed off.
