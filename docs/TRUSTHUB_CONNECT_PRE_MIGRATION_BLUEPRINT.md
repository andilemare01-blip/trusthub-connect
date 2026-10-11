# TrustHub Connect — Pre-Migration Blueprint

Final pre-migration design pass. This document proposes a schema — it does
**not** create, modify, or connect any database. No SQL was executed, no
migration file was written or applied, no table was created, no RLS/Auth
setting was changed, and no credential was added while producing this
document. Sources: `TRUSTHUB_CONNECT_RECON.md`,
`docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md`,
`docs/IMPLEMENTATION_PREREQUISITES.md`,
`docs/TRUSTHUB_CONNECT_FOUNDATION.md`, and the newly-verified live database
facts supplied in this task.

---

## 1. Verified Live Database Facts

Project: **Trusthub**, ref `bygtmzwsmwsibtruzbcc`.

Existing structures confirmed to exist (beyond what earlier sessions found):
`auth.users`, `profiles`, `businesses`, `reviews`, `review_helpfulness`,
`business_hours`, `business_claims`, `business_information_updates`,
`business_owners`, `admin_users`, `notifications`, `communities`,
`community_members`, `community_posts`, `post_comments`, `post_reactions`,
`help_requests`, `community_seed_locks`, `google_seed_usage`,
`trusted_contacts`, `sos_alerts`, trust-battle structures, `feedback`.

- `profiles`: `id, created_at, name, location, language, intro,
  profile_image, trust_level, reviews, businesses_added, joined_at,
  user_id, trust_points, last_active_at`. `user_id` is **UNIQUE** and
  references the TrustHub Auth identity.
- `businesses`: includes `country, city, area, community_key, latitude,
  longitude, category, subcategory, phone, website, trust_score,
  reviews_count, source, source_id`, with a **UNIQUE constraint on
  `(source, source_id)`**.
- `communities`: `id, name, city, country, description, latitude,
  longitude, created_at`. **Currently zero rows. No `area` column.** This
  is a city/community entity only, not an area-level one.
- `notifications`: `user_id, type, title, message, entity_type, entity_id,
  metadata, dedupe_key, read_at, created_at`. `dedupe_key` is **UNIQUE**.
- `business_information_updates`: `business_id, user_id, field_name,
  suggested_value, status, business_name, source, evidence_notes,
  created_at`.
- `admin_users`: `user_id, created_at`. **No role column.**
- Auth identities today are **email-based**; WhatsApp/phone Auth is **not**
  confirmed enabled.
- No category/service lookup table found.
- Approximate row counts: `profiles` ~15, `businesses` ~378, `reviews` ~10,
  `notifications` ~145, `communities` 0, `community_members` 0,
  `help_requests` 0.
- Live business coverage is concentrated in **Harare and Chiredzi**; there
  is **no meaningful Chinhoyi coverage** yet.

**CRITICAL SECURITY FACTS (unchanged, not remediated here):** RLS is
**disabled** on `public.reviews` and `public.business_hours`. Additional
advisories reported: SECURITY DEFINER functions callable by
anon/authenticated roles; `community_seed_locks` and `google_seed_usage`
have RLS **enabled with no policies** (meaning, in practice, likely
default-deny for those roles — the exact effect still needs confirmation);
other function security warnings exist. **None of these were touched.**
They are security tasks for whoever owns the TrustHub database, tracked
here and in `docs/IMPLEMENTATION_PREREQUISITES.md`.

## 2. Existing Structures to Reuse

| Need | Reuse | Notes |
|---|---|---|
| Identity | `profiles` + `auth.users` | Canonical, unchanged |
| City/community entity | `communities` | Zero rows today — TrustHub Connect should populate rows here for Harare/Chinhoyi, not build a second table |
| Community activity | `community_members`, `community_posts`, `post_comments`, `post_reactions` | Schema still unverified at column level; inspect before writing to them |
| Business discovery | `businesses`, `reviews`, `review_helpfulness`, `business_hours` | Read-only reuse; note the two RLS-disabled tables |
| Business ownership | `business_owners`, `business_claims` | Schema not yet inspected; do not assume shape |
| Contribution/evidence pattern | `business_information_updates` | Proven working pattern to extend, not replace |
| Outreach delivery | `notifications` (`dedupe_key` UNIQUE already gives built-in dedupe) | Reuse for outreach delivery, per Section 9 |
| Admin allow-list pattern | `admin_users` | No role column — extend, don't replace |
| Seeding coordination | `community_seed_locks`, `google_seed_usage` | Reuse if TrustHub Connect's new seed pipeline (Section 12) ever needs coordination locks, rather than inventing a new lock table |
| Emergency/safety features | `trusted_contacts`, `sos_alerts` | Belong to TrustHub SOS's domain — **out of scope**, not touched, not duplicated |
| Gamification | trust-battle structures | Out of scope for TrustHub Connect; not touched |
| General feedback | `feedback` | Existing generic feedback channel — inspect before assuming TrustHub Connect needs a separate one |

