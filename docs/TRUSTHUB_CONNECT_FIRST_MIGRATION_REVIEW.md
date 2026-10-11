# TrustHub Connect — First Migration Review

Review of `docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_SPEC.md` against
`docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md`,
`docs/IMPLEMENTATION_PREREQUISITES.md`,
`docs/TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md`,
`TRUSTHUB_CONNECT_RECON.md`, `docs/AGENT_PROGRESS.md`, and
`docs/BUILD_STATUS.md`, plus the verified live-schema facts already
documented. This is a document review only — no Supabase connection was
made, no database object was created/altered/dropped/renamed, no SQL was
written or executed, no credential was added, and the migration spec
itself was **not** edited (per explicit instruction — every recommendation
below is proposed here, not silently applied).

---

## REVIEW RESULT

**Overall:** the specification is sound in structure, correctly avoids
duplicating existing TrustHub tables, and correctly defers matching,
outreach, knowledge gaps, and agents. It is **not yet ready to execute
as-is** — it has one data-integrity gap serious enough to block real
WhatsApp use (webhook idempotency) and one operational gap that would
silently defeat the community/demand-tracking goal (no plan to populate
`communities`). Everything else is a refinement, not a blocker.

**Answers to the 14 review questions:**

1. **Is it the smallest safe foundation?** Structurally yes — five tables,
   all additive, nothing speculative. **Not yet fully "safe"**: it is
   missing a webhook-replay-safety mechanism (#7/#12 below), which is a
   correctness requirement for any real WhatsApp connection, not an
   optional refinement.
2. **Is `whatsapp_identities` correctly connected to identity/profile/auth?**
   Yes. Nullable `profile_id` correctly models "not yet linked," and
   `UNIQUE(profile_id)` correctly enforces one-linked-number-per-profile.
   No change required here.
3. **Is the `help_requests` vs. `service_requests` decision sound?** The
   *process* is sound (provisional, explicitly gated on inspection, not
   guessed). The risk is procedural, not architectural: nothing in this
   project can currently perform that inspection (no live Supabase access
   in this environment), so the gate itself needs an owner and a step,
   not just a mention.
4. **Is `contributions` sufficient for text/voice/photo/provenance/reusable
   knowledge?** Partially. Text and provenance fields are sufficient.
   Voice/photo evidence has nowhere to live *on the contribution itself* —
   it only exists in `conversation_messages.metadata`, with no link back
   to which specific message produced a given contribution. This is a
   required addition (#12).
5. **Is `conversations`/`conversation_messages` sufficient for the WhatsApp
   MVP?** Structurally yes, but it is missing the one field every
   production WhatsApp webhook integration needs: a provider message ID to
   prevent duplicate ingestion on retried webhooks (#12).
6. **Are the RLS rules safe/compatible?** Safe (default-deny, service-role
   for privileged writes), but partially **premature**: several policies
   grant "authenticated user, for their own row" INSERT access that has no
   real caller in the WhatsApp-first MVP, since WhatsApp users never carry
   a Supabase session — see Required Changes.
7. **Any missing FKs/uniqueness/checks/indexes/timestamps/status fields?**
   Yes — see Required/Optional Changes (webhook idempotency column,
   escalation target column, a couple of missing indexes, one useful
   cross-column check).
8. **Is match info directly on `service_requests` safe, or a data-model
   problem?** Safe for migration 1's stated scope, but it has a real, not
   cosmetic, limitation: `matched_contribution_id` points at one specific
   recommendation record, not at a stable "this is the same real-world
   provider" identity — two different people recommending the same plumber
   produce two different, unrelated `contributions` rows. This is an
   accepted MVP compromise, not a defect to fix now (fixing it requires
   the deferred provider table) — but it must be documented as a known
   limitation, not silently assumed away.
9. **Is free-text `area` acceptable given country → city → area?** Yes for
   schema purposes. The real risk is **inconsistent values**
   ("Area A" vs "area a" vs "Area-A") silently fragmenting demand
   analytics from day one — this needs an app-layer normalization rule,
   not a schema change.
10. **Hidden duplication risks with existing tables?** None found for
    `profiles`, `businesses`, `notifications`, `admin_users`, or
    `help_requests` (correctly deferred/gated). One real operational gap
    found: **`communities` currently has zero rows**, and this migration
    creates foreign keys to it but does not plan to populate it — without
    a companion data step, every new row's `community_id` will be `NULL`
    in practice for the entire pilot, defeating the community-context
    goal silently. This is not a duplication risk but is exactly the kind
    of "hidden risk" this question is asking about, and it belongs in this
    review.
11. **Any fields that should be removed as premature?** No. Every column
    reviewed has a concrete, near-term purpose (see What Is Correct). RLS
    *policy scope* should be narrowed (#6), but no column should be
    dropped.
12. **Any fields genuinely required but missing?** Yes — see Required
    Changes: `conversation_messages.provider_message_id`,
    `contributions.source_message_id`, and (recommended, not required)
    `service_requests.escalated_to_profile_id`.
13. **Can migration 1 support the full stated core loop?** Mostly, with one
    explicit, honest gap: **"ask targeted people/community" has no
    trackable persistence in migration 1 at all** — it was correctly and
    explicitly deferred, but that means the loop as literally stated
    cannot be *measured* end-to-end yet, only manually approximated via
    the existing `notifications` table. If the MVP demo requires *tracked*
    outreach, this is a scope decision for the project owner, not
    something this review can silently resolve.
14. **Every architectural change recommended:** listed in full under
    Required/Optional Changes below.

---

## WHAT IS CORRECT

- No existing table is altered, renamed, or duplicated. `communities`,
  `notifications`, `admin_users`, `business_information_updates`, and
  `help_requests` are all correctly treated as reuse targets or gated
  decisions, never silently replaced.
- `whatsapp_identities` correctly models "not yet linked" via nullable
  `profile_id`, and correctly enforces the one-person-one-identity rule at
  the database level via `UNIQUE(profile_id)`.
- Deferrals are well-reasoned and match the task's own minimal-loop design
  principle: no `KnowledgeGap` table, no outreach tables, no Trust Agent
  tables, no match-history table, no provider table, no admin role column.
  Each deferral has a documented derivation or reuse path rather than a
  silent omission.
- `time_to_useful_answer` is correctly *not* stored as a column — derived
  at query time, avoiding a redundant/staleness-prone metric.
- Free-text `area` (instead of a new relational table) is the right call
  for a table with zero rows of real area-level data.
- The `contributions`/`business_information_updates` split is correct and
  well-justified: literal business-field corrections keep using the
  existing table; everything that table structurally cannot represent
  (self-declared capability, unnamed provider, general info) goes to the
  new table.
- RLS default (RLS enabled, default-deny, service-role for privileged
  writes) is the right baseline, and the "no UPDATE/DELETE policy" choice
  for `conversation_messages`/`contributions` correctly makes them
  append-only, which directly supports the provenance principle ("AI
  organizes evidence, AI does not manufacture trust") — history is never
  silently rewritten.
- Migration order and rollback order are internally consistent and
  correctly handle the one genuine circular reference
  (`contributions` ↔ `service_requests`) via a post-creation `ALTER TABLE`.
- The analytics-derivation table is honest about what **cannot** yet be
  calculated (outreach activity, agent activity) rather than implying full
  dashboard coverage.

---

## REQUIRED CHANGES

### MUST CHANGE

1. **Add a webhook idempotency column to `conversation_messages`.**
   - **Column:** `provider_message_id text NULL`, with a `UNIQUE` index
     (nullable-safe — allows multiple `NULL`s for non-provider-originated
     messages such as `ai_agent`/`system` sender values).
   - **Why:** WhatsApp (and most webhook-based providers) can and will
     redeliver the same inbound message more than once. Without a unique
     external message identifier, a retried webhook produces a duplicate
     `conversation_messages` row — corrupting conversation transcripts,
     double-counting "WhatsApp Conversations"/message-volume metrics, and
     potentially triggering a duplicate AI reply. This is a correctness
     requirement for connecting to a real WhatsApp provider, not a
     nice-to-have.
   - **Classification:** MUST CHANGE — without it, the schema is not
     actually safe to connect to a live WhatsApp webhook, even though it
     will look correct in isolated testing.

2. **Add a source-message link to `contributions`.**
   - **Column:** `source_message_id bigint NULL REFERENCES
     conversation_messages(id) ON DELETE SET NULL`.
   - **Why:** the spec's own Section 4/17 explicitly requires
     `contributions` to be "sufficient for text, voice/transcription,
     photo, provenance" (review question 4). Today, voice/photo evidence
     only exists in `conversation_messages.metadata` (jsonb), with no
     column anywhere linking a specific `contributions` row back to the
     specific message (and therefore the specific audio/photo) that
     produced it. Without this, "preserve evidence" is only true for text
     typed directly as `claim_text`/`evidence_notes` — voice and photo
     provenance would be unrecoverable once a conversation has multiple
     messages.
   - **Classification:** MUST CHANGE — this directly fixes a stated
     requirement (review question 4) that the current spec does not yet
     satisfy.

3. **Add a companion data step: populate `communities` with initial rows
   (Harare, Chinhoyi) as part of migration rollout, not left implicit.**
   - **Not a schema change** — a plain `INSERT` into the existing,
     already-approved-for-reuse `communities` table, using its existing
     columns (`name, city, country, description, latitude, longitude`).
   - **Why:** `communities` currently has **zero rows** (VERIFIED). Every
     new table in this migration references `communities.id` via a
     nullable foreign key. If no rows exist, every `community_id` in
     every new table will be `NULL` for the entire pilot, silently
     defeating the stated goal of measuring "demand by
     country/city/area" and "growth by city/community" — the dashboard
     would show everything bucketed as "unknown community" regardless of
     how well the schema is designed. This was not called out as a
     required step anywhere in the spec (Sections 17/23), only implied by
     "communities... currently zero rows" being stated as a fact, not a
     to-do.
   - **Classification:** MUST CHANGE (to the migration **plan**, not the
     schema) — this is plain `INSERT` DML on an existing table the
     project has already approved reusing, not a new database object, so
     it does not violate the "no schema changes" boundary of this review,
     but it must be explicitly scheduled alongside (or immediately after)
     the migration, not left as an unstated assumption.

### SHOULD CHANGE

4. **Narrow the RLS `INSERT` policies for `contributions` and
   `service_requests` to `service_role`-only for migration 1**, removing
   the "authenticated user, for their own profile" INSERT path for now.
   - **Why:** in the WhatsApp-first MVP, there is no client that holds a
     Supabase user session when creating these rows — WhatsApp messages
     arrive at a server-side webhook and are written using the service
     role, exactly like `/api/admin/contributions` already does correctly.
     The "authenticated user" INSERT path has no real caller yet and only
     exists as a hypothetical for a future TrustHub web UI writing
     directly into these tables — a scenario not in scope for migration 1.
     Removing an unused write path now is a smaller attack surface with
     zero functional cost, and it can be added back explicitly (as its own
     reviewed change) the day a real authenticated-write use case exists.
   - **Classification:** SHOULD CHANGE — not a correctness bug, but a
     "don't grant privileges you don't need yet" hardening recommendation.

5. **Add a cross-column check constraint on `service_requests`:**
   `CHECK ((status <> 'resolved') OR (resolved_at IS NOT NULL))`.
   - **Why:** prevents a `resolved` row from silently having no
     `resolved_at`, which would break the "time to useful answer"
     derivation (`resolved_at - created_at`) for that row without any
     visible error.
   - **Classification:** SHOULD CHANGE — low cost, meaningfully improves
     data integrity for a metric the product explicitly cares about.

6. **Add two missing indexes:**
   - `contributions(related_conversation_id)` and
     `contributions(related_service_request_id)` — both are join columns
     that will be queried whenever displaying "contributions for this
     conversation/request," but neither is in the current index list
     (Section 10 only indexes `contributor_profile_id`, `business_id`,
     `community_id`, `verification_status`).
   - `service_requests(community_id, requested_category)` — a composite
     index directly supporting the "demand by category within a
     community" queries the analytics section (Section 20) already
     proposes, which today would only benefit from two separate
     single-column indexes rather than one covering index.
   - **Classification:** SHOULD CHANGE — performance/scalability
     correctness for queries the spec itself already proposes running.

7. **Add `subject_type` to `contributions`:**
   `subject_type text NOT NULL CHECK (subject_type IN ('business', 'self',
   'named_provider', 'general_info'))`.
   - **Why:** today, whether a contribution is a self-declaration ("I am a
     hairdresser"), a named recommendation ("I know a plumber..."), a
     business correction-adjacent note, or general local information can
     only be inferred indirectly from which nullable columns happen to be
     populated. An explicit, checked column makes this unambiguous for
     both application logic and future admin-dashboard breakdowns
     ("Useful Contributors," "Recent Contributions" by type) without
     guessing from column-nullness patterns.
   - **Classification:** SHOULD CHANGE — meaningfully improves clarity and
     future analytics without adding a new table.

8. **Add `escalated_to_profile_id bigint NULL REFERENCES profiles(id) ON
   DELETE SET NULL` to `service_requests`.**
   - **Why:** `status` already allows `escalated_to_agent`, but nothing
     records *who* it was escalated to, and the formal `TrustAgent` table
     is correctly deferred. A human Trust Agent is, at minimum, a
     `profiles` row even before a full coverage/assignment system exists
     — this column lets escalation be trackable immediately, without
     waiting for the deferred agent-network migration, and without
     inventing a table for it now.
   - **Classification:** SHOULD CHANGE — small, cheap, and closes a real
     gap between a status value that already exists and the ability to
     act on it.

9. **Document (not enforce in the database) a mandatory app-layer
   normalization rule for every `area` free-text column**, reusing the
   `normalisePart` convention already implemented in `types/community.ts`.
   - **Why:** without a consistent normalization rule applied before
     insert, "Area A," "area a," and "Area-A" would be counted as three
     different areas in demand/growth dashboards almost immediately — the
     schema is fine, but an unstated convention would quietly undermine
     the area-level intelligence goal.
   - **Classification:** SHOULD CHANGE — a process/documentation
     requirement, not a schema change.

---

## OPTIONAL CHANGES (DEFER)

- **`contributions.extraction_method`** (`'manual' | 'ai_transcribed' |
  'ai_extracted'`, nullable) to distinguish a contributor's exact words
  from an AI-assisted transcription/extraction of them. Reinforces "AI
  organizes evidence, AI does not manufacture trust" a little further, but
  isn't required to prove the core loop. **DEFER.**
- **A provider-identity table** to solve the "same real-world provider,
  multiple unrelated `contributions` rows" limitation (review question 8).
  Correctly out of scope until real contribution volume shows repeated
  clustering around the same unlisted provider, per the spec's own
  Section 18 reasoning. **DEFER**, already correctly deferred by the spec.
- **A first-class `KnowledgeGap` table** instead of the heuristic
  derivation in Section 20. The heuristic is weaker ("approximate only")
  but sufficient to prove the loop; a first-class table is real added
  value only once real query volume exists to tune the heuristic against.
  **DEFER**, already correctly deferred by the spec.
- **A tracked outreach mechanism** (even a minimal one, short of the full
  `CommunityOutreach`/`OutreachRecipient`/`OutreachResponse` design) if the
  MVP demo genuinely needs to *measure* "ask targeted people" rather than
  do it manually via `notifications`. This is flagged as a **product
  scope decision**, not a technical recommendation either way — see
  Risks.
- **`conversations.ended_at`** distinct from `last_message_at`/`status`.
  Marginal value over the existing columns for migration 1. **DEFER.**

---

## RISKS

- **Webhook idempotency (elevated to MUST CHANGE above, restated as a
  risk):** connecting to a live WhatsApp provider before adding
  `provider_message_id` risks duplicate messages, duplicate AI replies,
  and inflated conversation/message-volume metrics.
- **Unpopulated `communities` (elevated to MUST CHANGE above, restated as
  a risk):** if the companion `INSERT` step is forgotten, every dashboard
  metric that groups "by community" will silently show nothing useful for
  the entire pilot, even though the schema is otherwise correct — this
  would look like a dashboard bug when it is actually a missing data step.
- **`help_requests` decision remains genuinely unresolved** (carried
  forward, not this review's job to resolve): proceeding with the new
  `service_requests` table before someone with direct Supabase access
  inspects `help_requests` still risks building a table that duplicates
  an existing, purpose-fit one.
- **`matched_contribution_id` provider-identity ambiguity** (review
  question 8): accepted as an MVP limitation, but must be documented
  wherever match/outcome data is displayed (e.g. admin dashboard), so it
  is not mistaken for a stable provider record.
- **`contributions.contributor_profile_id ON DELETE RESTRICT`** (carried
  forward from the spec's own Section 25): still an open decision between
  blocking profile deletion and an anonymization path — this review does
  not resolve it, only confirms it was already correctly flagged rather
  than silently decided.
- **RLS policy content is still conceptual, not written**: even after the
  narrowing recommended above (#4), actual `CREATE POLICY` statements do
  not exist yet and must be written and reviewed before RLS is ever
  enabled for real, exactly as the spec's own Section 26 already states.
- **Area free-text normalization is a convention, not a constraint**: if
  the application layer ever bypasses the recommended normalization step
  (#9), nothing in the database will catch it — this is an accepted MVP
  tradeoff, not a defect, but should be revisited if area-level demand
  data starts looking fragmented in practice.

---

## FINAL PROPOSED TABLE SET

Unchanged from `docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_SPEC.md` Section 4 —
**still exactly five new tables**, with the additions below layered onto
the existing column lists (nothing removed, nothing renamed):

1. **`whatsapp_identities`** — unchanged from the spec.
2. **`conversations`** — unchanged from the spec.
3. **`conversation_messages`** — **add** `provider_message_id text NULL`
   with a unique index (MUST CHANGE #1).
4. **`contributions`** — **add** `source_message_id bigint NULL
   REFERENCES conversation_messages(id) ON DELETE SET NULL` (MUST CHANGE
   #2) and `subject_type text NOT NULL CHECK (...)` (SHOULD CHANGE #7);
   **add** indexes on `related_conversation_id`/`related_service_request_id`
   (SHOULD CHANGE #6).
5. **`service_requests`** — **add** `escalated_to_profile_id bigint NULL
   REFERENCES profiles(id) ON DELETE SET NULL` (SHOULD CHANGE #8); **add**
   the resolved/`resolved_at` check constraint (SHOULD CHANGE #5); **add**
   the `(community_id, requested_category)` composite index (SHOULD CHANGE
   #6).

Plus the same post-creation `ALTER TABLE contributions ADD COLUMN
related_service_request_id ...` step already specified.

Plus one companion **data** step (not a new table, not DDL beyond the
tables above): populate `communities` with initial Harare/Chinhoyi rows
(MUST CHANGE #3).

No table is added to or removed from the original five-table count.

---

## FINAL PRE-MIGRATION CHECKLIST

Before this can move from "reviewed" to "ready to write SQL," the project
owner must confirm:

1. **[MUST]** Accept or reject the three MUST CHANGE items above
   (`provider_message_id`, `source_message_id`, `communities` seed-data
   step).
2. **[MUST]** Decide whether to resolve the `help_requests` vs.
   `service_requests` question before writing SQL, or explicitly accept
   the risk of proceeding with a provisional `service_requests` table
   pending later reconciliation.
3. **[SHOULD]** Accept or reject each SHOULD CHANGE item individually
   (#4–#9 above) — none are blocking, but each should get an explicit yes
   or no rather than being silently adopted or silently dropped.
4. **[PRODUCT DECISION]** Decide whether the MVP demo requires *tracked*
   outreach (review question 13) or whether manual outreach via existing
   `notifications` is acceptable for the pilot — this determines whether
   a minimal outreach mechanism belongs in this migration or a later one.
5. **[CARRIED FORWARD, UNCHANGED]** All 6 items already listed in
   `docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_SPEC.md` Section 26 remain open
   and are not resolved by this review.
6. **[VALIDATION]** Confirm `npx tsc --noEmit` / `npm run lint` /
   `npm run build` all pass with no code changes (this review changed no
   application code — see below), and that no database object, RLS
   policy, Auth setting, or credential was touched in producing this
   review.

Once 1–4 are explicitly decided, the next step is writing the actual
migration SQL for review — still not auto-applied — reflecting whichever
recommendations above were accepted.
