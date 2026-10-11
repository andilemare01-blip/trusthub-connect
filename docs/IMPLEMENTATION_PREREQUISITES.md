# TrustHub Connect — Implementation Prerequisites

This document contains **only** the remaining facts that must be verified
against the live TrustHub Supabase project before the first database
migration for TrustHub Connect can be written. It does not propose a schema,
does not modify any database, and does not add any credential.

**Status of this investigation:** A read-only live inspection of the
existing TrustHub Supabase project ("Trusthub", ref
`bygtmzwsmwsibtruzbcc`) has since been performed by the project owner and
reported into this task. Items it answered are now marked **VERIFIED**;
items it did not cover remain **BLOCKED**, not guessed, with the exact
metadata/query still required so the project owner (or someone with direct
Supabase access) can supply the remaining answers. No database was
modified to produce the VERIFIED facts below — this remains a read-only
record.

**CRITICAL SECURITY FINDING (VERIFIED):** `public.reviews` and
`public.business_hours` currently have **RLS DISABLED**, while RLS is
enabled on most other relevant tables. This is recorded here as a required
security task for whoever owns the TrustHub database — it has **not** been
remediated, and no RLS/policy change should be made as a side effect of
any other work without this being explicitly, separately approved and
reviewed.

---

## 1. Actual `profiles` columns and constraints

**VERIFIED (partial).** Full column list confirmed: `id` (bigint, primary
key), `user_id` (uuid, **unique**), `name`, `location`, `language`,
`intro`, `profile_image`, `trust_level`, `reviews`, `businesses_added`,
`joined_at`, `trust_points`, `last_active_at`. No phone-number column
exists.

**Still BLOCKED:** exact types/nullability/defaults for each column, and
whether `user_id` is a foreign key to `auth.users.id` (only "unique" was
reported, not the FK relationship). Source: `select column_name, data_type,
is_nullable, column_default from information_schema.columns where
table_name = 'profiles';`

## 2. Actual `admin_users` columns and constraints

**VERIFIED.** Exactly two columns: `user_id` (primary key) and
`created_at`. **No role/permission column exists today.**

**Resolved implication:** a role concept for `OWNER`/`TRUST_AGENT`
(architecture plan Sections 14/21) requires either adding a new column to
this table or introducing a new table — it cannot be built on top of an
existing-but-unused role field, because none exists.

## 3. Actual RLS state/policies on tables Connect will read

**VERIFIED (partial) — CRITICAL FINDING.** RLS is enabled on most relevant
tables, **but `public.reviews` and `public.business_hours` have RLS
DISABLED.** This is a live, confirmed security gap, not a hypothetical
one — see the note at the top of this document. It has not been
remediated.

**Still BLOCKED:** the exact policy definitions (roles, `USING`/`WITH
CHECK` expressions) for every table where RLS **is** enabled — knowing RLS
is "on" does not confirm the policies are correct or sufficient. Needed at
least for: `profiles`, `businesses`, `business_information_updates`,
`admin_users`, `communities`, `community_members`, `help_requests`. This
directly determines whether TrustHub Connect's own service-role usage is
safe and whether contributions can be inserted through the anon key or
require the service role. Source:
`select * from pg_policies where schemaname = 'public';` run with
sufficient privileges, or Supabase Studio → Authentication → Policies (per
table).

## 4. Existing Supabase Auth capabilities relevant to WhatsApp-first identity

**BLOCKED.** Not verifiable from either repository — this is a platform
capability/configuration question, not an application code question.

**Required:**
- Whether phone-number-based sign-in/sign-up is enabled for this Supabase
  project (Supabase supports phone auth via SMS OTP as a distinct provider
  that must be explicitly enabled).
- Whether the Supabase Admin API (service role) can create an
  `auth.users` row without an email/password (e.g. via
  `admin.createUser` with only a phone number or with
  `email_confirm`/`phone_confirm` flags), which would allow provisioning a
  WhatsApp-first identity without a shadow table.
- Whether any existing Auth hooks/triggers already run on user creation
  (e.g. a Postgres trigger that auto-creates a `profiles` row) that a new
  provisioning path would need to stay compatible with.
Source: Supabase Studio → Authentication → Providers/Settings, and Database
→ Triggers/Functions for anything attached to `auth.users`.

## 5. Whether a normalized categories/services structure already exists

**Still BLOCKED.** The live inspection reported `category`/`subcategory` as
plain columns on `businesses` (consistent with the earlier code-only
finding) but did not report — one way or the other — whether a separate
`categories`/`services` table exists elsewhere in the schema.

**Required:** Confirmation of whether such a table exists in the database
even though it's unused/unreferenced by the current application code, since
it would directly affect how `ServiceRequest.requestedCategory` should be
modeled (free text vs. foreign key). Source: `select table_name from
information_schema.tables where table_schema = 'public';` (full table
listing) — cross-check against the tables already named as existing in
this document.

## 6. Foreign-key/unique constraints relevant to identity linking

**VERIFIED (partial).** `profiles.user_id` is confirmed **unique**.

**Still BLOCKED:** whether `profiles.user_id` is also a foreign key to
`auth.users.id`, and whether `auth.users` has a populated `phone` column
(Supabase's built-in phone-auth column, relevant to item 4 below) that
could be used instead of a brand-new mapping table. Source:
`select conname, pg_get_constraintdef(oid) from pg_constraint where
conrelid = 'public.profiles'::regclass;` plus checking `auth.users`
columns via Supabase Studio (Authentication → Users) or
`information_schema.columns` where `table_schema = 'auth'`.

## 7. Existing community/location structures not visible in the repository

**VERIFIED — RESOLVES THIS ITEM'S EXISTENCE QUESTION.** A real
`public.communities` table **already exists**, along with
`community_members`, `community_posts`, `post_comments`, `post_reactions`,
and `help_requests`. None of these are referenced anywhere in the inspected
TrustHub application code — this confirms the repository's client-side-only
`communityKey` handling does not reflect the full live database. Separately
verified: `businesses` already has `country, city, area, community_key,
latitude, longitude` columns; `public.notifications` exists with `user_id,
type, title, message, entity_type, entity_id, metadata (jsonb), dedupe_key
(UNIQUE), read_at, created_at`; `public.community_seed_locks` exists
(confirming the seed-lock table `TRUSTHUB_CONNECT_RECON.md` could only
infer indirectly).

**New BLOCKED sub-item:** the exact column-level schema of `communities`,
`community_members`, `community_posts`, `post_comments`, `post_reactions`,
and `help_requests` — only their existence and names have been verified so
far. `help_requests` in particular must be inspected before designing a new
`ServiceRequest` structure (architecture plan Section 9), since it may
already implement some or all of that need. Source: same
`information_schema.tables`/`information_schema.columns` queries as item 5,
targeted at each of these table names specifically.

---

## What this document deliberately does not contain

- No proposed schema, migration, or table definition.
- No RLS policy proposal or remediation SQL (that follows only after item 3
  is fully answered and explicitly approved).
- No credentials, connection strings, or secret values.
- No assumption substituting for any still-BLOCKED item above — every open
  question here was left unanswered rather than guessed, per instruction.

## Next step once fully unblocked

Once someone with direct Supabase access supplies the answers to items 1–7
above, update this document's status per item (BLOCKED → CONFIRMED, with the
verified facts recorded) before any migration for the schemas sketched in
`docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md` is written. Per the standing
safety boundary, even after these are confirmed, the first real database
change must still be proposed and explicitly approved before execution.