## 3. New Persistent Structures Eventually Required

None are created in this task. Eventually required, pending approval
(Section 17 proposes only the minimal first slice):

- WhatsApp identity link (phone number ↔ `profiles.id`)
- Area subdivision beneath a `communities` row (Section 6)
- Conversations + conversation messages
- Service requests (pending Section 8's reconciliation with `help_requests`)
- Knowledge items/claims + evidence (generalizing
  `business_information_updates`'s pattern, Section 7)
- Knowledge gaps + outreach records (Sections 7, 9)
- Trust Agent + coverage/assignment records (Section 10)
- Match results (Section 11)
- Launch/coverage tracking (Section 13)

## 4. Structures That Must NOT Be Duplicated

- A second `communities`/city table — use the existing one (currently
  empty; populate it, don't replace it).
- A second business table — `businesses` remains canonical; TrustHub
  Connect's new seed pipeline (Section 12) must dedupe against the
  existing `(source, source_id)` unique constraint, not create a parallel
  business store.
- A second notification/delivery table — reuse `notifications`.
- A second admin allow-list — extend `admin_users`, don't replace it.
- A second business-information-update/contribution review table — extend
  `business_information_updates`'s pattern, or clearly justify a new table
  only for genuinely new contribution types it cannot represent.
- `trusted_contacts`/`sos_alerts`/trust-battle structures — these belong to
  TrustHub's existing safety/gamification features and are explicitly
  **out of scope**; TrustHub Connect must not reinterpret or extend them.

## 5. Identity Relationships

```
auth.users (existing, email-based today)
   └─ profiles (existing, user_id UNIQUE)
        └─ [proposed, first migration] whatsapp_identities
             (phone_number UNIQUE, profile_id → profiles.id)
```

Canonical identity remains `profiles`. A WhatsApp identity is only a
mapping row, never a parallel identity store. **Not resolved:** the exact
provisioning mechanism for a WhatsApp-first person with no existing
`auth.users`/`profiles` row — Auth is confirmed email-based today, and
whether phone-based provisioning (e.g. via the Supabase Admin API) is
possible has **not** been verified. This must not be guessed; see Section
20.

## 6. Country → City → Area Model

Keep **country → city → area**; area remains optional. The existing
`communities` table is the canonical **city/community** entity (it has no
`area` column and currently zero rows). Since it cannot represent area
directly, an area layer must live in a **separate table referencing
`communities.id`** rather than adding an `area` column to `communities` —
this keeps the existing table's shape untouched and reusable as-is.

Proposed (not created) relationship:

```
communities (existing table — id, name, city, country, description,
             latitude, longitude, created_at)
   └─ [proposed] community_areas (id, community_id → communities.id, name, created_at)
```

A person/business with no known area still fully participates by
referencing only `communities.id`. `businesses.area` (already a plain text
column) and the new `community_areas` table are not automatically the same
thing — reconciling free-text `businesses.area` values against structured
`community_areas` rows is an open design question (see Section 20), not
resolved here.

## 7. Knowledge-Gap/Outreach Model

Generalizes `business_information_updates`'s proven field/value/source/
evidence/status pattern (`KnowledgeItem`/`KnowledgeClaim`/`Evidence`/
`Provenance`/`VerificationStatus` in `types/knowledge.ts` and
`types/provenance.ts`, states: `verified, observed, declared, inferred,
potential, unknown`). A `KnowledgeGap` is detected from repeated
questions/requests, unanswered requests, missing businesses/providers/
categories/area information, or repeated escalation to a human. Outreach
(`CommunityOutreach` → `OutreachRecipient` → `OutreachResponse`, governed by
an `OutreachPolicy`) must be opt-in aware, frequency-controlled,
deduplicated, and auditable — and should deliver through the existing
`notifications` table (whose `dedupe_key` UNIQUE constraint already
provides a real deduplication primitive to build on, not reinvent).

## 8. Service-Request Relationship with Existing `help_requests`

**This must be documented before migration, per explicit instruction, and
is intentionally left as an open decision rather than guessed:**

`help_requests` currently has **zero rows**, so its real-world usage
pattern cannot be inferred from data — only from its (still largely
unverified) schema. Two possibilities, neither confirmed:

1. `help_requests` already represents exactly what TrustHub Connect calls
   a "service request" (a community member asking for help/a
   service) — in which case TrustHub Connect should **extend** it (new
   columns for `conversation_id`, `intent`, `time_to_useful_answer`, etc.)
   rather than create a competing `service_requests` table.
2. `help_requests` represents a different, narrower existing workflow
   (e.g. tied to `community_posts`/`community_members` social features)
   that is not a good fit for WhatsApp-originated, AI-classified,
   agent-escalatable requests — in which case a new `service_requests`
   table is justified, but should still reference `help_requests` where
   semantically related rather than ignore it.

**Decision required before migration:** inspect `help_requests`'s full
column list, constraints, and any RLS policy, and decide 1 vs. 2 above.
This blueprint does not choose one — see Section 17 (first migration
scope) and Section 20 (remaining decisions).

## 9. Notification Reuse

Outreach delivery should use the existing `notifications` table
(`user_id, type, title, message, entity_type, entity_id, metadata,
dedupe_key [UNIQUE], read_at, created_at`) rather than a new delivery
mechanism. A `type` value (e.g. `"community_outreach"`) plus `entity_type`/
`entity_id` pointing at the outreach record, and a deterministic
`dedupe_key` derived from `(recipient, knowledge_gap_id)`, is sufficient to
represent an outreach notification without new columns — this should be
validated against the notifications table's actual RLS/policy state
(currently unverified) before implementation.

## 10. Trust Agent Model

Trust Agents (`types/agent.ts`) are operational people, explicitly distinct
from TrustHub's existing `referral_partners` (marketing referrals — not
relisted here, unchanged from earlier sessions). Each Trust Agent links to
an existing `profiles` row (never a new identity), and carries community/
category coverage (`AgentCoverage`), availability (`AgentAvailability`),
and request assignments (`AgentAssignment`). `admin_users` is not modified
by this model — whether an agent's authorization comes from `admin_users`
(extended with a role) or a separate table is an open decision (Section
20), shared with the OWNER/TRUST_AGENT admin model (Section 15).

## 11. Matching Model

`MatchCandidate`/`MatchCriteria`/`MatchResult` (`types/matching.ts`). MVP
matching is deterministic/rule-based using category, country, city,
area/community, agent coverage, availability, and existing TrustHub trust
signals (e.g. `businesses.trust_score`) where appropriate. No ML ranking.
No scoring formula is finalized here — it depends on real usage data that
does not exist yet (`communities`/`help_requests` are currently empty).

## 12. Seed/Discovery Model

A **new, separate, non-live** pipeline (`types/seed.ts`, `lib/seed/*`),
explicitly not replacing TrustHub's existing seeding pipeline yet.
Pipeline: `SOURCE → EXTRACT → NORMALIZE → COUNTRY/CITY/AREA → CATEGORY →
DEDUPLICATE → PROVENANCE → QUALITY CHECK → TRUSTHUB`. Deduplication must
respect the existing `businesses (source, source_id)` UNIQUE constraint —
this is the real, live dedupe key already in production, not a new
invention. Initial source categories: Overture, OpenStreetMap, permitted
official/public sources, community contributions, manual/admin additions.
No arbitrary scraping; no source is connected in this task. Coordination
locks, if needed, should reuse `community_seed_locks`/`google_seed_usage`
rather than inventing new lock tables — pending confirming those tables'
actual columns and current RLS-enabled-no-policy state (Section 1) is safe
to build on.

## 13. Launch-Readiness Model

`LaunchCommunity` (`pre_launch, building_coverage, ready, active, paused`),
`KnowledgeCoverage`/`CoverageCategory`, `LaunchReadiness`
(`types/launch.ts`). First rollout focus: **Harare, Chinhoyi**. Live data
confirms this is not cosmetic — Chinhoyi currently has **no meaningful
business coverage**, so `BUILDING_COVERAGE` is its accurate real status
today, not a hypothetical state. The same mechanism (referencing
`communities.id`) must work for future communities without a new database
or project per city — consistent with the existing single-Supabase-project
approach.

## 14. Analytics Model

`MetricDefinition`, `AnalyticsQuery`, `CommunityMetric`, `DemandMetric`,
`OutcomeMetric` (`types/analytics.ts`). Covers: users, sign-ups, active
users, WhatsApp conversations, requests, problems solved, unanswered
requests, contributions, businesses/services added, successful matches,
time to useful answer, demand by country/city/area, knowledge gaps,
outreach activity, knowledge gaps resolved, agent activity, launch
coverage. MVP metrics derive from operational records (`profiles`,
`businesses`, the proposed `service_requests`/`conversations`/knowledge
tables) — no separate analytics database.

## 15. Admin Model

Existing `/admin` UI skeleton preserved, not redesigned. Data contracts
prepared for: OVERVIEW, COMMUNITY INTELLIGENCE, KNOWLEDGE RECOVERY,
NETWORK, LAUNCH READINESS (matching `docs/TRUSTHUB_CONNECT_FOUNDATION.md`
section S). Eventually only `OWNER`/`TRUST_AGENT` may access privileged
information, enforced **server-side** — `admin_users` still has no role
column (VERIFIED again this session), so this requires a new column or
table either way. **Auth is not implemented in this task.**

## 16. Security/RLS Requirements

- `reviews` and `business_hours` RLS-disabled finding: **not remediated**,
  carried forward as a required, independent security task.
- SECURITY DEFINER functions callable by anon/authenticated roles: **not
  modified**; must be reviewed by whoever owns the database before any
  TrustHub Connect table relies on similar patterns.
- `community_seed_locks`/`google_seed_usage` RLS-enabled-without-policies:
  **not modified**; effective behavior (likely default-deny) should be
  confirmed, not assumed, before TrustHub Connect's new seed pipeline
  depends on them.
- Every new table proposed in Section 17 must ship with an explicit
  default-deny RLS policy proposal at actual migration time — not
  included as executable policy here, since no migration is being written.
- Service-role-key operations must remain server-side only, following the
  pattern already proven correctly in TrustHub's
  `/api/admin/contributions`.

## 17. Exact First Migration Scope (PROPOSED — NOT EXECUTED)

Smallest slice needed to prove: **WhatsApp user → persistent TrustHub
identity → community → conversation → service request →
contribution/knowledge → outcome → dashboard visibility.** Before
proposing new tables, existing tables were checked for reuse per Section
2 — `communities` (reuse, populate), `notifications` (reuse for
outreach/outcome-visible notifications), `business_information_updates`
(reuse pattern for contributions where the subject is a business).

Proposed new tables (names/columns only — **not DDL, not applied**):

1. **`whatsapp_identities`** — `id, phone_number (unique), profile_id →
   profiles.id, linked_at, created_at`. Smallest possible identity-linking
   seam; provisioning mechanism for brand-new profiles still depends on
   Section 20's open Auth-capability question.
2. **`community_areas`** — `id, community_id → communities.id, name,
   created_at`. Enables the area layer beneath the existing, currently
   empty `communities` table without touching its shape.
3. **`conversations`** — `id, channel, whatsapp_identity_id →
   whatsapp_identities.id, profile_id → profiles.id (nullable until
   resolved), community_id → communities.id (nullable), status, started_at,
   last_message_at`.
4. **`conversation_messages`** — `id, conversation_id →
   conversations.id, channel, direction, sender, text, created_at`.
5. **`service_requests`** — **contingent on Section 8's decision.** If
   `help_requests` is reused (option 1), this migration instead proposes
   *additive columns* on `help_requests` (`conversation_id`, `intent`,
   `resolved_at`, `time_to_useful_answer_seconds`) rather than a new table.
   If a new table is justified (option 2): `id, conversation_id →
   conversations.id, profile_id → profiles.id, community_id →
   communities.id, requested_category, request_text, intent, status,
   created_at, resolved_at, time_to_useful_answer_seconds`.
6. **`knowledge_contributions`** — the minimal evidence/outcome record
   needed for dashboard visibility: `id, profile_id → profiles.id,
   service_request_id → service_requests.id (nullable), business_id →
   businesses.id (nullable), field_name, suggested_value, source,
   evidence_notes, status, created_at` — deliberately shaped like
   `business_information_updates` so it can converge with it later rather
   than diverge from day one.

**Explicitly excluded from this first migration** (see Section 18):
knowledge gaps, outreach, Trust Agents, matching, launch-coverage tracking,
analytics tables, admin roles. Dashboard visibility for the first
migration means: counts/aggregates computed directly from the six tables
above (plus existing `profiles`/`businesses`), not a dedicated analytics
schema.

## 18. Structures That Should NOT Be Part of the First Migration

- `KnowledgeGap`/`CommunityOutreach`/`OutreachRecipient`/`OutreachResponse`
  — the loop's later stages; not needed to prove the minimal end-to-end
  path, and outreach depends on `notifications` policy confirmation first.
- `TrustAgent`/`AgentCoverage`/`AgentAvailability`/`AgentAssignment` — no
  agents exist yet to assign; premature before the OWNER/TRUST_AGENT role
  storage decision (Section 15/20).
- `MatchResult`/match scoring — no request volume yet to match against.
- `LaunchCommunity`/`KnowledgeCoverage`/`LaunchReadiness` tables — can be
  computed as read-only aggregates over the first-migration tables plus
  `businesses`/`communities` instead of new tables, at least initially.
- Any new categories/services lookup table — not proven necessary yet;
  `requested_category` stays free text in the first migration.
- Any seed-pipeline table (new `businesses` shape, provenance ledger) —
  the new seed architecture (Section 12) is validated against Chinhoyi
  before any of its own tables are proposed.
- Any admin-role column/table — deferred until the OWNER/TRUST_AGENT
  decision (Section 20) is made explicitly, not bundled in as a side
  effect of this migration.

## 19. Risks

- **Identity provisioning risk (highest):** if Supabase Auth cannot create
  a `profiles`-linked identity without email/password, `whatsapp_identities`
  alone cannot fulfill "same person, same identity" for a brand-new
  WhatsApp-first user — this could force a fundamentally different Section
  17 design. Must be resolved before, not during, migration.
- **`help_requests` ambiguity:** building `service_requests` without first
  inspecting `help_requests` risks exactly the duplication the project
  owner has repeatedly ruled out.
- **RLS-disabled tables:** `reviews`/`business_hours` remain an active
  security gap independent of this work; TrustHub Connect must not read
  from or write to them in a way that assumes protection that isn't there.
- **Empty tables mean untested assumptions:** `communities` and
  `help_requests` having zero rows means their *intended* usage can only be
  inferred from schema, not observed from real data — schema-level
  inspection is necessary but may still miss intended application-level
  semantics.
- **Chinhoyi coverage gap:** launching Chinhoyi outreach/matching before
  business coverage exists there would produce a poor first impression —
  reinforces why launch-readiness gating (Section 13) matters before
  distribution, not just before migration.

## 20. Remaining Decisions

1. Whether Supabase Auth can provision a `profiles`-linked identity for a
   phone-only, WhatsApp-first person (blocks `whatsapp_identities`'
   provisioning path — `docs/IMPLEMENTATION_PREREQUISITES.md` item 4).
2. `help_requests` vs. new `service_requests` (Section 8) — requires
   inspecting `help_requests`'s full schema and RLS first.
3. Whether `community_areas` (proposed) should also absorb/reconcile
   `businesses.area`'s existing free-text values, or the two remain
   independent for now.
4. OWNER/TRUST_AGENT role storage mechanism (extend `admin_users` vs. new
   table) — shared with the Trust Agent model (Section 10).
5. Whether `feedback` (existing, general-purpose) already covers any part
   of TrustHub Connect's contribution/outreach-response needs.
6. Actual RLS policy content (not just enabled/disabled status) for every
   table this migration would reference, plus the real effect of
   `community_seed_locks`/`google_seed_usage`'s RLS-enabled-no-policy
   state — needed before the proposed tables' own RLS policies can be
   written responsibly.

No migration is implemented as a result of this document. Waiting for
explicit approval before any DDL is written or applied.
