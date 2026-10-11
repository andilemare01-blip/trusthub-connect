# TrustHub Connect — Architecture Plan

This document is the architecture-level companion to
`TRUSTHUB_CONNECT_RECON.md`. It does not create, modify, or connect any
database, credential, or external service. It exists to turn confirmed facts
and the project owner's stated product requirements into a single reviewable
plan before any schema or live integration work begins.

**Sources used for this document:**

1. `TRUSTHUB_CONNECT_RECON.md` — evidence directly inspected from the
   existing TrustHub codebase at `C:\Users\inahm\trusthub`. Cited below as
   **RECON**.
2. The TrustHub WhatsApp-first Community Intelligence product requirements
   and case-study context, as given directly by the project owner across
   this conversation (the original TrustHub Connect brief, the admin
   dashboard metric list, the persistent-identity requirement, the data
   intelligence principle, and the security requirement restated in this
   task). Cited below as **OWNER BRIEF**. This is treated as authoritative
   product context even though it has not been saved as a single standalone
   file in the repository.
3. A read-only live inspection of the existing TrustHub Supabase project
   (project "Trusthub", ref `bygtmzwsmwsibtruzbcc`), reported directly by
   the project owner in this task. Cited below as **LIVE DB (verified
   read-only, no changes made)**. Where a **LIVE DB** fact contradicts an
   earlier **RECON** inference (which was necessarily limited to what
   application code queries), the **LIVE DB** fact supersedes it — this is
   noted explicitly at each such point below.

Every claim below is tagged:

- **CONFIRMED** — directly verified from RECON, LIVE DB, or existing,
  inspected code.
- **PROPOSED** — recommended architecture for TrustHub Connect; not yet
  built, not yet approved as final.
- **UNKNOWN** — not verified; must be confirmed before any database or
  schema implementation.

No section below authorizes implementation. Where a **PROPOSED** shape looks
like a table, it is a design sketch for review, not a migration.

---

## 1. Existing TrustHub Architecture

