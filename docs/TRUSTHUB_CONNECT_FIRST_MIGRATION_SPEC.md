# TrustHub Connect — First Migration Specification

This is a design document only. No SQL was executed, no migration was
created or applied, no table was created, no Supabase data/RLS/Auth was
changed, and no credential was added while producing it. All column
types/constraints below are a **specification for review**, not DDL that
has been run.

**Sources used:** `TRUSTHUB_CONNECT_RECON.md`,
`docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md`,
`docs/IMPLEMENTATION_PREREQUISITES.md`,
`docs/TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md`,
`docs/TRUSTHUB_CONNECT_FOUNDATION.md`, and the project owner's cumulative
WhatsApp-first Community Intelligence & Identity product direction stated
across this conversation. Where this document narrows or changes a
proposal from the pre-migration blueprint, that is called out explicitly
below — nothing is silently replaced.

---

## 1. Migration Objective

Prove the smallest end-to-end path:

```
WhatsApp user → persistent TrustHub identity → country/city/area community
context → conversation → service request → contribution/knowledge →
useful outcome → future admin visibility
```

This migration does **not** attempt knowledge gaps as a first-class
record, community outreach, a structured provider/agent network, or
matching history — those are explicitly deferred (Section 22) with a
documented derivation or reuse path instead.

## 2. Existing Tables Reused (Not Duplicated)

`auth.users`, `profiles`, `businesses`, `reviews`, `review_helpfulness`,
`business_hours`, `business_claims`, `business_owners`,
`business_information_updates`, `admin_users`, `notifications`,
`communities`, `community_members`, `community_posts`, `post_comments`,
`post_reactions`, `help_requests`, `community_seed_locks`,
`google_seed_usage`, `trusted_contacts`, `sos_alerts`, `feedback`, and
trust-battle structures. None of these are altered by this migration
except where explicitly noted (none are altered — see Section 4).

## 3. Tables Explicitly NOT to Create