**CONFIRMED** (RECON section A):
- Next.js App Router project (`src/app`), TypeScript, Tailwind CSS, npm.
- Client-side Supabase usage is the dominant pattern: a single browser
  client in `src/lib/supabase.ts` using `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- A small number of server-side API routes exist under `src/app/api/`
  (e.g. `admin/contributions`) that use the service-role key correctly,
  validating the caller's bearer token before any privileged query.
- No `middleware.ts` — all route protection today is done ad hoc, per page,
  client-side.
- No SQL migrations or RLS policy files exist in the repository — the
  database's actual constraints/policies are **UNKNOWN** beyond what
  application code implies.
- No WhatsApp SDK and no AI provider SDK are present in `package.json`.

## 2. What Connect Reuses from TrustHub

**VERIFIED (LIVE DB)** — project "Trusthub" (ref `bygtmzwsmwsibtruzbcc`) is
the one, single existing Supabase project. It is substantially richer than
RECON's code-only inference suggested — it already contains, in addition to
everything RECON found:
- A real `public.communities` table (RECON incorrectly inferred, from code
  alone, that no such table existed — see Section 5, this is now corrected).
- Related community tables: `community_members`, `community_posts`,
  `post_comments`, `post_reactions`, `help_requests`.
- `public.notifications` (confirms RECON's "UNKNOWN-but-likely" table name).
- `public.community_seed_locks` (confirms RECON's unnamed seed-lock table).

**CONFIRMED** (RECON section H, still accurate) — safe to plan around, not
yet connected:
- Supabase Auth + the `profiles` table as the identity anchor.
- `businesses`, `reviews`, `review_helpfulness`, `business_hours` as
  read-only discovery/reputation data.
- `business_information_updates` as the existing provenance/evidence
  submission pattern (field, suggested value, source, evidence notes,
  status) — the template to extend, not replace, for future community
  contributions and evidence tracking.
- `admin_users` allow-list pattern as the template for future OWNER/
  TRUST_AGENT authorization (server-side verified, not client-side only).

**PROPOSED:**
- TrustHub Connect should treat TrustHub's Supabase project as the single
  source of truth for identity, businesses, and reviews. TrustHub Connect
  should not maintain a parallel copy of this data — only new,
  WhatsApp/agent-specific structures that don't already exist.
- All reads/writes to reused TrustHub data should go through the
  `TrustHubClient` interface (`lib/trusthub`) already scaffolded, so the
  real implementation can be swapped in later behind one seam.
- Before designing `ServiceRequest` (Section 9) or "community questions"
  (Section 12), the existing `help_requests`, `community_posts`,
  `post_comments`, and `post_reactions` tables must be inspected in full —
  they may already implement some or all of what TrustHub Connect would
  otherwise duplicate.

**APPROVED (see APPROVED ARCHITECTURE DECISIONS):**
- TrustHub Connect runs as a separate codebase against this *same* Supabase
  project (not a second project, not a fully separate API-only system).
  This resolves the previous UNKNOWN in this section.

**UNKNOWN:**
- Exact column-level schema of `communities`, `community_members`,
  `community_posts`, `post_comments`, `post_reactions`, and `help_requests`
  — only their existence has been verified so far, not their columns.
  Required before deciding what, if anything, TrustHub Connect still needs
  to add (see `docs/IMPLEMENTATION_PREREQUISITES.md`).

## 3. Persistent TrustHub Identity

**OWNER BRIEF (persistent identity requirement, restated in this task):**
> A person who first contacts TrustHub through WhatsApp must ultimately be
> able to use the SAME TrustHub identity/profile on the existing TrustHub
> website/app. Do not design a permanent isolated WhatsApp-user database.

**VERIFIED (LIVE DB)** — full `profiles` column list: `id` (bigint, primary
key), `user_id` (uuid, **unique**), `name`, `location`, `language`,
`intro`, `profile_image`, `trust_level`, `reviews`, `businesses_added`,
`joined_at`, `trust_points`, `last_active_at`. This resolves
`docs/IMPLEMENTATION_PREREQUISITES.md` item 1 for column *names* and
confirms `user_id` is unique (supporting one-profile-per-auth-user).
No phone-number column exists on `profiles`.

**CONFIRMED** (RECON section C):
- Today, TrustHub identity = a Supabase Auth user + a `profiles` row,
  created via email/password sign-up. There is no phone-number-based
  identity path today.
- A non-trivial amount of "current profile" state (home community, cached
  review/business counts) lives only in browser `localStorage`, not the
  database — this is not a pattern TrustHub Connect should copy, since a
  WhatsApp user has no browser storage.

**PROPOSED:**
- `profiles` remains the single, canonical identity table. TrustHub Connect
  must never create a second, independent "WhatsApp user" table that stands
  in for identity — only a *link* between a phone number and an existing or
  newly created `profiles` row (see Section 4).
- Identity resolution flow (conceptual, not final):
  1. Inbound WhatsApp message arrives with a phone number.
  2. TrustHub Connect looks up whether that phone number is already linked
     to a `profiles` row.
  3. If linked → resume as that identity.
  4. If not linked → check whether a matching TrustHub account already
     exists by some agreed signal (**UNKNOWN what signal — see Section 4**);
     if not, create a minimal `profiles` row through the same path
     TrustHub's own sign-up would use (not a shadow table), then link it.
  5. If the same person later logs into the TrustHub website with email/
     password, they see the same `profiles` row — because it always was the
     same row, never a WhatsApp-only copy.

**UNKNOWN:**
- Whether `profiles` can be created without a corresponding Supabase Auth
  user (today's sign-up flow always creates an Auth user first). If Auth
  requires a password/email, a WhatsApp-first sign-up may need a different,
  approved provisioning method (e.g. Supabase Admin API to create a user
  with just a phone number) — this is a real architectural decision, not a
  detail, and must be confirmed before implementation.

## 4. WhatsApp Identity Mapping

**VERIFIED (LIVE DB):** There is currently no dedicated WhatsApp identity
table in the live database. This directly confirms RECON section I's
inference — no correction needed here.

**CONFIRMED:** No such mapping exists anywhere in TrustHub today (RECON
section I). The closest existing artifact is an ad hoc `whatsapp` text field
on `business_claims`, unrelated to end-user identity.

**PROPOSED** (design sketch only, not a migration):
- A new link entity conceptually shaped like `types/identity.ts`'s
  `WhatsAppIdentity` already scaffolded in code:
  `{ id, phoneNumber, trustHubProfileId, linkedAt, createdAt }`.
- One phone number maps to at most one `profiles` row. One `profiles` row
  may (eventually) have at most one linked phone number, to keep the
  "same person, same identity" rule simple and enforceable.
- The phone number itself, once linked, becomes a stable additional login
  signal — but *changing* how someone logs into the existing TrustHub web
  app is out of scope for TrustHub Connect and must not be assumed.

**UNKNOWN — must be confirmed before implementation:**
- How to safely match an inbound WhatsApp phone number to an *existing*
  TrustHub profile that signed up by email (no phone number is collected
  today at sign-up). Without a shared identifier, every WhatsApp contact
  looks "new" even if the same person already has a TrustHub account. This
  is the single biggest open identity risk and blocks Section 3 step 4
  above.
- Whether TrustHub is willing to start collecting phone number at
  email-based sign-up (so future cross-matching is possible), or whether
  matching must rely on a manual/explicit "link my WhatsApp" action
  initiated by the user from an authenticated session.

## 5. Community and Location

**VERIFIED (LIVE DB) — CORRECTS AN EARLIER RECON/ARCHITECTURE-PLAN
STATEMENT:** A real `public.communities` table **already exists**, along
with `community_members`, `community_posts`, `post_comments`,
`post_reactions`, and `help_requests`. RECON section E's statement that "no
persisted `communities` table exists" was based only on static code
inspection (no code path in the inspected TrustHub app queries these
tables) and is now superseded by this live finding for the *existence*
question. RECON's underlying observation — that the derived, client-side
`communityKey` (`country:city:area`) is what the *inspected application
code* actually uses today — remains accurate; it simply means the live
database has community infrastructure that the inspected frontend code does
not yet visibly consume.

**UNKNOWN:** The exact column-level schema of `communities`,
`community_members`, `community_posts`, `post_comments`, `post_reactions`,
and `help_requests`. Only table *names* have been verified so far. This
must be inspected before TrustHub Connect designs anything that could
duplicate them (see `docs/IMPLEMENTATION_PREREQUISITES.md`).

**VERIFIED (LIVE DB):** `businesses` already has `country`, `city`, `area`,
`community_key`, `latitude`, `longitude` columns (Section 6). This confirms
the `country:city:area` convention is already reflected in live data, not
just derived client-side.

**OWNER BRIEF:** initial rollout focuses on Harare and Chinhoyi; the admin
dashboard must show demand/growth "by city/community" to support future
distribution decisions. Keep the **country → city → area** hierarchy —
do not simplify to country + city only. `area` must be allowed to remain
unknown; users must still be able to participate at city/community level
without one.

**PROPOSED (updated for the location-hierarchy requirement):**
- Do not build a new, competing community table — first determine (via the
  schema inspection above) whether the existing `communities` /
  `community_members` tables already satisfy TrustHub Connect's needs
  (rollout status, adoption, demand, growth tracking per community). Only
  propose new columns/tables if the existing ones genuinely cannot support
  this, per the approved architecture's explicit instruction not to create
  a competing structure without proof of necessity.
- Location handling must support three independently-optional-after-city
  levels: `country` (expected always known), `city` (expected always known
  or at least resolvable — this is the primary rollout grouping, e.g.
  Harare/Chinhoyi/Other), and `area` (finer-grained, may be `null`/unknown).
  A user or business with `area = null` must still fully participate at the
  city/community level; `area`, when known, should allow finer community
  intelligence (e.g. distinguishing two different suburbs of Harare) without
  being required.
- The existing `country:city:area` `communityKey` convention (already
  scaffolded in `types/community.ts`) should be reused, but must be updated
  to tolerate a missing `area` component (e.g. key still resolves to a valid
  city-level community when area is unknown) rather than requiring all
  three parts.
- Every WhatsApp conversation, service request, and contribution should
  carry a community reference (city-level at minimum, area-level when
  known) so admin-dashboard aggregation by Harare/Chinhoyi/Other Communities
  is possible from day one, and finer area-level breakdowns are possible
  where data supports it.

**UNKNOWN:**
- Whether the existing `communities` table already has the metadata needed
  for rollout-status/adoption/demand/growth tracking, or whether it is a
  lighter-weight structure (e.g. just used for `community_posts` grouping)
  that would need new columns. Blocked on the schema inspection above.

## 6. Businesses and Services

**VERIFIED (LIVE DB):** `businesses` already contains `country`, `city`,
`area`, `community_key`, `latitude`, `longitude`, `category`, `subcategory`,
`trust_score`, `reviews_count`, `source`/`source_id`, and other existing
business fields. This confirms and extends RECON sections B/D/G — the
seeding pipeline's `source`/`sourceConfidence` concept (RECON section G) is
reflected in live `source`/`source_id` columns, and geographic coordinates
(`latitude`/`longitude`) exist in addition to the text `country/city/area`
fields RECON inferred.

**CONFIRMED** (RECON sections B, D, unchanged): `category`/`subcategory`
remain free-text columns — no separate categories/services table was
reported as existing in the live inspection either, so RECON's "no
categories table found" observation still stands, now also **not
contradicted by the live inspection**, though its complete absence is not
100% certain (see `docs/IMPLEMENTATION_PREREQUISITES.md` item 5).

**PROPOSED:**
- TrustHub Connect should read businesses through `TrustHubClient` rather
  than re-implementing discovery or seeding. If WhatsApp users request a
  business/service category that has weak coverage, that gap should become
  a **service request** (Section 9) and/or feed TrustHub's existing seeding
  pipeline rather than TrustHub Connect building a second one.
- Because `businesses` already has `latitude`/`longitude`, future
  area-level matching (Section 15) could eventually use proximity, not just
  the text `community_key` — but this is a later refinement, not part of
  the MVP matching approach (Section 15, rule-based only).

**UNKNOWN:**
- Whether a normalized `categories`/`services` table exists in the database
  outside of what code references and outside of what this live inspection
  reported (RECON section D). Needed before any category-based matching
  (Section 15) can be precise.

## 7. Reviews and Reputation

**CRITICAL SECURITY FINDING (VERIFIED, LIVE DB):** `public.reviews` and
`public.business_hours` currently have **RLS DISABLED**, while most other
relevant tables have RLS enabled. This means these two tables are not
row-level protected at the database layer today, regardless of what
application code assumes. **This is not remediated here** — no RLS was
enabled, no policy was written or applied, and no table was modified. It is
recorded as a required security task for whoever owns the TrustHub database
(see `docs/IMPLEMENTATION_PREREQUISITES.md` and Section 22).

**CONFIRMED** (RECON section D): `reviews` (`business_id, user_id, rating,
comment, created_at`) and `review_helpfulness` (`review_id, user_id,
value`) exist; business trust score is computed on demand from average
rating (`lib/trust/businessTrustScores.ts`), not stored as a running
aggregate. A separate *user*-level trust score (`trustPoints`/`trustLevel`)
is computed from review + business-added counts (`utils/trustJourney.ts`).

**PROPOSED:**
- TrustHub Connect should read, not duplicate, this reputation data when
  answering WhatsApp questions about a business ("is this plumber any
  good?").
- If TrustHub Connect ever allows submitting a review via WhatsApp, it
  should write to the same `reviews` table through an approved, real
  `TrustHubClient` implementation — not a parallel review store. Given the
  RLS finding above, this must not happen until `reviews`' RLS gap is
  remediated by whoever owns that decision — TrustHub Connect writing to an
  unprotected table would compound the existing risk, not fix it.

**UNKNOWN:** Exact column constraints/RLS *policy definitions* on tables
where RLS is enabled (Section 22) — only the enabled/disabled status is
verified so far, not the policy contents.

## 8. WhatsApp Conversations and Messages

**CONFIRMED:** Does not exist anywhere in TrustHub today (RECON section I).

**PROPOSED** (design sketch only, matches `types/conversation.ts` already
scaffolded):
- `Conversation { id, channel, whatsAppIdentityId, trustHubProfileId,
  status, communityKey, startedAt, lastMessageAt }`, status one of
  `open | awaiting_agent | resolved | abandoned`.
- `ConversationMessage { id, conversationId, direction, sender, text,
  createdAt }`, `sender` one of `user | ai_agent | trust_agent | system`.
- A conversation always resolves to a `trustHubProfileId` once identity
  resolution (Section 3/4) succeeds — never stored purely under a
  WhatsApp-only identifier long-term.

**UNKNOWN:** Retention policy for message content (how long to keep raw
message text vs. summarized outcomes) — a product/privacy decision, not
made yet.

## 9. Service Requests

**VERIFIED (LIVE DB):** There is currently no dedicated TrustHub Connect
service-request model in the database. **However**, the live database also
reveals a `public.help_requests` table whose purpose has not yet been
inspected in detail — its existence must be reconciled before designing a
new `ServiceRequest` structure, per the approved architecture's instruction
not to build a competing structure without proof it's necessary. It is
**UNKNOWN**, not assumed, whether `help_requests` already implements some or
all of what this section calls "service requests."

**CONFIRMED:** Closest previously-known analog is
`business_information_updates`, which corrects existing business data
rather than requesting something absent (RECON section I).

**PROPOSED** (matches `types/service-request.ts` already scaffolded, to be
revisited once `help_requests` is inspected):
- `ServiceRequest { id, conversationId, trustHubProfileId, communityKey,
  requestedCategory, requestText, status, createdAt, resolvedAt,
  timeToUsefulAnswerSeconds }`.
- Status lifecycle: `open → matched | escalated_to_agent → resolved`, or
  `unanswered` if nothing useful was found in a defined window
  (**UNKNOWN** what that window should be).

**UNKNOWN:**
- The exact schema and purpose of `help_requests` — must be inspected
  first (see `docs/IMPLEMENTATION_PREREQUISITES.md`).
- The exact definition of "resolved" vs. "unanswered" for reporting
  purposes (Section 17/18) — needs product sign-off.

## 10. Community Contributions

**VERIFIED (LIVE DB):** `business_information_updates` exists with columns
`business_id, user_id, field_name, suggested_value, status, business_name,
source, evidence_notes`, plus timestamps — confirming RECON section F/H's
inferred shape exactly, with no surprises.

**CONFIRMED** (RECON sections F, H): reviewed via an admin approve/reject
flow in `/api/admin/contributions`.

**PROPOSED:**
- Extend this existing pattern (matches `types/contribution.ts` already
  scaffolded as `CommunityContribution`) for WhatsApp-submitted
  contributions rather than inventing a parallel "contributions" concept.
  Where a contribution originates from a WhatsApp conversation, link it via
  `conversationId`/`trustHubProfileId`, but the review/approval workflow
  should stay consistent with the existing admin pattern.

**UNKNOWN:** Whether WhatsApp-submitted contributions should write directly
into this exact table, or a new table that funnels into the same review
queue — now that topology is APPROVED (same Supabase project, Section 2),
this is a schema-design detail rather than a topology question, but still
requires inspecting this table's exact constraints (nullability, foreign
keys) before deciding (see `docs/IMPLEMENTATION_PREREQUISITES.md`).

## 11. Provenance and Evidence

**OWNER BRIEF (data intelligence requirement):**
> "When TrustHub doesn't know, it asks. When the community knows, TrustHub
> remembers." The system should eventually capture useful structured
> information from interactions — requests, contributions, demand,
> outcomes, community context — while preserving provenance.

**CONFIRMED:** `business_information_updates`'s `source` +
`evidence_notes` fields are TrustHub's existing, working provenance
pattern (RECON section F).

**PROPOSED:**
- Every piece of "the community knows" data captured via TrustHub Connect
  (a contribution, a service-request resolution, a business detail
  correction) should carry: who provided it (`trustHubProfileId`), how
  (conversation/channel), and any supporting notes — mirroring
  `ProvenanceEvidence` already scaffolded in `types/contribution.ts`.
- Provenance should be additive/auditable (append evidence, don't overwrite
  history) — consistent with the existing admin review workflow rather than
  silently mutating business data.

**UNKNOWN:** Formal retention/audit requirements for evidence records —
not specified yet.

## 12. Community Questions

**VERIFIED (LIVE DB):** The live database already has `community_posts`,
`post_comments`, and `post_reactions` tables — these may already implement
something like "a question posed to the community" and its answers/
reactions. This was not visible from the inspected TrustHub application
code (RECON found no such concept). Their schema and actual usage are
**UNKNOWN** and must be inspected before concluding whether "community
questions" needs any new TrustHub Connect structure at all.

**PROPOSED:** If, after inspection, `community_posts`/`post_comments` don't
already cover this need, a "community question" would remain conceptually a
sibling of `ServiceRequest` — same lifecycle shape, different intent
(`requestedCategory` may be null, answer may come from other community
members rather than a business match).

**UNKNOWN:** Whether `community_posts`/`post_comments`/`post_reactions`
already satisfy this need (must be inspected first); if not, whether
"community questions" is a distinct product feature from "service
requests" or a framing/UI difference over the same underlying structure.

## 13. Community Demand Intelligence

**OWNER BRIEF:** the admin dashboard must show "Community Demand," "Top
Unanswered Requests," and demand/growth by city/community, to support
evidence-based distribution decisions after the Harare/Chinhoyi rollout.

**CONFIRMED:** No aggregation of this kind exists anywhere in TrustHub
today (RECON section I/K).

**PROPOSED:**
- Demand intelligence should be computed *from* `ServiceRequest` /
  `CommunityContribution` records (grouped by `communityKey` and
  `requestedCategory`), not from a separately maintained "demand" table —
  avoids two systems disagreeing about the same underlying events.
- Aggregation (materialized view, scheduled job, or on-demand query) is an
  implementation detail to decide once the underlying tables exist —
  **not** decided here.

**UNKNOWN:** Real-time vs. periodic aggregation; acceptable staleness for
the admin dashboard.

## 14. Agent/Service-Area Architecture

**CONFIRMED** (RECON section F): `referral_partners` /
`referral_events` exist today but model **referral marketing**
(partner code, visit/signup events), not operational service-area
coverage. There is no existing "which Trust Agent covers which
community/category" concept.

**PROPOSED:**
- A distinct "Trust Agent" concept is needed for operational escalation
  (Section 16 `MatchCandidate.type === "trust_agent"` already scaffolded in
  `types/matching.ts`), separate from `referral_partners`. Conflating the
  two would incorrectly mix marketing-referral tracking with operational
  escalation responsibility.
- Minimal shape (not final): an agent has one or more community/category
  coverage assignments used by the matching engine (Section 15) to decide
  who to escalate an unanswered request to.

**UNKNOWN:** Whether Trust Agents are a subset of `profiles` with a role
flag, or a wholly separate entity linked to a profile. Related to Section
21 (OWNER/TRUST_AGENT authorization) and must be decided together with it.

## 15. Matching

**CONFIRMED:** No matching logic exists anywhere in TrustHub today.
`lib/matching` in TrustHub Connect currently only has an interface +
not-connected mock (`findCandidates`, `recordMatchOutcome`).

**PROPOSED:** Matching should consider, at minimum: requested category,
community proximity (`communityKey`), and existing trust signals already
available (`businesses.trust_score`, Trust Agent coverage from Section 14).
No scoring formula is proposed here — that is a product/data-science
decision requiring real usage data, which does not exist yet.

**UNKNOWN:** Scoring algorithm, whether matching is rule-based or
ML-assisted, and what "candidate" ranking should weigh.

## 16. Successful Matches

**CONFIRMED:** No outcome tracking exists today for any kind of
match/referral beyond `referral_events`' generic `event_type`.

**PROPOSED:** `MatchResult { id, serviceRequestId, candidate, outcome,
matchedAt, resolvedAt }` (already scaffolded in `types/matching.ts`), with
`outcome` one of `successful | unsuccessful | pending`. "Successful" should
be defined by an explicit confirmation step (e.g. the requester confirms
the match helped), not inferred silently.

**UNKNOWN:** Who is authorized to mark a match successful/unsuccessful —
the requester, the agent, or both — and what happens on disagreement.

## 17. Problems Solved

**OWNER BRIEF:** the admin dashboard must show "Problems Solved" as a
top-level metric.

**PROPOSED:** "Problem solved" should be derived from `ServiceRequest`
reaching `status = resolved` (Section 9), not tracked as an independent
concept, to avoid two sources of truth for the same underlying event.

**UNKNOWN:** Whether "problem solved" should require the same explicit
confirmation as "successful match" (Section 16), or a looser definition
(e.g. any request that received a substantive reply).

## 18. Time to Useful Answer

**OWNER BRIEF:** listed explicitly as a required dashboard metric.

**CONFIRMED:** `types/service-request.ts` already scaffolds
`timeToUsefulAnswerSeconds`, populated once resolved.

**PROPOSED:** Computed as `resolvedAt - createdAt` for a `ServiceRequest`,
recorded once, not recalculated after the fact.

**UNKNOWN:** What counts as "useful" (Section 17) directly determines what
counts as a valid stop-the-clock event here — same open question, shared
dependency.

## 19. Analytics/Event Architecture

**CONFIRMED:** No event/analytics tracking exists in TrustHub Connect or
TrustHub today beyond ad hoc aggregate queries computed at page-load time
in TrustHub's admin pages.

**PROPOSED:**
- Prefer deriving dashboard metrics from the operational tables themselves
  (`profiles`, `businesses`, `ServiceRequest`, `CommunityContribution`,
  `MatchResult`, `Conversation`) via read queries/materialized views, rather
  than a separate bespoke "events" table that must be kept in sync by hand.
  This mirrors TrustHub's existing admin pattern (RECON section K) rather
  than introducing a new paradigm.
- `types/analytics.ts` (already scaffolded) intentionally only defines UI
  label constants today — it does not model an events schema, since no
  event schema has been approved.

**UNKNOWN:** Whether a genuine event-log table (append-only, e.g. for audit
or funnel analysis) is required in addition to the derived-metrics
approach above. Not decided.

## 20. Internal Admin Dashboard

**OWNER BRIEF:** dashboard must eventually show total users, new sign-ups,
active users, WhatsApp conversations, service requests, problems solved,
unanswered requests, community contributions, businesses/services added,
successful matches, time to useful answer, demand by city/community, growth
by city/community, and agent activity; initial rollout focus is Harare and
Chinhoyi.

**CONFIRMED (implemented today, UI only):** `/admin`
(`app/admin/page.tsx`) renders all of the above as static placeholder cards
(`—` / "No data yet."), sourced from `types/analytics.ts` constants. No
query, aggregation, or authentication exists behind it yet.

**PROPOSED:** Each metric card should eventually be backed by a read query
against the tables described in Sections 9/10/13/16/17/18/6/3, grouped by
`communityKey` where relevant for the geographic section. No such wiring
exists yet and must not be implemented until the underlying tables are
approved and built.

**UNKNOWN:** Refresh cadence (real-time vs. periodic) for dashboard
queries — not decided.

## 21. OWNER / TRUST_AGENT Authorization

**OWNER BRIEF (security requirement):** the future admin area must
ultimately be accessible only to `OWNER` and `TRUST_AGENT`, using real
server-side authorization. The current `/admin` UI remains a skeleton and
must not be described as production-secure.

**VERIFIED (LIVE DB):** `admin_users` has exactly `user_id` (primary key)
and `created_at`. **No role column currently exists.** This resolves
`docs/IMPLEMENTATION_PREREQUISITES.md` item 2 — a role concept must be
added (new column or new table); it does not exist today in any form.

**CONFIRMED** (RECON sections C, L): TrustHub's existing admin pattern uses
an `admin_users` allow-list table, checked **client-side** in most admin
pages (weak — only safe if RLS also restricts the underlying tables,
see the verified RLS findings in Section 22) but checked **server-side
with the service role key** correctly in `/api/admin/contributions`
(strong pattern).

**PROPOSED:**
- TrustHub Connect's `/admin` must use the server-side-verified-token
  pattern (like `/api/admin/contributions`) exclusively — never a
  client-side-only check — for every privileged read/write.
- A `role` concept (`OWNER | TRUST_AGENT`) is needed, either as a column on
  an allow-list table (extending the `admin_users` pattern) or a new table
  — decision deferred (Section 14 also depends on this).
- Until this is implemented, `/admin` must continue to be documented (in
  code comments and any user-facing status doc) as **not secure** and
  **not production-ready.**

**UNKNOWN:** Exact allow-list/role storage mechanism; whether OWNER/
TRUST_AGENT distinction needs different permissions per admin section
(e.g. Trust Agents see only their community) or all authorized users see
everything.

## 22. Security and RLS

**CRITICAL SECURITY FINDING (VERIFIED, LIVE DB):** RLS is enabled on most
relevant tables, **but `public.reviews` and `public.business_hours` have
RLS DISABLED.** This is a live, confirmed gap, not a hypothetical one. Per
explicit instruction: this has **not** been remediated — no RLS was
enabled, no policy was written or applied, no table was modified. This must
be tracked and fixed by whoever owns the TrustHub database, as its own
security task, independent of and prior to TrustHub Connect writing any new
data that touches these tables.

**CONFIRMED** (RECON section L, now partially updated by LIVE DB): the
enabled/disabled *status* of RLS is now verified for the tables named
above; the actual *policy definitions* on tables where RLS **is** enabled
(e.g. `profiles`, `businesses`, `business_information_updates`,
`admin_users`, `communities`, etc.) remain **UNKNOWN/unverified** — knowing
RLS is "on" does not by itself confirm the policies are correct or
sufficient. No CSRF/rate-limiting/middleware protections were observed on
any existing API route.

**PROPOSED:** Any new table TrustHub Connect eventually proposes must ship
with an explicit RLS policy proposal at design time (default-deny, then
named exceptions), not be left to "add later." Service-role-key operations
must stay server-side only, exactly as `/api/admin/contributions` already
does correctly. Separately, the `reviews`/`business_hours` RLS gap should be
remediated (by the TrustHub project owner, via an explicit, reviewed change
to that project) before TrustHub Connect relies on those tables being
row-level protected.

**UNKNOWN:** The actual policy definitions (roles, `USING`/`WITH CHECK`
expressions) for every table with RLS enabled. Must be confirmed directly
against the Supabase project before any TrustHub Connect table that
references or joins against them is implemented.

## 23. Existing TrustHub vs. TrustHub Connect Responsibilities

**PROPOSED split of responsibility** (not yet built, for review):

| Concern | Owned by |
|---|---|
| User identity (`profiles`, Auth) | TrustHub (existing) — Connect only links to it |
| Businesses, reviews, business hours | TrustHub (existing) — Connect reads only |
| Business information updates (existing web contributions) | TrustHub (existing) |
| WhatsApp conversations/messages | TrustHub Connect (new) |
| Service requests / community questions | TrustHub Connect (new) |
| WhatsApp-originated contributions/evidence | TrustHub Connect (new), feeding the existing review pattern |
| Matching / agent escalation | TrustHub Connect (new) |
| Community demand/analytics aggregation | TrustHub Connect (new), reading both existing and new tables |
| Admin dashboard UI | TrustHub Connect (new), described here |
| OWNER/TRUST_AGENT authorization | Shared decision — likely extends TrustHub's existing `admin_users` pattern rather than a second, incompatible mechanism |

**UNKNOWN:** Whether TrustHub Connect and TrustHub end up as two codebases
against one Supabase project, or two fully separate systems that
communicate over an API. This is the most consequential undecided item and
affects nearly every section above (see Section 2).

## 24. Information That Must Be Confirmed Before Database Implementation

Updated after live, read-only Supabase inspection. Items resolved by that
inspection are marked **RESOLVED**; remaining items are still **UNKNOWN**
and block real schema/migration work:

1. ~~Whether TrustHub Connect shares TrustHub's Supabase project~~ —
   **RESOLVED/APPROVED:** shared project, separate codebase (Section 2).
2. How to match an inbound WhatsApp phone number to an existing
   email-based TrustHub profile (Section 4) — still **UNKNOWN**; `profiles`
   has no phone column and no Auth capability check has been performed.
3. Whether `profiles` rows can be created without a full Supabase Auth
   email/password sign-up (Section 3) — still **UNKNOWN**; column names are
   now verified but Auth-level provisioning capability is not.
4. Actual RLS *policy definitions* on every existing TrustHub table
   TrustHub Connect would read or join against (Section 22) — **PARTIALLY
   RESOLVED**: enabled/disabled status is now verified, including the
   critical finding that `reviews` and `business_hours` have RLS disabled;
   the actual policy contents on tables where RLS is enabled remain
   **UNKNOWN**.
5. Whether a normalized `categories`/`services` table exists outside of
   code references (Sections 6, 15) — still **UNKNOWN**; not reported as
   existing by the live inspection, but not conclusively ruled out either.
6. Definitions of "resolved," "successful match," and "useful answer" for
   reporting purposes (Sections 9, 16, 17, 18) — still **UNKNOWN**; a
   product decision, not a database fact.
7. ~~Whether "community" needs to be a first-class table~~ —
   **RESOLVED:** a real `communities` table (plus `community_members`,
   `community_posts`, `post_comments`, `post_reactions`, `help_requests`)
   already exists (Section 5). **New UNKNOWN in its place:** the exact
   column-level schema and actual usage of all of these tables.
8. Whether "community questions" is a distinct feature from "service
   requests" (Section 12) — still **UNKNOWN**, now additionally dependent
   on inspecting `community_posts`/`post_comments`/`help_requests` first.
9. OWNER/TRUST_AGENT role storage mechanism and permission granularity
   (Sections 14, 21) — still **UNKNOWN**; `admin_users` is now confirmed to
   have no role column today, so this will require a new column or table
   either way.
10. WhatsApp provider choice and AI provider choice (unchanged from
    `TRUSTHUB_CONNECT_RECON.md` section M — still undecided).

## 25. Recommended Implementation Order

**PROPOSED**, unchanged in spirit from `TRUSTHUB_CONNECT_RECON.md` section
O, now organized against this document's numbering:

1. Resolve Section 24, items 1–3 (project topology + identity linking +
   profile provisioning) — blocks everything else.
2. Resolve Section 24, item 4 (confirm actual RLS state) before designing
   any TrustHub Connect table that touches existing TrustHub data.
3. Design and get sign-off on the minimal `ServiceRequest` /
   `Conversation` / `ConversationMessage` schema (Sections 8–9), reusing
   the `business_information_updates` provenance pattern (Sections 10–11)
   rather than inventing a new shape.
4. Design and get sign-off on the Trust Agent/matching schema (Sections
   14–16), including the "successful"/"resolved" definitions (Section
   24 item 6).
5. Decide the OWNER/TRUST_AGENT authorization mechanism (Section 21) and
   implement it using the server-side-verified-token pattern already
   proven in `/api/admin/contributions` — before any admin data becomes
   real.
6. Only after 1–5 are approved: connect Supabase, add environment
   variables, and begin schema/migration work — each still subject to the
   "stop and document before executing" rule for database changes.

## 26. Knowledge-Gap Loop Architecture

**OWNER BRIEF (data intelligence requirement, restated in this task):** the
system must support the loop:

> User asks → TrustHub searches → answer exists OR knowledge gap detected →
> identify relevant opted-in people → outreach/notification → contribution
> → provenance/evidence → review/verification → knowledge becomes reusable
> → future users benefit.

**VERIFIED (LIVE DB):** `public.notifications` already exists with
`user_id, type, title, message, entity_type, entity_id, metadata (jsonb),
dedupe_key (UNIQUE), read_at, created_at`. This is a real, general-purpose
notification delivery structure already in production use elsewhere in
TrustHub.

**PROPOSED:**
- Treat `notifications` as a potentially reusable delivery/infrastructure
  layer for the "outreach" step of the loop above. TrustHub Connect should
  not create a second notification system unless inspecting
  `notifications`'s actual usage/constraints proves it cannot support the
  required use case (e.g. if `entity_type`/`entity_id`/`metadata` cannot
  cleanly represent an outreach request, or if delivery channel is
  hard-coded to something WhatsApp can't use).
- The loop implies four conceptual entities, **not created as tables in
  this task**, only named here for future design:
  - `KnowledgeGap` — a detected instance of "TrustHub doesn't know," derived
    from a `ServiceRequest`/community question that found no confident
    answer (Section 9/12).
  - `CommunityOutreach` — a request sent out to find an answer for a
    specific `KnowledgeGap`.
  - `OutreachRecipient` — who was contacted for a given outreach (must
    respect opt-in status — mechanism for tracking opt-in is **UNKNOWN**,
    not yet designed).
  - `OutreachResponse` — what a recipient answered, feeding into
    `CommunityContribution`/`ProvenanceEvidence` (Sections 10–11) once
    reviewed/verified.
- This loop should reuse, not duplicate, the existing provenance pattern
  (Section 10/11) for the "contribution → provenance/evidence →
  review/verification" half of the loop, and the existing/verified
  `notifications` table for the "outreach" half, pending the inspection
  above.

**UNKNOWN:**
- Whether `notifications`'s schema and current usage (by TrustHub's
  existing features) can support outreach-specific needs (e.g. tracking a
  response, not just a read receipt) without conflicting with its existing
  use. Requires inspecting real rows/usage, not just the column list
  above.
- How "opted-in" is or will be tracked for outreach recipients — no such
  concept currently exists anywhere in either codebase.
- Whether `help_requests`/`community_posts` (Section 9/12) already partially
  implement pieces of this loop, which would change how much new design is
  actually needed.

## 27. Admin Intelligence Requirements (Future)

**OWNER BRIEF:** the future dashboard should be able to identify: repeated
questions, repeated service requests, unanswered demand, high-demand/
low-supply categories, missing businesses/services, knowledge gaps by
country/city/area, useful contributors, outreach activity, and knowledge
gaps resolved.

**PROPOSED:** Each of these is a *query/aggregation* over the operational
tables described in Sections 8–13 and 26 (grouped by category and by the
country/city/area hierarchy from Section 5), consistent with the
"derive from operational records, don't build a separate analytics
database" principle already approved (Section 19, APPROVED ARCHITECTURE
DECISIONS item 13). None of these queries are designed or implemented here
— this section only confirms they are architecturally reachable once
Sections 5, 9, 12, and 26's entities exist and are populated.

**UNKNOWN:** Exact query/aggregation design — deferred until the underlying
tables (Sections 9, 12, 26) are approved and built, per the recommended
implementation order (Section 25).

---

## APPROVED ARCHITECTURE DECISIONS

The project owner has reviewed the Architecture Decision Report and approved
the direction below. These decisions supersede the corresponding "UNKNOWN"
items in Sections 1–24 above where noted, but do **not** authorize any
database change by themselves — every item still marked **REQUIRES LIVE
SUPABASE VERIFICATION** must be confirmed (see
`docs/IMPLEMENTATION_PREREQUISITES.md`) before a single migration is
written.

1. **Supabase topology — APPROVED, now VERIFIED.** TrustHub's existing
   Supabase project ("Trusthub", ref `bygtmzwsmwsibtruzbcc") is the single
   source of truth. TrustHub Connect will not create a second Supabase
   project. (Resolves Section 2/24 item 1.)

2. **Codebase separation — APPROVED.** TrustHub Connect remains a separate
   codebase from TrustHub, communicating through a clean integration seam
   (`lib/trusthub`'s `TrustHubClient`, per Section 2). It must not duplicate
   canonical TrustHub data (identity, businesses, reviews).

3. **Identity model — APPROVED.** `profiles` remains the canonical TrustHub
   identity. A WhatsApp identity is only an integration mapping (WhatsApp
   number → `profiles.id`), never a permanent independent identity system.
   (Matches Section 3/4 `PROPOSED` design exactly.)

4. **Persistent identity mechanism — REQUIRES LIVE SUPABASE VERIFICATION.**
   The principle (same person, same profile, whether WhatsApp-first or
   web-first) is approved. The *mechanism* — how to link an existing
   email-based profile to a phone number, and how to provision a
   WhatsApp-first profile — depends on actual Supabase Auth capabilities
   that have not been verified. See
   `docs/IMPLEMENTATION_PREREQUISITES.md` items 1, 4, 6.

5. **Persisted community concept — APPROVED, now PARTIALLY VERIFIED.** A
   real `public.communities` table (plus `community_members`,
   `community_posts`, `post_comments`, `post_reactions`, `help_requests`)
   **already exists** in the live database — this is no longer a "build a
   new table" decision but an "inspect and reuse, don't duplicate"
   decision (Section 5). The `country → city → area` hierarchy must be kept
   (not simplified to country+city); `area` may remain unknown and users
   must still fully participate at city/community level without one.
   `profiles.location` must not be broken or rewritten by this work — the
   community concept is additive. Exact schema of the existing community
   tables **REQUIRES LIVE SUPABASE VERIFICATION** (column-level inspection,
   not just table-name confirmation — see
   `docs/IMPLEMENTATION_PREREQUISITES.md`).

6. **Conversations/messages ownership — APPROVED.** TrustHub Connect owns
   WhatsApp conversations and messages (Section 8), as already scaffolded
   conceptually in `types/conversation.ts`.

7. **Service requests ownership — APPROVED.** TrustHub Connect owns service
   requests / community questions (Sections 8–9, 12), as already scaffolded
   conceptually in `types/service-request.ts`.

8. **Contributions — APPROVED, with an explicit constraint, now VERIFIED
   columns.** TrustHub
   Connect must not build a competing business-information system. Connect
   contributions must preserve contributor identity, source/channel,
   evidence/provenance, and conversation/request context (matches
   `types/contribution.ts`'s `CommunityContribution`/`ProvenanceEvidence`
   already scaffolded). `business_information_updates` is now confirmed to
   contain exactly `business_id, user_id, field_name, suggested_value,
   status, business_name, source, evidence_notes`, plus timestamps.
   Business-related contributions should be able to
   feed this existing review process rather than creating a second one.
   **Whether this means writing directly
   into that table vs. a new table that forwards into the same review
   queue REQUIRES LIVE SUPABASE VERIFICATION** of that table's nullability/
   foreign-key constraints (see `docs/IMPLEMENTATION_PREREQUISITES.md`
   item 3).

9. **Demand intelligence — APPROVED.** Derived from operational
   requests/contributions (Section 11/13), not a separate source of truth,
   unless a later requirement proves one necessary.

10. **Trust Agents — APPROVED.** Operational Trust Agents are explicitly
    not the same thing as `referral_partners` (Section 12/14). Trust Agents
    will eventually link to TrustHub identities/profiles and carry explicit
    service/community coverage. Exact entity shape (subset of `profiles`
    with a role flag vs. separate linked entity) remains to be designed
    jointly with authorization (decision 14 below).

11. **Matching approach — APPROVED.** Start with simple deterministic/
    rule-based matching using requested category, community/location,
    agent coverage, and existing TrustHub trust signals (Section 13/15). No
    machine-learning ranking in the MVP.

12. **Problems solved / outcome model — APPROVED.** Do not count arbitrary
    bot replies as "problems solved." Use an explicit, configurable outcome
    model supporting useful-answer / successful-match / resolved /
    unanswered states (Sections 14–17), rather than scattering hard-coded
    logic across the codebase. The exact configuration mechanism (e.g. an
    enum with documented transition rules vs. a rules table) is still to be
    designed — this decision approves the *principle*, not a schema.

13. **Analytics — APPROVED.** Derive MVP dashboard metrics from underlying
    operational records (Section 16/19) rather than a separate analytics
    database. A future append-only event log may be added later for
    advanced funnel/audit analysis — not required for MVP.

14. **Admin authorization model — APPROVED (principle), design still
    open, now VERIFIED starting point.** The internal admin system will
    ultimately support `OWNER` and
    `TRUST_AGENT` roles, enforced server-side (Section 18/21). `admin_users`
    is now confirmed to contain only `user_id` (primary key) and
    `created_at` — **no role column exists today**, so a role mechanism
    must be added either way (new column vs. new table is still an open
    design choice). The existing `/admin` UI remains an unauthenticated
    skeleton until that is built —
    it must continue to be described as such, never as production-secure.
    Exact role-storage mechanism is still to be designed jointly with
    decision 10 above.

16. **Location hierarchy — APPROVED.** Keep `country → city → area`; do not
    simplify to country + city only. `area` may remain unknown, and a user
    or business must still fully participate at city/community level
    without one. `businesses` already has `country/city/area/community_key/
    latitude/longitude` columns (VERIFIED), confirming this hierarchy is
    already reflected in live data. (Section 5/6.)

17. **Knowledge-gap loop — APPROVED (principle).** The system must
    eventually support: user asks → TrustHub searches → answer exists or a
    knowledge gap is detected → relevant opted-in people are identified →
    outreach/notification → contribution → provenance/evidence →
    review/verification → knowledge becomes reusable (Section 26). The
    existing, VERIFIED `notifications` table should be reused for outreach
    delivery unless inspection proves it cannot support the need — do not
    build a second notification system pre-emptively. The conceptual
    entities `KnowledgeGap`, `CommunityOutreach`, `OutreachRecipient`, and
    `OutreachResponse` are named for future design only — **no tables are
    created for them in this task.**

15. **Security baseline — APPROVED.** Every new table TrustHub Connect
    proposes ships with an explicit RLS/security design before
    implementation (Section 19/22). Service-role-key operations remain
    server-side only, following the pattern already proven correctly in
    TrustHub's `/api/admin/contributions`.

**Items now marked REQUIRES LIVE SUPABASE VERIFICATION** (tracked in full in
`docs/IMPLEMENTATION_PREREQUISITES.md`): the exact mechanism for identity
linking/provisioning (decision 4) — including real Supabase Auth phone-based
provisioning capability; whether contributions write into the
existing `business_information_updates` table or a forwarding table
(decision 8); the actual RLS *policy definitions* on every table with RLS
enabled (the enabled/disabled status itself is now verified, including the
critical `reviews`/`business_hours` RLS-disabled finding — see Section 22);
the exact column-level schema of `communities`, `community_members`,
`community_posts`, `post_comments`, `post_reactions`, and `help_requests`
(their existence is now verified, their schemas are not); whether a
normalized categories/services structure exists outside of code (still not
confirmed either way); any foreign-key/unique constraints relevant to
identity linking beyond `profiles.user_id` being unique (now verified); and
whether `notifications`'s real usage can support the knowledge-gap loop's
outreach step (Section 26).

**CRITICAL SECURITY FINDING carried forward from Section 22:** `public.
reviews` and `public.business_hours` have RLS **disabled** in the live
database. This was not fixed and must not be silently worked around — it is
a required security task for whoever owns the TrustHub database, tracked in
`docs/IMPLEMENTATION_PREREQUISITES.md`.

## Explicit Non-Contradiction Check Against TRUSTHUB_CONNECT_RECON.md

This document was re-read against `TRUSTHUB_CONNECT_RECON.md` after
drafting, and again after the live-Supabase-facts update in this session.
No unresolved contradictions remain:

- Every place where a **VERIFIED (LIVE DB)** fact corrects an earlier
  **RECON** (code-only) inference is explicitly labeled as such at the
  point of correction (Sections 2, 5, 9, 12, 21, 22), rather than silently
  overwritten — most notably: a real `communities` table (plus
  `community_members`, `community_posts`, `post_comments`,
  `post_reactions`, `help_requests`) exists even though no inspected
  application code path queries it; `notifications` and the seed-lock table
  (`community_seed_locks`) are now confirmed by name, resolving two RECON
  "UNKNOWN-but-likely" items.
- All other **CONFIRMED** facts still restate recon findings without
  altering table/column names or sources.
- Every recon **UNKNOWN** that was not directly answered by the live
  inspection remains **UNKNOWN** here (exact RLS *policy* contents,
  `categories`/`services` table existence, TrustHub Identity code
  generation, exact schema of the newly-discovered community tables).
- No **PROPOSED** section claims an existing TrustHub table/feature that
  neither recon nor the live inspection confirmed exists.
- No database, credential, or external service was created, modified, or
  connected while producing or updating this document. The live Supabase
  inspection referenced throughout was performed read-only by the project
  owner and reported into this task, not performed by this agent.
- The **APPROVED ARCHITECTURE DECISIONS** section above records project-owner
  approval of direction/principles only; every item still requiring live
  database facts is explicitly carried forward as **REQUIRES LIVE SUPABASE
  VERIFICATION** rather than being silently treated as resolved.
- The critical finding that `reviews` and `business_hours` have RLS
  disabled is recorded (Sections 7, 22, and the APPROVED section) as a
  required security task, not remediated, per explicit instruction.

---

## Implementation update — 2026-09-29

This section supersedes earlier "do not build yet" sequencing where it
conflicts with the project owner's later autonomous build briefs.

- Migrations 001 and 002 are applied to TrustHub Supabase. The canonical
  `communities`, `profiles`, `help_requests`, `businesses`, and
  `knowledge_records` tables remain the source of truth; no duplicate business
  or community table was created.
- The server-only WhatsApp path resolves already-linked phone mappings,
  restores conversation state, runs deterministic structured understanding,
  reads business and approved knowledge sources independently, resolves an
  answer, persists the turn, persists explicit contribution candidates as
  declared, and sends through the Meta adapter when credentials exist.
- A configured AI provider is still absent. Structured understanding is
  deterministic and reports `aiProviderStatus: unavailable`.
- New phone provisioning remains deliberately blocked pending confirmation of
  the canonical Supabase Auth-to-profile creation workflow. Unknown numbers
  receive `account_link_required`; no shadow account is created.
- Community and Trust Agent consent/state exist, but no outbound notification
  or live human-handoff provider is wired.
- `docs/BUILD_STATUS.md` and `docs/AGENT_PROGRESS.md` contain current test,
  security-advisor, environment, and external-setup status.
- Latest live catalog verification corrected the earlier recorded RLS state:
  `reviews` and `business_hours` both currently have RLS enabled and explicit
  public SELECT policies; `reviews` also has authenticated own-row write
  policies. This sprint did not change those policies.

## Code-only community intelligence update — 2026-09-29

The autonomous build pass added application contracts and deterministic
helpers without changing the database schema:

- Community help requests require explicit requester consent and a resolved
  community/city. They preserve an optional area only; no precise location is
  part of the request contract. Repository implementations must atomically
  deduplicate by service request.
- Trust Agent ranking requires current availability and exact declared
  community coverage, prefers exact category coverage, and never broadens to
  another city. A consent-first handoff port and in-memory acknowledgement
  fake exercise assigned/accepted status, but there is no live agent registry,
  persistent assignment store, or dispatch.
- Knowledge-gap detection aggregates only recent open/unanswered demand and
  does not copy request text into gap descriptions. Demand and outcome metrics
  count explicit confirmation separately from generated responses.
- Outreach planning applies opt-in and frequency limits before delivery.
  Notification and audit-event ports have deterministic test doubles; no
  production notifier or event sink is configured.
- A deterministic answer generator formats only resolver evidence and
  propagates evidence IDs, provenance, confidence and uncertainty. A model
  provider is still unavailable and cannot set verification status.

These modules are not connected to live community, help-request, notification,
agent-assignment, or outcome persistence because related schema/policy facts
or provider configuration remain unconfirmed. See `docs/BUILD_STATUS.md` for
phase status and test results.

## Identity and community persistence continuation — 2026-09-29

**IMPLEMENTED:** the WhatsApp webhook uses the server-side
`SupabaseIdentityResolver` to look up the existing `whatsapp_identities`
mapping and then load the canonical `profiles` row. The applied Migration 001
documents unique constraints on both phone number and linked profile. A
sender with no verified mapping remains unresolved; profile name/email is
never used to infer ownership. Authenticated/manual phone linking is exposed
by the repository method, but must be invoked only by an approved identity
proof flow.

**BLOCKED:** first-time provisioning and the authenticated phone-link UI/API
remain unimplemented because the project's phone Auth provider, Auth user
creation behavior, profile-creation trigger, and identity-proof policy are
not confirmed. The webhook returns `account_link_required` and does not create
a shadow user or WhatsApp-only profile.

**BLOCKED:** the existing `CommunityHelpRequestRepository` has only a local
fake. The current `help_requests` adapter persists service requests, but the
community-sharing contract additionally requires durable consent evidence
and idempotency by service request. The confirmed schema/migrations do not
provide a consent timestamp or a verified uniqueness key for that operation.
No second community/help table or unverified mapping was added.

**UNKNOWN:** current live project access, exact Auth settings/hooks, detailed
`help_requests` constraints/policies, and whether a reviewed persistence
migration is permitted could not be rechecked in this environment. Supabase
CLI and server credentials are unavailable. No live Supabase or Meta call was
made and no migration was created/applied.