- A second identity/user table (identity stays `auth.users` + `profiles`).
- A second business table (businesses stay in `businesses`).
- A second community/city table (city-level stays in `communities`).
- A structured `community_areas` table — **narrowed from the pre-migration
  blueprint's proposal.** Migration 1 represents area as a plain nullable
  text column (mirroring `businesses.area`'s existing free-text pattern)
  on `conversations`/`service_requests`/`contributions` rather than a new
  relational table. Reason: no real area-level data exists yet to justify
  normalizing it, and a free-text column still satisfies "city-wide
  participation when area unknown" plus "area-specific intelligence when
  known" without a schema that outlives its evidence. A structured area
  table can be introduced later once area-level volume justifies it,
  without breaking this column (a future migration would add a
  foreign-keyed `area_id` alongside/replacing the text column).
- A second notification/outreach delivery table (`notifications` stays
  canonical; no `CommunityOutreach`/`OutreachRecipient`/`OutreachResponse`
  tables in migration 1 — Section 21).
- A `KnowledgeGap` table (Section 19 — derived instead).
- A structured provider/capability-marketplace table (Section 18 — folded
  into `contributions`).
- A `matches`/match-history table (Section 19 — folded into
  `service_requests` columns; no multi-candidate history in migration 1).
- Any admin role column/table on `admin_users` (Section 24 — not required
  for migration 1, since `/admin` has no live wiring yet regardless).
- Any new categories/services lookup table (`requested_category`/
  `category` stay free text, exactly as `businesses.category` already is).

## 4. Proposed New Tables

Exactly **five** tables, in dependency order:

1. `whatsapp_identities`
2. `conversations`
3. `conversation_messages`
4. `contributions`
5. `service_requests` (name is **provisional** — see Section 8)

Plus one additive column on `contributions`, added after `service_requests`
exists (Section 23): `contributions.related_service_request_id`.

## 5. Exact Columns for Every Proposed Table

### `whatsapp_identities`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigint identity` | no | PK |
| `phone_number` | `text` | no | E.164 format enforced at app layer |
| `profile_id` | `bigint` | **yes** | null until linked |
| `linked_at` | `timestamptz` | yes | set when `profile_id` is set |
| `created_at` | `timestamptz` | no | default `now()` |

### `conversations`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigint identity` | no | PK |
| `channel` | `text` | no | `whatsapp \| web \| admin \| system`, default `whatsapp` |
| `whatsapp_identity_id` | `bigint` | yes | null for non-WhatsApp channels |
| `profile_id` | `bigint` | yes | null until identity resolved |
| `community_id` | `bigint` | yes | references existing `communities.id` |
| `area` | `text` | yes | free text, optional (Section 3) |
| `status` | `text` | no | `open \| awaiting_agent \| resolved \| abandoned`, default `open` |
| `started_at` | `timestamptz` | no | default `now()` |
| `last_message_at` | `timestamptz` | no | default `now()` |

### `conversation_messages`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigint identity` | no | PK |
| `conversation_id` | `bigint` | no | FK |
| `channel` | `text` | no | same enum as `conversations.channel` |
| `direction` | `text` | no | `inbound \| outbound` |
| `sender` | `text` | no | `user \| ai_agent \| trust_agent \| system` |
| `content` | `text` | no | raw message text |
| `metadata` | `jsonb` | yes | e.g. media references (voice/photo/location URLs) — generic, no separate media table in migration 1 |
| `created_at` | `timestamptz` | no | default `now()` |

**Retention:** raw `content` is retained indefinitely in migration 1 — no
redaction/expiry job is specified. This is an explicit, open privacy
decision to revisit before any live WhatsApp connection, not resolved here
(Section 25).

### `contributions`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigint identity` | no | PK |
| `contributor_profile_id` | `bigint` | no | FK to `profiles.id` — provenance requires always knowing who |
| `category` | `text` | yes | e.g. "hairdresser", "plumbing" |
| `claim_text` | `text` | no | e.g. "I am a hairdresser.", "I know a plumber in Chinhoyi.", "This business moved." |
| `business_id` | `bigint` | yes | set when the subject is an existing `businesses` row |
| `provider_name` | `text` | yes | set when the subject is a person/provider not yet a `businesses` row |
| `community_id` | `bigint` | yes | FK to `communities.id` |
| `area` | `text` | yes | free text, optional |
| `source` | `text` | no | channel/source, mirrors `business_information_updates.source` |
| `relationship` | `text` | yes | contributor's relationship to the subject (e.g. "self", "customer", "referral") |
| `evidence_notes` | `text` | yes | mirrors `business_information_updates.evidence_notes` |
| `verification_status` | `text` | no | `verified \| observed \| declared \| inferred \| potential \| unknown`, default `declared` |
| `reviewed_by_profile_id` | `bigint` | yes | who reviewed it, if reviewed — AI must never populate this as "verified" itself |
| `reviewed_at` | `timestamptz` | yes | |
| `related_conversation_id` | `bigint` | yes | FK to `conversations.id` |
| `related_service_request_id` | `bigint` | yes | FK to `service_requests.id` — **added via `ALTER TABLE` after `service_requests` exists** (Section 23) |
| `created_at` | `timestamptz` | no | default `now()` |

**Relationship to `business_information_updates`:** that table is
**untouched** and remains the correct place for a literal field-correction
on an existing business (e.g. "the phone number is wrong"). `contributions`
is for everything that table cannot represent: self-declared capability,
an unnamed/unlisted recommended provider, or general local information not
tied to a specific business field.

### `service_requests` (provisional name — Section 8)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `bigint identity` | no | PK |
| `conversation_id` | `bigint` | yes | FK to `conversations.id` |
| `profile_id` | `bigint` | yes | FK to `profiles.id` |
| `community_id` | `bigint` | yes | FK to `communities.id` |
| `area` | `text` | yes | free text, optional |
| `requested_category` | `text` | yes | free text |
| `request_text` | `text` | no | |
| `intent` | `text` | yes | `find_business \| find_provider \| ask_question \| report_issue` |
| `status` | `text` | no | `open \| answered \| matched \| escalated_to_agent \| resolved \| unanswered`, default `open` |
| `matched_business_id` | `bigint` | yes | FK to `businesses.id` — the current best candidate, not a history table (Section 19) |
| `matched_contribution_id` | `bigint` | yes | FK to `contributions.id` — for a self-declared/recommended provider match |
| `created_at` | `timestamptz` | no | default `now()` |
| `resolved_at` | `timestamptz` | yes | |

**Note on "time to useful answer":** deliberately **not** stored as a
column. It is fully derivable as `resolved_at - created_at` at query time
(Section 20) — storing it redundantly was rejected per the instruction not
to create redundant metrics.

## 6. Primary Keys

Every table: single-column `id bigint identity` primary key, consistent
with the existing, VERIFIED `profiles.id` convention (bigint), rather than
introducing `uuid` primary keys inconsistently alongside it.

## 7. Foreign Keys

- `whatsapp_identities.profile_id` → `profiles.id` (`ON DELETE SET NULL`)
- `conversations.whatsapp_identity_id` → `whatsapp_identities.id` (`ON DELETE SET NULL`)
- `conversations.profile_id` → `profiles.id` (`ON DELETE SET NULL`)
- `conversations.community_id` → `communities.id` (`ON DELETE SET NULL`)
- `conversation_messages.conversation_id` → `conversations.id` (`ON DELETE CASCADE`)
- `contributions.contributor_profile_id` → `profiles.id` (`ON DELETE RESTRICT` — see Section 25 risk)
- `contributions.business_id` → `businesses.id` (`ON DELETE SET NULL`)
- `contributions.community_id` → `communities.id` (`ON DELETE SET NULL`)
- `contributions.reviewed_by_profile_id` → `profiles.id` (`ON DELETE SET NULL`)
- `contributions.related_conversation_id` → `conversations.id` (`ON DELETE SET NULL`)
- `contributions.related_service_request_id` → `service_requests.id` (`ON DELETE SET NULL`, added after `service_requests` exists)
- `service_requests.conversation_id` → `conversations.id` (`ON DELETE SET NULL`)
- `service_requests.profile_id` → `profiles.id` (`ON DELETE SET NULL`)
- `service_requests.community_id` → `communities.id` (`ON DELETE SET NULL`)
- `service_requests.matched_business_id` → `businesses.id` (`ON DELETE SET NULL`)
- `service_requests.matched_contribution_id` → `contributions.id` (`ON DELETE SET NULL`)

No foreign key references an existing table's column that isn't already
its primary key; no existing table gains a new foreign key pointing at a
new table (all new-table-to-existing-table references are outward only,
so existing tables are never altered — Section 24 risk noted regardless).

## 8. Unique Constraints

- `whatsapp_identities.phone_number` — `UNIQUE`.
- `whatsapp_identities.profile_id` — `UNIQUE` (allows multiple `NULL`s —
  i.e. multiple not-yet-linked identities — but at most one linked
  WhatsApp number per profile, enforcing "one person, one identity").

No other new table needs a unique constraint beyond its primary key for
migration 1.

## 9. Check Constraints

- `conversations.channel` / `conversation_messages.channel` ∈
  `('whatsapp','web','admin','system')`.
- `conversations.status` ∈ `('open','awaiting_agent','resolved','abandoned')`.
- `conversation_messages.direction` ∈ `('inbound','outbound')`.
- `conversation_messages.sender` ∈ `('user','ai_agent','trust_agent','system')`.
- `contributions.verification_status` ∈
  `('verified','observed','declared','inferred','potential','unknown')`.
- `service_requests.intent` ∈
  `('find_business','find_provider','ask_question','report_issue')` (or `NULL`).
- `service_requests.status` ∈
  `('open','answered','matched','escalated_to_agent','resolved','unanswered')`.

All enums are enforced via `CHECK`, not a separate lookup table — consistent
with "do not create a categories/lookup table" for migration 1.

## 10. Indexes

- `whatsapp_identities`: unique index on `phone_number` (from the UNIQUE
  constraint); index on `profile_id`.
- `conversations`: index on `profile_id`; index on `whatsapp_identity_id`;
  index on `community_id`; index on `status`.
- `conversation_messages`: index on `(conversation_id, created_at)` for
  ordered retrieval.
- `contributions`: index on `contributor_profile_id`; index on
  `business_id`; index on `community_id`; index on `verification_status`.
- `service_requests`: index on `profile_id`; index on `conversation_id`;
  index on `community_id`; index on `status`.

## 11. Relationships

```
auth.users ─ profiles (existing)
   ├─ whatsapp_identities (profile_id nullable until linked)
   │     └─ conversations (whatsapp_identity_id, profile_id nullable)
   │           └─ conversation_messages
   ├─ contributions (contributor_profile_id, optional business_id/community_id,
   │      optional related_conversation_id / related_service_request_id)
   └─ service_requests (profile_id nullable, conversation_id, community_id,
          optional matched_business_id / matched_contribution_id)
communities (existing) ── referenced by conversations, contributions, service_requests
businesses (existing) ── referenced by contributions.business_id,
                          service_requests.matched_business_id
```

## 12. RLS/Security Design (Conceptual — Not Applied)

Every proposed table: **RLS enabled**, default-deny, roles below. No policy
is created or applied by this document.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `whatsapp_identities` | `service_role` only (contains phone numbers — PII) | `service_role` only | `service_role` only | `service_role` only, expected rare |
| `conversations` | owning profile (`profiles.user_id = auth.uid()` via `profile_id`) or `service_role` | `service_role` only (server creates on inbound webhook) | `service_role` only | none |
| `conversation_messages` | owning profile (via parent conversation) or `service_role` | `service_role` only | none | none |
| `contributions` | contributor (`contributor_profile_id` = own profile) or `service_role`; broader public read of `verified` rows is a later decision, not migration 1 | authenticated user for their own `contributor_profile_id`, or `service_role` | `service_role` only (verification review) | none |
| `service_requests` | owning profile or `service_role` | authenticated user for their own `profile_id`, or `service_role` | `service_role` only (status transitions) | none |

All service-role operations must remain server-side only, following the
pattern already proven correctly in TrustHub's existing
`/api/admin/contributions` — never a client-side service-role key.

**Carried-forward critical findings (not remediated by this document or
any prior session):** `public.reviews` and `public.business_hours` have
RLS **disabled**. This remains an independent, required security task for
whoever owns the TrustHub database.

## 13. Identity-Linking Design

`whatsapp_identities` is the only new identity-related table.
`profile_id` is nullable specifically to represent **"not yet linked"** —
an inbound WhatsApp message can create a `whatsapp_identities` row (and
even start a `conversations` row referencing it) before identity
resolution completes. Once resolved (mechanism **not implemented here** —
depends on confirming Supabase Auth capabilities per
`docs/IMPLEMENTATION_PREREQUISITES.md` item 4), `profile_id` and
`linked_at` are set. `UNIQUE(profile_id)` enforces at most one linked
phone number per profile at the database level, directly enforcing
"one person, one TrustHub identity." No permanent, isolated WhatsApp-only
identity table is created — `whatsapp_identities` is a link, not an
identity store; the actual identity remains `profiles`.

## 14. Location/Community Design

`communities` (existing, currently zero rows) remains the sole city-level
entity — not modified. Area is represented as a plain nullable `text`
column on `conversations`/`contributions`/`service_requests` rather than a
new relational table (Section 3), preserving "city-wide participation when
area unknown" and "area-specific intelligence when known" without
introducing structure ahead of real data. Every new table that has a
locatable concept carries both `community_id` (FK) and `area` (text),
consistently.

## 15. Conversation Design

`conversations` owns the WhatsApp-or-other-channel session; `channel` is a
column, not a table split, so WhatsApp is one value among several rather
than baked into the architecture. Ownership is via nullable `profile_id`
(set once identity resolves) and `whatsapp_identity_id`. Community context
is carried directly on the conversation (`community_id`/`area`) so a
request or contribution created within it can inherit that context.
`conversation_messages` carries `direction`, `sender`, raw `content`, and
optional `metadata` (jsonb) for media references — no separate
voice/photo/location tables in migration 1. Retention: indefinite, flagged
as an open decision (Section 25).

## 16. Request Design

See Section 8 for the `help_requests`-vs-new-table decision. `status` uses
a single shared enum (matching `types/service-request.ts`'s
`SERVICE_REQUEST_STATUSES` already scaffolded in the codebase) so statuses
are never scattered as ad hoc strings elsewhere in the application.
`matched_business_id`/`matched_contribution_id` hold the *current* best
candidate only — not a history of every candidate considered (Section 19).

## 17. Contribution/Knowledge Design

A single `contributions` table (not a "giant universal knowledge graph")
covers self-declared capability, community-recommended providers, and
general local information — anything `business_information_updates`
cannot represent because it isn't a field-correction on an existing
business row. See the full column list (Section 5) and the
reuse-vs-new-table rule stated there.

## 18. People/Providers

**No new provider/capability table in migration 1.** A self-declared
capability ("I am a hairdresser") or a community-recommended provider ("I
know a plumber in Chinhoyi") is represented as a `contributions` row with
`provider_name` set and `business_id` null — not a separate structured
provider entity. A dedicated provider table is deferred until real volume
shows `contributions` rows repeatedly clustering around the same
unlisted provider (at which point promoting a cluster into a `businesses`
row, via the existing seeding/claim process, is the natural next step —
not a new parallel entity).

## 19. Matching/Outcome Design

No `matches`/match-history table in migration 1 — this was explicitly
**narrowed from the pre-migration blueprint**, which had not yet ruled
this out. Reason: the task's own design principle for migration 1 (Section
"DESIGN PRINCIPLE" in the source task) does not include matching in the
minimal loop, and a single current-candidate column pair
(`matched_business_id`/`matched_contribution_id`) on `service_requests` is
sufficient to prove "request → candidate → outcome" without a ranking or
history table. If multiple candidates need to be tried over time in a
future version, a `matches` table can be introduced then without
disrupting this design (the current columns simply become "the accepted
match" once that table exists).

Outcome states are represented by `service_requests.status`
(`open, answered, matched, escalated_to_agent, resolved, unanswered`).
**"AI replied" is never itself a status value** — `answered` requires an
application-level rule that a reply was substantive, and `resolved`
requires an explicit confirmation step (who can set it, and what "useful"
means, remain open product decisions — Section 25 — not resolved by the
schema alone). The schema supports the distinction; it does not itself
guarantee correct usage.

## 20. Analytics Derivation

All derivable from the tables above plus existing `profiles`/`businesses`
— **no separate analytics database**:

| Metric | Derivation |
|---|---|
| Total users | `count(profiles)` |
| Sign-ups (window) | `count(profiles where joined_at in window)` (existing column) |
| Active users (window) | `count(profiles where last_active_at in window)` (existing column) |
| WhatsApp conversations | `count(conversations where channel = 'whatsapp')` |
| Service requests | `count(service_requests)` |
| Problems solved | `count(service_requests where status = 'resolved')` |
| Unanswered requests | `count(service_requests where status = 'unanswered')` |
| Community contributions | `count(contributions) + count(business_information_updates in window)` |
| Businesses/services added | `count(businesses where created_at in window)` (existing) |
| Successful matches | `count(service_requests where matched_business_id is not null or matched_contribution_id is not null)` |
| Time to useful answer | `avg(resolved_at - created_at)` over resolved `service_requests`, computed at query time, never stored |
| Demand by country/city/area | `service_requests` grouped by `community_id` (joined to `communities` for country/city) and `area` |
| Knowledge gaps | **Approximate only** — heuristic query over `service_requests` (`status = 'unanswered'`, or repeated `requested_category` within a `community_id` with no `resolved` outcome). **Not a certainty** — a first-class `KnowledgeGap` record is deferred (Section 22) |
| Knowledge gaps resolved | Same caveat as above — approximate, not tracked explicitly |
| Outreach activity | **Cannot be calculated.** No outreach table/columns exist in migration 1 |
| Agent activity | **Cannot be calculated.** No Trust Agent table exists in migration 1 |

## 21. Notification Reuse

The existing `notifications` table remains the default delivery layer for
any future outreach/notification need. Migration 1 does **not** create any
outreach table (Section 22) and does not yet write to `notifications`
either — there is nothing in migration 1's scope that needs to notify
anyone (no agents, no outreach). This is deferred alongside outreach
itself, not implemented "just in case."

## 22. Deferred Features (Explicitly Not in Migration 1)

- `KnowledgeGap` as a first-class record — derived instead (Section 20).
- `CommunityOutreach`/`OutreachRecipient`/`OutreachResponse` — no persistent
  outreach table; reuse `notifications` when this is eventually built.
- `TrustAgent`/`AgentCoverage`/`AgentAvailability`/`AgentAssignment` — no
  agents exist yet to assign.
- A `matches`/match-history table — folded into `service_requests` columns
  (Section 19).
- A structured provider/capability table — folded into `contributions`
  (Section 18).
- A structured `community_areas` table — free-text `area` column instead
  (Section 3).
- Any admin role column/table on `admin_users`.
- Any categories/services lookup table.
- Any seed-pipeline table for the new (non-live) seed architecture.

## 23. Migration Order

1. `whatsapp_identities`
2. `conversations` (references `whatsapp_identities`, `profiles`, `communities`)
3. `conversation_messages` (references `conversations`)
4. `contributions` (references `profiles`, `businesses`, `communities`,
   `conversations` — **without** `related_service_request_id` yet)
5. `service_requests` (references `conversations`, `profiles`,
   `communities`, `businesses`, `contributions`)
6. `ALTER TABLE contributions ADD COLUMN related_service_request_id ...
   REFERENCES service_requests(id) ON DELETE SET NULL;`
7. Indexes (Section 10) — created alongside each table, or immediately
   after, per normal practice.
8. RLS enablement + policies (Section 12) — **not executed by this
   document**; applied only after this specification is explicitly
   approved for execution.

## 24. Rollback Considerations

Every new table is additive; no existing table is altered, so rollback
never touches `profiles`, `businesses`, `communities`, or any other
existing structure. Exact reverse order, because of the Section 23 step 6
cross-reference:

1. `ALTER TABLE contributions DROP COLUMN related_service_request_id;`
2. Drop `service_requests`.
3. Drop `contributions`.
4. Drop `conversation_messages`.
5. Drop `conversations`.
6. Drop `whatsapp_identities`.

No data migration/backfill is required for rollback since these are new,
empty tables at the point this specification would first be executed.

## 25. Remaining Risks

- **Identity provisioning (highest, unchanged from prior sessions):**
  `whatsapp_identities.profile_id` being nullable solves *linking*, not
  *provisioning* — creating a brand-new `profiles` row for a WhatsApp-first
  person with no email still depends on confirming Supabase Auth
  capabilities (`docs/IMPLEMENTATION_PREREQUISITES.md` item 4), which
  remains unresolved.
- **`help_requests` decision (Section 8):** proceeding with a new
  `service_requests` table before inspecting `help_requests` risks the
  exact duplication repeatedly ruled out — this specification treats it as
  provisional and names it as a required pre-execution check, not a final
  answer.
- **`contributions.contributor_profile_id ON DELETE RESTRICT`:** if a
  profile is ever deleted (e.g. a privacy/right-to-erasure request), this
  would block deletion rather than silently losing provenance — a
  deliberate tradeoff, but one that needs an explicit product decision
  before it is relied upon in production (e.g. an anonymization path
  instead of a hard delete).
- **Message retention (Section 5/15):** indefinite retention of raw
  `conversation_messages.content` is a privacy decision, not yet reviewed.
- **RLS-disabled `reviews`/`business_hours`:** independent, pre-existing
  critical finding, unaffected by and not fixed by this migration.
- **Free-text `area` now, structured area later:** if area-level demand
  grows quickly, migrating free text to a structured relation later will
  require a data-cleaning pass (normalizing existing free-text values) —
  an accepted future cost of choosing the smaller schema now.

## 26. Exact Items Requiring Final Approval Before Execution

1. Resolve the `help_requests` vs. new `service_requests` question by
   inspecting `help_requests`'s actual schema/RLS (Section 8) — may change
   table 5 in Section 4 into an `ALTER TABLE help_requests` instead.
2. Confirm Supabase Auth's real capability to provision a phone-only
   identity (identity-provisioning risk, Section 25) — does not block
   creating `whatsapp_identities` itself, but blocks it ever being
   populated by anything other than manual/admin linking.
3. Decide the `contributor_profile_id` deletion behavior (`RESTRICT` vs.
   an anonymization path) before this is relied on with real user data.
4. Decide the message-retention policy for `conversation_messages.content`.
5. Explicit sign-off on the exact RLS policies (Section 12 is conceptual
   only) before enabling RLS for real.
6. Explicit sign-off that the five tables above — and no others — are the
   correct migration 1 scope, per the Final Migration Checklist below.

No migration is implemented as a result of this document. Waiting for
explicit approval before any DDL is written or applied.

---

# FINAL MIGRATION CHECKLIST

## `whatsapp_identities`

- **Why does this table exist?** It is the only way to link a WhatsApp
  phone number to a TrustHub identity without guessing — nothing else in
  the schema stores a phone number tied to `profiles`.
- **Why can't an existing table handle it?** `profiles` has no phone
  column (VERIFIED); `auth.users` phone-column population depends on
  phone-auth being enabled, which is unverified.
- **Smallest possible schema?** 5 columns, 1 FK, 2 unique constraints.
- **What existing record does it reference?** `profiles.id`.
- **One-person-one-identity rule?** `UNIQUE(profile_id)` enforces at most
  one linked phone number per profile at the database level.
- **Country → city → area?** Not directly — it's identity-only; location
  lives on `conversations`/`service_requests`/`contributions`.
- **Community intelligence loop?** It's the entry point — nothing in the
  loop can start without resolving who is asking.
- **Future admin intelligence?** Enables "new sign-ups via WhatsApp" and
  "active users" segmentation by channel.
- **What breaks without it?** No way to recognize a returning WhatsApp
  user at all — every message would look like a stranger.

## `conversations`

- **Why does this table exist?** Nothing today records a WhatsApp (or any
  channel) session at all.
- **Why can't an existing table handle it?** No existing table has a
  channel/session concept; `help_requests`/`community_posts` are
  content records, not sessions.
- **Smallest possible schema?** 9 columns, 3 FKs, 1 status enum.
- **What existing record does it reference?** `profiles.id`,
  `communities.id`.
- **One-person-one-identity rule?** `profile_id` nullable until resolved,
  never a separate identity.
- **Country → city → area?** Carries `community_id` + `area` directly.
- **Community intelligence loop?** It's the container for ASK/RECORD.
- **Future admin intelligence?** "WhatsApp Conversations" metric, directly.
- **What breaks without it?** No way to group messages into a session, no
  way to attribute a request to a conversation.

## `conversation_messages`

- **Why does this table exist?** Individual message history is a
  different cardinality/lifecycle than the conversation itself.
- **Why can't an existing table handle it?** Nothing existing stores
  message-level history at all.
- **Smallest possible schema?** 7 columns, 1 FK, 3 enums.
- **What existing record does it reference?** Only via `conversations`.
- **One-person-one-identity rule?** Inherits from `conversations`; no
  identity concept of its own.
- **Country → city → area?** Inherits from `conversations`; not repeated.
- **Community intelligence loop?** Raw material for RECORD and for future
  AI interpretation/extraction.
- **Future admin intelligence?** "Recent Users"/activity feeds could read
  from this.
- **What breaks without it?** No transcript at all — conversations would
  be a status with no content.

## `contributions`

- **Why does this table exist?** `business_information_updates` cannot
  represent a self-declared capability or an unlisted recommended
  provider — it requires an existing `business_id` and a `field_name` on
  that business.
- **Why can't an existing table handle it?** Confirmed by inspecting
  `business_information_updates`'s columns (Section 17) — no subject-less
  or business-less contribution is representable there.
- **Smallest possible schema?** 15 columns, 5 FKs (one added post-creation),
  1 status enum — deliberately not split into capability/recommendation/
  general-info sub-tables.
- **What existing record does it reference?** `profiles.id`,
  `businesses.id`, `communities.id`.
- **One-person-one-identity rule?** `contributor_profile_id` always points
  at the one canonical profile — never a new identity.
- **Country → city → area?** Carries `community_id` + `area`.
- **Community intelligence loop?** It's CONTRIBUTE + STRUCTURE.
- **Future admin intelligence?** "Community Contributions",
  "Recent Contributions", "Useful Contributors" all read from here.
- **What breaks without it?** No way to capture "I am a hairdresser" or "I
  know a plumber" at all — the core "community fills the gaps" principle
  would have nowhere to persist.

## `service_requests` (provisional — Section 8/26 item 1)

- **Why does this table exist?** To track a specific ask through its
  lifecycle (open → resolved/unanswered) with timing and outcome — a
  need not evidenced as already met by any inspected existing table.
- **Why can't an existing table handle it?** `help_requests` might — this
  is explicitly **not resolved** here; this table is provisional pending
  inspection, and its own justification is conditional on that inspection
  confirming a gap.
- **Smallest possible schema?** 12 columns, 5 FKs, 2 enums — no separate
  match-history or metrics columns.
- **What existing record does it reference?** `profiles.id`,
  `communities.id`, `businesses.id`, `conversations.id`,
  `contributions.id`.
- **One-person-one-identity rule?** `profile_id` always the one canonical
  profile.
- **Country → city → area?** Carries `community_id` + `area`.
- **Community intelligence loop?** It's SEARCH → ANSWER/GAP → OUTCOME.
- **Future admin intelligence?** "Service Requests," "Problems Solved,"
  "Unanswered Requests," "Time to Useful Answer," "Successful Matches" all
  read from here.
- **What breaks without it (or without resolving Section 8 first)?** No
  way to measure "problem solved" or "time to useful answer" at all if
  deferred entirely; but if `help_requests` already does this job, keeping
  both would itself violate the no-duplication rule — hence this is
  flagged conditional, not unconditionally approved.

## Tables Considered and Rejected for Migration 1

- **`community_areas`** — rejected for now; free-text `area` column
  suffices until real data volume justifies normalizing (Section 3).
- **`KnowledgeGap`** — rejected for now; fully derivable from
  `service_requests` (Section 20), even if only approximately.
- **`CommunityOutreach` / `OutreachRecipient` / `OutreachResponse`** —
  rejected for now; no agents/recipients exist yet to make outreach
  meaningful, and `notifications` remains ready to reuse when it is.
- **`TrustAgent` / `AgentCoverage` / `AgentAvailability` /
  `AgentAssignment`** — rejected for now; nothing to assign yet.
- **`matches` (history table)** — rejected for now; a single
  current-candidate pair of columns on `service_requests` proves the loop
  without a ranking/history table (Section 19).
- **Structured provider/capability table** — rejected for now; folded into
  `contributions` (Section 18).
- **`admin_users` role column** — rejected for now; not required until
  `/admin` gets real authorization wiring, which is out of scope here.
