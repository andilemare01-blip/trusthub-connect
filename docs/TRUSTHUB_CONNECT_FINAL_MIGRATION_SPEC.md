# TrustHub Connect — Final Migration Specification

This is the single, reconciled design document for TrustHub Connect's first
database migration. It supersedes the two-document state of
`docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_SPEC.md` +
`docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_REVIEW.md` by explicitly settling
every open recommendation (INCLUDE / DEFER / REJECT, with reasoning) into
one design. **Neither of those two documents was edited** — this is a new
document that resolves them, per instruction.

This remains a **design document only**. No Supabase connection was made,
no database object was created/altered/dropped, no SQL was written or
executed, no data was changed, no credential was added, and neither the
existing TrustHub project nor TrustHub SOS was touched while producing it.

**Sources reconciled:** `docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md`,
`docs/IMPLEMENTATION_PREREQUISITES.md`,
`docs/TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md`,
`docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_SPEC.md`,
`docs/TRUSTHUB_CONNECT_FIRST_MIGRATION_REVIEW.md`,
`TRUSTHUB_CONNECT_RECON.md`, `docs/AGENT_PROGRESS.md`,
`docs/BUILD_STATUS.md`.

---

## A. MUST CHANGE ITEMS (settled)

### A1. `conversation_messages.provider_message_id`

- **Column:** `provider_message_id text NULL`, with a **unique index**
  (a nullable-safe unique index — Postgres allows multiple `NULL`s, so
  messages with no provider identifier, e.g. `sender IN ('ai_agent',
  'system')`, are unaffected).
- **Duplicate webhook handling, explained:** WhatsApp providers (and
  webhook-based integrations generally) may redeliver the same inbound
  message more than once (network retries, at-least-once delivery
  guarantees). The ingestion path must `INSERT ... ON CONFLICT
  (provider_message_id) DO NOTHING` (or an equivalent
  check-then-insert done inside a single transaction) when
  `provider_message_id` is present, so a redelivered webhook is a no-op
  rather than a duplicate row. Outbound messages TrustHub Connect itself
  sends (and any `ai_agent`/`system` message with no provider identifier)
  simply omit this column (`NULL`), which the unique index permits.
- **Decision:** **INCLUDE**, exactly as specified in this task. This closes
  a real correctness gap identified in the review — without it, a retried
  webhook silently corrupts conversation transcripts and inflates
  message/conversation-volume metrics.

### A2. `contributions.source_message_id`

- **Column:** `source_message_id bigint NULL REFERENCES
  conversation_messages(id) ON DELETE SET NULL`.
- **Provenance explained, per content type:**
  - **Text:** `claim_text`/`evidence_notes` already hold the words
    directly; `source_message_id` additionally points at the exact
    `conversation_messages` row the text came from, so the original,
    unedited message is always recoverable for audit even if
    `claim_text` is later normalized/summarized by the application.
  - **Voice:** the audio itself (and, once a transcription provider is
    connected — not in this migration — its transcript) lives in
    `conversation_messages.metadata` (jsonb) on the *specific* message
    that carried it. `source_message_id` is what makes that link concrete
    — without it, a `contributions` row extracted from a voice note has
    no way to point back to "which message, therefore which audio" once
    a conversation has more than one message.
  - **Photo:** identical mechanism — the image reference lives in the
    originating message's `metadata`; `source_message_id` links the
    contribution to it.
- **Decision:** **INCLUDE**, exactly as specified. This is the smallest
  possible fix (one nullable FK) for a real gap: today, evidence provenance
  for anything except literally-typed text would be unrecoverable once a
  conversation has multiple messages.

### A3. Community bootstrap (Harare, Chinhoyi)

- **No new table.** The existing, VERIFIED `public.communities` table
  (`id, name, city, country, description, latitude, longitude,
  created_at`) remains canonical and is **not** altered.
- **Exact companion data step (DML, not DDL):**

  ```
  INSERT INTO communities (name, city, country, description, latitude, longitude)
  VALUES
    ('Harare',   'Harare',   'Zimbabwe', 'TrustHub Connect pilot community', -17.8292, 31.0522),
    ('Chinhoyi', 'Chinhoyi', 'Zimbabwe', 'TrustHub Connect pilot community', -17.3667, 30.2000);
  ```
  (Coordinates are the public, well-known city centroids — illustrative,
  not sensitive data. Exact values can be refined at execution time.)
- **Required fields:** `name`, `city`, `country` are the minimum needed to
  identify each pilot community unambiguously; `description`/
  `latitude`/`longitude` are populated for completeness since the columns
  exist, but are not load-bearing for the core loop.
- **How community identity maps to country → city → area:** a
  `communities` row represents the **country + city** level only (it has
  no `area` column — VERIFIED). `area` remains a separate, optional,
  free-text field on `conversations`/`contributions`/`help_requests`
  (Section E) — a person or request can reference a `communities.id` (city
  level) with `area = NULL` and still fully participate; when `area` is
  known, it refines the same `communities.id` row rather than requiring a
  different community entity.
- **Migration data vs. post-migration seed step:** this is **migration
  data, executed as its own explicit, idempotent DML step immediately
  after the DDL, in the same reviewed migration package** — not silently
  embedded inside the `CREATE TABLE` statements, and not left as a
  separate, easy-to-forget "seed script" run informally later. Being its
  own step (rather than buried in DDL) means it can be reviewed,
  re-run safely, and audited independently; being *part of* this migration
  package (rather than a future, optional task) means it is never
  forgotten. Idempotency is achieved at the application/execution level by
  checking for an existing row matching `(name, city, country)` before
  inserting (the `communities` table has no unique constraint on these
  columns today, and this migration does not add one — see Section K).
- **How this avoids `NULL` `community_id` everywhere:** every new table
  that carries a `community_id` foreign key resolves it via an
  application-level lookup against `communities` by city name (and country)
  once the user's stated/derived location is known. Without Harare/Chinhoyi
  rows existing *before* real traffic starts, that lookup would always
  fail for the two actual pilot cities, and every request/conversation/
  contribution would default to `community_id = NULL` — technically valid
  (the column is nullable) but silently defeating the entire
  "demand/growth by community" goal for the whole pilot. Seeding the two
  rows first guarantees the lookup succeeds for the cities that actually
  matter at launch. `community_id` remains nullable for any other city
  outside the initial pilot scope — this is graceful degradation, not a
  bug, for anywhere TrustHub Connect eventually expands to before that
  city's row is seeded.

---

## B. SHOULD CHANGE ITEMS — Final Disposition

Every item from the review is re-evaluated on its own merits below —
none are accepted automatically.

| # | Item | Decision | Reason |
|---|---|---|---|
| B1 | Narrow RLS `INSERT` to `service_role`-only on `conversations`, `conversation_messages`, `contributions`, `help_requests` (added columns) | **INCLUDE** | No client in the WhatsApp-first MVP holds a Supabase user session when these rows are created — every write originates from a server-side webhook/API handler. Granting an "authenticated user, own row" INSERT path today would be an unused privilege with a real (if small) security cost, for a use case (a future TrustHub web UI writing directly) that isn't in scope for Migration 1. Removing it now costs nothing functionally and can be reintroduced later as its own reviewed change. |
| B2 | `help_requests` cross-column check: `(status <> 'resolved') OR (resolved_at IS NOT NULL)` | **INCLUDE** | Directly protects the "time to useful answer" metric (`resolved_at - created_at`) from silently breaking on a malformed row. Cheap, unambiguous, no behavioral downside. |
| B3 | Missing indexes: `contributions(related_conversation_id)`, `contributions(related_help_request_id)`, `help_requests(community_id, requested_category)` | **INCLUDE** | These support queries this same design already proposes running (displaying a conversation's/request's contributions; grouping demand by category within a community). Declining them would mean the schema doesn't actually perform well for its own stated analytics use case. |
| B4 | `contributions.subject_type` (`business \| self \| named_provider \| general_info`, `NOT NULL CHECK`) | **INCLUDE** | Section H requires `contributions` to unambiguously represent a self-declaration vs. a named recommendation vs. general info. Inferring this from which nullable columns happen to be populated is fragile and would make future admin-dashboard breakdowns ("Useful Contributors" by type) guesswork. One `NOT NULL` enum column removes the ambiguity at negligible cost. |
| B5 | `help_requests.escalated_to_profile_id` | **DEFER** | Re-evaluated against the explicit "keep MVP minimal / do not invent fields not needed" instruction in this task: no `TrustAgent`/coverage/assignment concept exists yet in Migration 1 (correctly deferred elsewhere in this same document), so there is no structured way to *select* who this column should point to — it would sit unpopulated (or populated ad hoc/manually) until a real agent-network migration exists to give it meaning. Escalation for the pilot can be handled operationally (a human reviews `status = 'escalated_to_agent'` rows and acts manually) without a schema column. This is the one review recommendation this document does **not** carry forward as-is — a deliberate disagreement, not an oversight. |
| B6 | Documented (non-enforced) `area` normalization convention | **INCLUDE** (as a documented convention, not a schema/constraint change) | Prevents "Area A" / "area a" / "Area-A" from fragmenting demand analytics from day one. Enforcing it as a database `CHECK`/trigger would be premature machinery for a free-text MVP column; documenting a mandatory app-layer rule is sufficient and matches the "smallest possible schema" principle. See Section E. |

---

## C. `help_requests` vs. `service_requests` — Definitive MVP Decision

**Decision: EXTEND the existing, live `help_requests` table. No new
`service_requests` table is created. This reverses the prior provisional
decision now that `help_requests`'s real columns are VERIFIED.**

**Verified `help_requests` columns:** `id uuid, community_id uuid,
requester_id uuid, title text, description text, status text, latitude
double precision, longitude double precision, created_at timestamptz,
resolved_at timestamptz`. Currently zero rows.

**Evaluation against all 12 required criteria:**

1. **Duplication of request functionality** — with real columns now
   visible, `help_requests` already covers request identity, community
   linkage, geolocation, freeform description, a status field, and both
   creation and resolution timestamps. Building a second table with
   near-identical purpose alongside it would be duplication without a
   strong reason — the opposite of what was concluded when only the table
   *name* (not its schema) was known.
2. **Existing TrustHub compatibility** — zero rows and no application code
   path referencing it (per `TRUSTHUB_CONNECT_RECON.md`) strongly suggests
   this table was already prepared for a "request for help" feature that
   was never finished in the inspected app. Extending it is compatible by
   construction: every addition below is a new, nullable column; nothing
   existing is renamed, retyped, or dropped.
3. **WhatsApp-first requirements** — genuinely missing today:
   conversation linkage, structured category/intent, a match/outcome
   reference, and a channel marker. All four are additive.
4. **Persistent TrustHub identity requirements** — `requester_id uuid`
   already matches the identity-column *type* used elsewhere in TrustHub's
   own schema (e.g. `reviews.user_id`, `business_information_updates.user_id`
   are the same pattern), which references `auth.users.id` directly. This
   is arguably a **better** fit for "canonical TrustHub identity" than
   introducing a parallel `bigint` FK — see the identity note below.
5. **Community association** — `community_id uuid` already exists,
   presumably referencing `communities.id`. **Important open verification
   item, newly surfaced by this comparison:** `communities.id`'s actual
   type was never directly verified in any prior session; this document's
   other new tables (Section L) assume it is `bigint` for consistency with
   `profiles.id` (`bigint`, VERIFIED). `help_requests.community_id` being
   `uuid` is evidence — not proof — that `communities.id` may actually be
   `uuid`, which would also affect `businesses.id` (likely the same
   convention) and therefore every `bigint` reference to `communities.id`/
   `businesses.id` elsewhere in this spec (`conversations.community_id`,
   `contributions.business_id`/`community_id`, etc.). **This is flagged
   here as a new, cross-cutting pre-execution verification item — it is
   not fixed in this pass**, because retyping those columns is a change to
   the *other* tables' designs, which this task's instructions explicitly
   scope out ("do not alter the other migration decisions"). It must be
   resolved before any DDL is generated (added to the Final Human Approval
   checklist below).
6. **Conversation association** — missing; added as `conversation_id
   bigint NULL REFERENCES conversations(id) ON DELETE SET NULL` (type
   matches `conversations.id`, a brand-new table fully under this spec's
   control, so no mismatch here regardless of item 5's open question).
7. **Intent/category** — missing; added as `requested_category text NULL`
   and `intent text NULL CHECK (intent IN ('find_business',
   'find_provider','ask_question','report_issue'))`. `title`/`description`
   remain the freeform fields; `requested_category`/`intent` are the
   structured ones needed for matching/analytics.
8. **Matching/outcomes** — missing; added as `matched_business_id bigint
   NULL REFERENCES businesses(id) ON DELETE SET NULL` and
   `matched_contribution_id bigint NULL REFERENCES contributions(id) ON
   DELETE SET NULL` (Section D's limitation applies identically here,
   just on `help_requests` instead of a separate table).
9. **RLS complexity** — this is the one criterion that favors caution:
   `help_requests`'s *current* RLS state is **unverified** (it was not
   named in either the RLS-disabled list — `reviews`, `business_hours` —
   or the RLS-enabled-without-policies list — `community_seed_locks`,
   `google_seed_usage` — from prior sessions, so its status is simply
   unknown). Extending an existing table means inheriting whatever RLS
   currently governs it, rather than designing a clean policy set from
   zero on a brand-new table. **This must be verified before execution**
   (added to the Final Human Approval checklist below) — if RLS is
   already enabled with policies incompatible with Section J's model, this
   migration's RLS design for `help_requests` must be reconciled with the
   existing policies, not silently override them.
10. **Migration complexity** — lower than creating a new table: `ALTER
    TABLE help_requests ADD COLUMN ...` (7 nullable columns) instead of a
    full `CREATE TABLE` for a sixth object, and — because `help_requests`
    already exists — the cross-reference to `contributions.id` no longer
    requires the two-phase "create, then `ALTER ... ADD COLUMN` after" 
    dance the original `service_requests` design needed; see Section M.
11. **Future web/app reuse** — this is the deciding criterion. If
    TrustHub's own web app ever builds a "request for help" feature on
    `help_requests` (its evident original purpose), a WhatsApp-originated
    request and a web-originated request become the **same kind of row**,
    visible and manageable in one place, rather than two parallel tables
    that would eventually need the exact reconciliation the prior
    provisional decision flagged as a future risk. Extending now removes
    that future risk entirely instead of merely scheduling it.
12. **Long-term data-model clarity** — one canonical "a specific ask, with
    a lifecycle" entity for the whole TrustHub ecosystem is cleaner than
    two similarly-purposed tables. Given the verified schema overlap, a
    second table would not be "MVP-sized caution," it would be avoidable
    duplication.

**Exact minimum additions to `help_requests` (7 new, nullable columns —
no existing column is renamed, retyped, or dropped):**

| Column | Type | Purpose |
|---|---|---|
| `conversation_id` | `bigint NULL REFERENCES conversations(id) ON DELETE SET NULL` | links a WhatsApp-originated request to its conversation |
| `requested_category` | `text NULL` | structured category, separate from freeform `title`/`description` |
| `intent` | `text NULL CHECK (intent IN ('find_business','find_provider','ask_question','report_issue'))` | AI-classified intent |
| `area` | `text NULL` | free-text sub-city granularity (Section E), complementing the existing `latitude`/`longitude` |
| `matched_business_id` | `bigint NULL REFERENCES businesses(id) ON DELETE SET NULL` | current best candidate (Section D) |
| `matched_contribution_id` | `bigint NULL REFERENCES contributions(id) ON DELETE SET NULL` | current best candidate from a self-declared/recommended provider (Section D) |
| `source_channel` | `text NULL DEFAULT 'web' CHECK (source_channel IN ('whatsapp','web','admin','system'))` | distinguishes which channel originated the request, now that both web-originated (if/when built) and WhatsApp-originated requests share one table |

**Deliberately NOT added — existing columns reused instead:**
- **No new identity column.** `requester_id` (existing, `uuid`) is reused
  directly: TrustHub Connect writes the resolved profile's `auth.users.id`
  (available via `profiles.user_id`, already `UNIQUE`) into the existing
  `requester_id` column. Adding a second, redundant `bigint profile_id`
  column — as this spec's other new tables use — was considered and
  rejected: it would duplicate an identity reference the table already has
  in a compatible type, purely for internal consistency with the other
  tables. This is a **deliberate, justified inconsistency**: existing
  tables keep their existing identity convention (`uuid`, `auth.users.id`
  directly); the brand-new tables introduced elsewhere in this spec keep
  theirs (`bigint`, `profiles.id`) — each is correct for the table it's on.
- **No change to `status`.** The existing `status text` column (no
  verified `CHECK` constraint) is reused as-is. This migration does
  **not** add a `CHECK` constraint to it, to avoid conflicting with any
  existing, unverified assumption elsewhere about its value space. The
  intended status vocabulary (`open, answered, matched,
  escalated_to_agent, resolved, unanswered`) is documented as an
  **application-layer convention**, exactly as Section E already does for
  `area` normalization — not enforced in the database for this
  pre-existing column.
- **`title`/`description` — minor open item, non-blocking.** WhatsApp
  messages are a single block of text with no natural title/description
  split. Assumed handling: `description` receives the full request text
  (required); `title` is left `NULL` for WhatsApp-originated rows, or
  populated with a short synthesized summary (e.g. the first ~60
  characters) if `title` turns out to be `NOT NULL` — this is an
  application-layer decision either way and does not require a schema
  change. Whether `title` is actually nullable was not part of the
  columns verified for this task and should be confirmed before the
  ingestion code is written (not before this migration's DDL, since no
  schema change depends on the answer).
- **`resolved_at` (existing)** — reused directly for the
  "time to useful answer" derivation (`resolved_at - created_at`),
  identical in spirit to the original `service_requests` design; no new
  column needed.

**Permanent boundary (what `help_requests` is, and is not, going
forward):** `help_requests` (extended) is the single, canonical "a
specific ask, with a lifecycle" entity for the entire TrustHub ecosystem —
regardless of origin channel (`source_channel`) or how it was classified
(`intent`). It is **not** a knowledge/provenance store — that remains
`contributions` (Section H), linked optionally via
`contributions.related_help_request_id`. It is **not** a business-field
correction log — that remains `business_information_updates`, untouched
and unrelated. `help_requests` rows are asks; `contributions` rows are
answers/knowledge; the two are linked, never merged.

**Non-blocking follow-up, carried over in spirit:** none required — unlike
the prior provisional decision, this is not a "proceed now, reconcile
later" choice; it is the reconciliation itself, made as soon as the real
schema was available.

---

## D. Matching — Final Decision

**Decision: keep match information directly on `help_requests`
(`matched_business_id`, `matched_contribution_id`, added per Section C),
no `matches` table in Migration 1.**

- This is the minimal representation of "request → candidate → outcome"
  and matches the task's own minimal core-loop design (which does not
  include matching/ranking history as a Migration 1 requirement).
- **Explicit, documented limitation (not a defect):** these two columns
  represent **one current recommendation/match only** — not a complete,
  historical, multi-candidate matching system. If a first candidate
  declines and a second is tried, the columns are simply overwritten; the
  fact that a first candidate was ever considered is not retained anywhere
  in Migration 1's schema. A separate limitation, also accepted for MVP:
  `matched_contribution_id` points at one specific `contributions` row
  (one person's recommendation), not at a stable "this is the same
  real-world provider" identity — two different people recommending the
  same plumber produce two unrelated `contributions` rows, and matching to
  one does not imply anything about the other. Both limitations are
  acceptable for proving the loop; a `matches` table and/or a provider
  identity table are the correct, deferred fixes once real usage data
  shows they're needed (see Deferred Features, carried forward unchanged
  from the original spec).

---

## E. Location — Final Decision

**Decision: preserve country → city → area exactly as originally
specified. No `community_areas` table in Migration 1.**

- `communities` (existing, canonical, VERIFIED to have no `area` column)
  represents country + city only.
- `area` is a plain, nullable `text` column on `conversations`,
  `contributions`, and `help_requests` (added per Section C) — consistent
  across all three, never required, so **area must not block onboarding**:
  a person or request with `area = NULL` still fully resolves to a valid
  `communities.id` and participates at city level. On `help_requests`,
  `area` complements the table's existing `latitude`/`longitude` columns
  rather than replacing them — precise coordinates when available, a
  normalized area name when not.
- **Normalization convention (documented, not enforced in the database):**
  every write path that populates an `area` column must first run the
  value through the same normalization function already implemented in
  `types/community.ts` (`normalisePart` — trim, lowercase, collapse
  whitespace, replace non-alphanumerics with `-`), so "Area A," "area a,"
  and "Area-A" all resolve to the same stored value. This is an
  application-layer contract, not a `CHECK` constraint or trigger —
  introducing database-level enforcement now would be more machinery than
  a free-text MVP column warrants; if area-level demand data starts
  looking fragmented in practice, that is the trigger to revisit this,
  not a Migration 1 concern.
- **No `community_areas` table** is introduced because no real
  area-level data volume exists yet to justify normalizing it into a
  relation — exactly the reasoning already in the original spec and
  review, reaffirmed here, not reopened.

---

## F. Identity — Final Decision (RESOLVED, CORRECTED)

**Newly verified live facts driving this correction:**
`auth.admin.createUser({ phone, phone_confirm: true })` is a real,
supported Supabase Admin Auth capability (server-side, trusted
credentials only); `auth.users.phone` is nullable and **`UNIQUE`**;
`profiles.user_id` is `UNIQUE` and links the canonical profile to
`auth.users`; `help_requests.requester_id` is **`NOT NULL`** and
references `auth.users`; and there is **no** custom trigger on
`auth.users` that automatically creates a `profiles` row. This corrects
the prior version of this section, which used a synthetic placeholder
email — that is no longer the design. The real, normalized WhatsApp phone
number is the canonical matching input and the identifier used to
provision the Supabase Auth user.

**Decision: use the actual, E.164-normalized WhatsApp phone number
throughout — as the lookup key against `auth.users.phone`, and as the
identifier passed to `auth.admin.createUser` when provisioning is
genuinely needed. No synthetic placeholder identifier (email or
otherwise) is used.** `whatsapp_identities` remains a link table only;
`profiles`/`auth.users` remain the sole canonical identity. Because no
trigger creates `profiles` automatically, the identity resolver must
**explicitly** create/link the `profiles` row itself every time it
provisions or resolves an `auth.users` row.

**Important distinction, stated explicitly (not to be silently
conflated):** receiving an inbound WhatsApp message from a phone number is
**not itself proof of identity ownership** beyond whatever the WhatsApp
channel/provider verifies for message delivery. `phone_confirm: true`
marks the number as confirmed **at the Supabase Auth layer** — that must
only be set when this architecture has an actual basis for treating the
number as verified *through the WhatsApp channel/provider's own delivery
guarantees* (i.e., the provider only delivers messages that genuinely
originated from that number's registered WhatsApp account). This
document does **not** claim that ordinary message receipt automatically
constitutes a Supabase phone-auth OTP verification event — provider-level
number verification and Supabase Auth's own phone-verification concept
are treated as **separate concepts**, linked only because this design
explicitly chooses to trust the WhatsApp provider's delivery-layer
verification as the basis for `phone_confirm: true`. If that trust
assumption changes (e.g. a provider proven to allow spoofed sender
numbers), `phone_confirm` must be revisited — it is a design choice
documented here, not an automatic technical fact.

### Exact resolution flow, for every inbound WhatsApp message

```
inbound WhatsApp message, sender phone number
  → normalize to canonical E.164
  → lookup whatsapp_identities.phone_number (E.164)
      → FOUND, profile_id set → resolved: use existing canonical identity. DONE.
      → NOT FOUND ↓
  → lookup auth.users.phone (E.164)
      → FOUND (an existing auth.users row already has this phone) →
        resolve that canonical user; find/create its profiles row if
        somehow missing; create the whatsapp_identities link row pointing
        at it. DONE.
      → NOT FOUND ↓
  → provision: auth.admin.createUser({ phone: <E.164>, phone_confirm: true })
      (server-side, service_role/trusted credentials only)
  → explicitly create the profiles row referencing the new auth.users.id
      (no trigger performs this automatically — VERIFIED)
  → create the whatsapp_identities row (phone_number, profile_id, linked_at)
  → resolved: new canonical identity. DONE.
→ only after resolution succeeds (found or provisioned) is any
  conversation permitted to proceed to creating a help_requests row.
```

`whatsapp_identities.profile_id` remains nullable at the schema level (an
inbound message could theoretically be logged before resolution
completes), but the **application requirement** is that this entire flow
runs synchronously — or the request is held/retried — before any
`help_requests` row is created, since `requester_id` is `NOT NULL`.

### Duplicate/race-condition handling

- `whatsapp_identities.phone_number` is `UNIQUE`; `auth.users.phone` is
  `UNIQUE` (VERIFIED). Both constraints are the last line of defense
  against two identities ever existing for the same normalized number.
- **Never create two TrustHub identities for one normalized WhatsApp
  number.** The resolver must treat phone lookup + provisioning as one
  logical, idempotent operation — e.g. an upsert
  (`INSERT ... ON CONFLICT (phone_number) DO NOTHING` on
  `whatsapp_identities`, or an equivalent application-level lock/
  check-then-create guarded by the unique constraints) so that two
  near-simultaneous inbound messages from the same number cannot both
  reach the "not found → provision" branch and each create a separate
  `auth.users` row.
- If `auth.admin.createUser` is ever called twice concurrently for the
  same phone, Supabase's own `auth.users.phone` `UNIQUE` constraint
  rejects the second call — the resolver must catch that conflict and
  fall back to the lookup path (treat it as "found," not as an error) —
  this is an **application requirement**, not a schema change.

### Evaluation against every required criterion

- **One-person/one-identity requirement:** satisfied — the resolved
  `auth.users` row (found or newly provisioned) is the one canonical
  identity; both `UNIQUE` constraints (`auth.users.phone`,
  `whatsapp_identities.phone_number`) enforce it at the database level.
- **Existing `profiles.user_id` model:** fully respected — a `profiles`
  row is explicitly created/linked to the resolved `auth.users.id` by the
  resolver itself, precisely because no trigger does this automatically
  (VERIFIED fact 6).
- **Existing `help_requests.requester_id NOT NULL` requirement:**
  satisfied — by the time a `help_requests` row is created, `requester_id`
  is the resolved identity's real `auth.users.id` (via `profiles.user_id`),
  never `NULL`.
- **Existing RLS (`auth.uid() = requester_id` on INSERT):** unaffected by
  this correction — Migration 1's B1 decision already narrows all writes
  to `service_role`, which bypasses RLS; this must still be verified
  before execution (Final Human Approval Required, unchanged from the
  prior session).
- **WhatsApp-first onboarding:** works directly — the real phone number
  *is* the identifier, requiring no placeholder value and no dependency on
  end-user-facing phone sign-in UX being configured (that remains a
  separate, future login-UX question, not a provisioning blocker).
- **Future web/app login:** fully compatible, and arguably improved by
  this correction — because `auth.users.phone` is now populated with the
  person's real number, a *future* native phone/OTP login
  (`signInWithOtp`) could authenticate against the *same* `auth.users` row
  with no extra linking step, if/when that channel is built (Future
  Enhancement, not required now).
- **Duplicate-account prevention:** the two `UNIQUE` constraints prevent
  duplicate links for the *same* number. They do **not** prevent the
  separate problem of one real person having two different numbers/two
  different signup paths producing two different `auth.users` rows — see
  Case 4.
- **Account linking:** unchanged from the prior version — an explicit,
  user-initiated action remains the safe mechanism for Case 4; still a
  future/application-layer concern, not solved by phone-based
  provisioning alone.
- **Privacy/security:** the real phone number is now stored in
  `auth.users.phone` (a purpose-built Supabase column, already `UNIQUE`
  and nullable specifically to support this use case) rather than
  fabricated into an unrelated field — this is a **more** accurate and
  appropriate use of Supabase's own schema than the rejected placeholder-
  email approach, not a new exposure: the number was already going to be
  stored in `whatsapp_identities.phone_number` regardless. All
  provisioning/lookup happens server-side via trusted credentials only —
  never exposed to a client.
- **Operational simplicity:** no new table, column, or constraint —
  identical schema footprint to the prior version of this section; the
  entire correction is a change to the **application-layer** resolution
  logic (`lib/identity`), not to the migration.
- **MVP scope:** minimal — one phone lookup against `auth.users`, one
  conditional Admin API call, one explicit `profiles` insert, one
  `whatsapp_identities` upsert, all synchronous.

### The five required cases

1. **Brand-new WhatsApp user (no existing `auth.users` row with this
   phone):** normalize → `whatsapp_identities` lookup misses →
   `auth.users.phone` lookup misses → provision via
   `auth.admin.createUser({ phone, phone_confirm: true })` → explicitly
   create the `profiles` row (no trigger does this) → create the
   `whatsapp_identities` link → resolved. First `help_requests` row can
   now be created.
2. **Existing TrustHub user whose phone is already known** (an
   `auth.users` row already has this exact E.164 phone on file — e.g. from
   a prior WhatsApp interaction, or a future flow that collects phone at
   web signup): `whatsapp_identities` lookup misses, but the
   `auth.users.phone` lookup **hits** → resolve to that existing user,
   find/create its `profiles` row if somehow missing, create the
   `whatsapp_identities` link. No new identity is created — this is a safe,
   automatic match because the phone number itself is the verified,
   unique key.
3. **WhatsApp number already linked (returning user):**
   `whatsapp_identities` lookup hits directly, `profile_id` already set →
   resolved immediately, no provisioning or `auth.users` lookup needed.
4. **Existing TrustHub user whose account cannot be safely matched** (e.g.
   signed up via web with only an email, no phone ever recorded on their
   `auth.users` row): both lookups miss — there is no safe automatic way
   to know this WhatsApp contact is the same person. **Do not silently
   merge accounts.** A new identity is created exactly as in Case 1. This
   person will, until they complete an explicit linking action, have two
   separate TrustHub identities. This is an accepted, explicitly
   documented MVP limitation, not a defect. The safe reconciliation path
   is a **future**, explicit account-linking flow (e.g. entering a
   one-time code shown in the TrustHub web app while authenticated) — not
   built in Migration 1, and not required for a first request to be
   created.
5. **Same person later signing into web/app:** because the canonical
   identity is always a real `auth.users` row with a real phone number on
   file (Cases 1–3), a future native phone/OTP web login could
   authenticate directly against it; alternatively, adding an
   email/password or magic link via `auth.admin.updateUserById`/
   `generateLink` attaches a second login method to the *same* row. Either
   way, no second identity is created — a **future enhancement**, not
   required for Migration 1.

**Duplicate/ambiguous account handling, restated:** the only
database-enforced protection is against re-linking the *same normalized
phone number* twice (`UNIQUE` on both `auth.users.phone` and
`whatsapp_identities.phone_number`) — this is airtight. The residual,
unenforceable case is Case 4's cross-channel identity split (one real
person, two `auth.users` rows, because no shared identifier existed at
the time). Both identities function independently and correctly; nothing
is broken or blocked. A manual merge/reconciliation tool (OWNER-only) is a
**future enhancement**, not built yet, since admin authorization itself is
not built yet (Sections J, L).

### Classification

- **MIGRATION REQUIREMENT:** none. Schema only — no `auth` schema changes
  are required by this migration; `whatsapp_identities.profile_id`
  remaining nullable and `UNIQUE`, and `auth.users.phone`/
  `whatsapp_identities.phone_number` both already being `UNIQUE`, are
  already sufficient. Nothing here alters Migration 1's table set
  (Section L).
- **APPLICATION REQUIREMENT (code, not schema, but required before the
  MVP can function):**
  - Implement the server-side `IdentityResolver`/`IdentityProvisioner`
    (`lib/identity`) exactly per the flow above.
  - Normalize every phone number to canonical E.164 before any lookup,
    insert, or comparison.
  - Perform safe matching in the documented order:
    `whatsapp_identities` → `auth.users.phone` → provision.
  - Create the Supabase Auth user via the Admin API only when no match is
    found.
  - **Explicitly create/link the `profiles` row** in application code —
    there is no `auth.users` trigger to rely on (VERIFIED).
  - Do not permit `help_requests` (or any conversation reaching that
    point) creation before identity resolution succeeds.
  - Use trusted, server-side credentials (`service_role`/Admin API) only
    — never expose Admin Auth capability to a client.
  - Handle the `auth.users.phone`/`whatsapp_identities.phone_number`
    unique-constraint race condition idempotently (see above).
- **FUTURE (explicitly not required for Migration 1 or MVP function):**
  native phone/OTP login UX on the web app; an explicit account-linking UI
  for Case 4; an OWNER/admin merge workflow for reconciling a Case 4 split
  after the fact.

---

## G. Conversations — Final Decision

**Decision: `conversations` + `conversation_messages`, unchanged in shape
from the original spec plus A1's `provider_message_id` addition — no
further tables.**

Flow, exactly as required:

```
WhatsApp inbound message (webhook)
  → find/create whatsapp_identities row (by phone_number)
  → find/create conversations row (channel='whatsapp', whatsapp_identity_id, community_id/area if resolvable)
  → insert conversation_messages row (direction='inbound', sender='user',
     content, metadata for any media, provider_message_id for idempotency)
  → [application layer, not new schema] AI interpretation (lib/ai's interfaces)
  → [application layer] TrustHub lookup (lib/trusthub, businesses/contributions/help_requests)
  → insert conversation_messages row (direction='outbound', sender='ai_agent' or 'trust_agent', content = response)
  → conversations.last_message_at updated
  → future reusable history: querying conversation_messages by conversation_id, ordered by created_at
```

`channel` stays a column (not a table split), so WhatsApp remains one value
among several (`web`, `admin`, `system`) rather than baked into the
architecture, per the original design principle. No voice/photo/location
tables — `metadata` (jsonb) carries those references, exactly as already
specified.

---

## H. Contributions — Final Decision

**Final column set (base spec + A2 + B4, nothing else added):**

`id, contributor_profile_id, category, claim_text, business_id,
provider_name, community_id, area, source, relationship, evidence_notes,
verification_status, reviewed_by_profile_id, reviewed_at,
related_conversation_id, related_help_request_id, source_message_id,
subject_type, created_at`.

Confirmed coverage of every required content type:

- **Text** → `claim_text` (+ `source_message_id` for the exact origin).
- **Voice/transcribed content** → the audio lives on the originating
  `conversation_messages.metadata`; `source_message_id` links to it;
  `claim_text` holds the (possibly AI-assisted) structured claim derived
  from it.
- **Photos/evidence** → same mechanism as voice — image reference in
  `conversation_messages.metadata`, linked via `source_message_id`;
  `evidence_notes` holds any accompanying free text.
- **Source/provenance** → `source`, `relationship`, `contributor_profile_id`,
  `reviewed_by_profile_id`/`reviewed_at`, `verification_status`.
- **Contributor identity** → `contributor_profile_id` (always required,
  `NOT NULL`).
- **Optional relation to a request** → `related_help_request_id` (`uuid
  NULL REFERENCES help_requests(id) ON DELETE SET NULL` — typed `uuid` to
  match `help_requests.id`, since Section C now links to the existing,
  live `help_requests` table rather than a new `bigint`-keyed table).
- **Source message** → `source_message_id` (A2).

**No additional fields invented.** Considered and explicitly **REJECTED**
for Migration 1: a dedicated media table (photo/voice references stay on
`conversation_messages.metadata` — a separate media table would duplicate
what jsonb already covers at this scale); `extraction_method`
(manual vs. AI-transcribed vs. AI-extracted) — **DEFERRED**, not rejected
outright: it would incrementally reinforce "AI organizes evidence, AI does
not manufacture trust," but it is not required to prove the core loop and
can be added later as a simple nullable column without any migration
conflict.

---

## I. Knowledge Gap / Community Outreach — Final Decision

**Decision: the MVP core loop is sufficiently supported by existing/new
minimal primitives (`help_requests`, `contributions`, `profiles`,
`communities`, `notifications`). No `KnowledgeGap`/outreach subsystem is
introduced in Migration 1.**

**Exactly how the first version of the loop works with only these
primitives:**

1. A `help_requests` row reaches `status = 'unanswered'` (or a
   heuristic query finds a repeated `requested_category` within a
   `community_id` with no resolved outcome) — this **is** the "TrustHub
   doesn't know" signal, derived from data that already exists, not a new
   `KnowledgeGap` record.
2. A human (for the pilot: the project owner or a Trust Agent acting
   manually, since no automated agent-assignment system exists yet)
   reviews these unanswered/repeated requests and identifies relevant
   people to ask — using ordinary queries over `contributions`
   (who has previously declared a relevant `category`/`community_id`) and
   `profiles`.
3. That person is contacted either through the existing `notifications`
   table (a plain, already-supported notification type/entity referencing
   the `help_requests` row) or, just as validly, through a **new
   WhatsApp conversation** with them — which is not a special case at all,
   it is simply another `conversations` row plus `conversation_messages`,
   exactly like any other interaction.
4. Their reply is recorded as an ordinary `contributions` row, with
   `related_help_request_id` set to the original gap's request and
   `source_message_id` pointing at their reply message — this **is** "the
   community fills the gap," using only the primitives already specified.
5. The original `help_requests` row is updated to `status = 'resolved'`
   once the contribution is reviewed/used to answer it — closing the loop
   with existing/added columns, no further ones.

**Why this is sufficient rather than a gap requiring a new primitive:**
the "outreach" step in this minimal version *is* a conversation (or a
notification), and the "response" *is* a contribution — both already
exist. What is genuinely **not** available in Migration 1, and is
explicitly accepted as a limitation rather than solved with new schema:
**outreach cannot be measured as its own metric** (there is no "was this
person selected for outreach and did they respond" record independent of
them simply choosing to start/continue a conversation) — this matches
what was already stated in the migration spec's analytics section
("Outreach activity: cannot be calculated") and is not changed here. If a
future need arises to measure targeting/response rates precisely (not just
"the loop can happen"), the smallest missing primitive at that point would
be a single `outreach_attempts` table (recipient, gap reference,
sent-at, responded-at) — deliberately **not** built now, per the explicit
instruction not to introduce a large subsystem prematurely.

---

## J. RLS — Final Conceptual Model

Every proposed table: **RLS enabled, default-deny.** No policy is created
or applied by this document. Per B1, INSERT is narrowed to `service_role`
everywhere in Migration 1, reflecting that the WhatsApp webhook/AI path
operates entirely through trusted, server-side credentials — never a
direct client write.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `whatsapp_identities` | `service_role` only (PII: phone numbers) | `service_role` only | `service_role` only | `service_role` only, expected rare |
| `conversations` | owning profile (`profile_id` → own `profiles` row) or `service_role` | `service_role` only | `service_role` only | none |
| `conversation_messages` | owning profile (via parent conversation) or `service_role` | `service_role` only | none (append-only) | none |
| `contributions` | contributor (own `contributor_profile_id`) or `service_role`; broader public read of `verified` rows is an explicitly later decision, not Migration 1 | `service_role` only | `service_role` only (verification review) | none |
| `help_requests` (extended) | owning requester (`requester_id` → own `auth.users.id`) or `service_role` | `service_role` only | `service_role` only (status/match transitions) | none |

All service-role operations remain server-side only, following the pattern
already proven correctly in TrustHub's existing
`/api/admin/contributions`. **`help_requests`'s current, pre-existing RLS
state is unverified** — unlike the four brand-new tables above, this
migration inherits whatever RLS already governs it; the row above is this
spec's *intended* model, to be reconciled with (not silently overridden by)
whatever already exists, once verified (see Final Human Approval Required).
**Carried forward, unresolved, not
remediated:** `public.reviews` and `public.business_hours` have RLS
**disabled** in the live database — independent of this migration,
requiring its own security task.

---

## K. Existing Tables — Explicit Reuse Statement

| Table | Status in Migration 1 |
|---|---|
| `profiles` | Reused — canonical identity target for every new FK |
| `businesses` | Reused — canonical, referenced by `contributions.business_id` and `help_requests.matched_business_id`; not written to |
| `communities` | Reused, canonical — **only table receiving new data** (the Harare/Chinhoyi bootstrap rows, Section A3); schema itself untouched |
| `community_members` | **Untouched.** Not read or written by Migration 1; acknowledged as an existing, separate community feature |
| `notifications` | **Untouched** in Migration 1 (no outreach writes yet — Section I); reserved as the reuse target when outreach is eventually built |
| `help_requests` | **Reused and extended** (Section C) — 7 nullable columns added (`conversation_id, requested_category, intent, area, matched_business_id, matched_contribution_id, source_channel`); no existing column renamed, retyped, or dropped; existing `requester_id`/`status`/`resolved_at` reused as-is |
| `admin_users` | **Untouched** — no role column added; `/admin` remains unauthenticated |
| `reviews`, `business_hours`, `business_claims`, `business_owners`, `business_information_updates`, `community_posts`, `post_comments`, `post_reactions`, `community_seed_locks`, `google_seed_usage`, `trusted_contacts`, `sos_alerts`, trust-battle structures, `feedback` | **All untouched** — no schema or data changes to any of them |

---

## L. Final Table Set

Exactly **four** new tables (down from the original spec's five, since
`help_requests` is now extended rather than duplicated — Section C), plus
the Section A3 data step on `communities` and the Section C column
additions on the existing `help_requests` table.

### 1. `whatsapp_identities`

- **Purpose:** links a WhatsApp phone number to a canonical TrustHub
  identity (Section F).
- **PK:** `id bigint identity`.
- **FKs:** `profile_id → profiles.id` (`ON DELETE SET NULL`).
- **Constraints:** `phone_number UNIQUE NOT NULL`; `profile_id UNIQUE`
  (nullable-safe).
- **Indexes:** unique index on `phone_number`; index on `profile_id`.
- **RLS:** `service_role` only for all operations (Section J).
- **Why it belongs in Migration 1:** without it, no WhatsApp contact can
  ever be recognized as a returning person — the entry point for the
  entire product.

### 2. `conversations`

- **Purpose:** the channel-agnostic session container (Section G).
- **PK:** `id bigint identity`.
- **FKs:** `whatsapp_identity_id → whatsapp_identities.id`,
  `profile_id → profiles.id`, `community_id → communities.id`
  (all `ON DELETE SET NULL`).
- **Constraints:** `channel`/`status` `CHECK` enums.
- **Indexes:** `profile_id`, `whatsapp_identity_id`, `community_id`,
  `status`.
- **RLS:** owning profile SELECT or `service_role`; `service_role`-only
  writes.
- **Why it belongs in Migration 1:** required container for every message
  and the natural place to carry community/area context.

### 3. `conversation_messages`

- **Purpose:** individual message history (Section G), with webhook
  idempotency (A1).
- **PK:** `id bigint identity`.
- **FKs:** `conversation_id → conversations.id` (`ON DELETE CASCADE`).
- **Constraints:** `channel`/`direction`/`sender` `CHECK` enums;
  `provider_message_id` unique (nullable-safe).
- **Indexes:** `(conversation_id, created_at)`; unique index on
  `provider_message_id`.
- **RLS:** owning-profile SELECT (via parent) or `service_role`; insert
  `service_role`-only; append-only (no UPDATE/DELETE policy).
- **Why it belongs in Migration 1:** without it, there is no transcript —
  conversations would be a status with no content.

### 4. `contributions`

- **Purpose:** the single, generalized knowledge/provenance record
  (Sections H, I).
- **PK:** `id bigint identity`.
- **FKs:** `contributor_profile_id → profiles.id` (`ON DELETE RESTRICT` —
  carried-forward open risk, Section N); `business_id → businesses.id`,
  `community_id → communities.id`, `reviewed_by_profile_id → profiles.id`,
  `related_conversation_id → conversations.id` (all `SET NULL`);
  `related_help_request_id → help_requests.id` (`uuid`, `SET NULL`);
  `source_message_id → conversation_messages.id`
  (`SET NULL`, A2).
- **Constraints:** `contributor_profile_id NOT NULL`; `claim_text NOT
  NULL`; `verification_status` `CHECK` enum; `subject_type NOT NULL CHECK`
  enum (B4).
- **Indexes:** `contributor_profile_id`, `business_id`, `community_id`,
  `verification_status`, `related_conversation_id`,
  `related_help_request_id` (B3).
- **RLS:** contributor SELECT (own rows) or `service_role`;
  `service_role`-only writes.
- **Why it belongs in Migration 1:** the only place "I am a hairdresser" /
  "I know a plumber in Chinhoyi" / general local info can be captured at
  all — `business_information_updates` structurally cannot represent them.

### Extended existing table: `help_requests` (Section C)

- **Purpose:** the single, canonical "a specific ask, with a lifecycle"
  entity for the whole TrustHub ecosystem — reused instead of a fifth new
  table.
- **PK (existing, unchanged):** `id uuid`.
- **New FKs added:** `conversation_id → conversations.id`,
  `matched_business_id → businesses.id`, `matched_contribution_id →
  contributions.id` (all `ON DELETE SET NULL`).
- **New constraints added:** `intent`/`source_channel` `CHECK` enums.
  Existing `status` column is **not** constrained further (Section C).
- **New indexes added:** `conversation_id`, `matched_business_id`,
  `matched_contribution_id`, `(community_id, requested_category)`.
  Existing `community_id`/`status`/`requester_id` indexing (if any) is
  unverified and unchanged by this migration.
- **RLS:** see Section J — intended model defined, but must be reconciled
  with this table's current, unverified RLS state before execution.
- **Why extending it (not creating `service_requests`) belongs in
  Migration 1:** see Section C's full 12-criteria evaluation — in short,
  the verified schema shows near-complete structural overlap with what a
  new table would have contained, and zero rows means zero migration risk
  in extending it now rather than building and later reconciling a
  duplicate.

---

## M. Migration Order

1. **Schema changes/new tables**, in dependency order:
   1. `whatsapp_identities`
   2. `conversations`
   3. `conversation_messages`
   4. `contributions` — **including** `related_help_request_id` from the
      start (no post-creation `ALTER` needed, since `help_requests`
      already exists live, unlike the original spec's `service_requests`
      design which required a two-phase creation).
   5. `ALTER TABLE help_requests ADD COLUMN conversation_id ...,
      requested_category ..., intent ..., area ..., matched_business_id
      ..., matched_contribution_id ..., source_channel ...;` (Section C) —
      run after `conversations`, `businesses` (existing), and
      `contributions` all exist, since three of the seven new columns
      reference them.
   6. All indexes (Sections L / B3), created alongside each table/column.
   7. RLS enabled + policies applied per Section J (not executed by this
      document — only after explicit approval of the actual policy SQL,
      and after reconciling `help_requests`'s current RLS state per
      Section C, criterion 9).
2. **Required seed/bootstrap data:** the Section A3 `communities` INSERT
   for Harare and Chinhoyi — executed immediately after step 1, as its own
   reviewed, idempotent DML step.
3. **Validation:** confirm all four new tables, the seven new
   `help_requests` columns, and their constraints exist as specified;
   confirm the two `communities` rows exist exactly once each; confirm
   `help_requests`'s pre-existing rows (still zero, expected) and its
   pre-existing columns are untouched; spot-check that RLS is enabled and
   default-deny blocks anon/authenticated access as expected while a
   `service_role`-authenticated test insert succeeds; confirm no other
   existing table's row count or schema changed.
4. **Application integration:** swap the existing `NotConnectedError` mocks
   (`lib/trusthub`, `lib/conversations`, `lib/requests`,
   `lib/contributions`, `lib/identity`) for real, Supabase-backed
   implementations — staged/feature-flagged, not all at once, and only
   after steps 1–3 are confirmed successful. `lib/requests` now targets
   `help_requests` instead of a `service_requests` table.

## N. Rollback

Exact reverse order (updated — `help_requests` is now altered, not
created, so rollback reverts its added columns rather than dropping a
table; the original two-phase `contributions` cross-reference is gone
since `related_help_request_id` was created directly, so there is no
separate "drop the added column first" step for `contributions` either):

1. `ALTER TABLE help_requests DROP COLUMN conversation_id, requested_category,
   intent, area, matched_business_id, matched_contribution_id,
   source_channel;`
2. Drop `contributions`.
3. Drop `conversation_messages`.
4. Drop `conversations`.
5. Drop `whatsapp_identities`.

**Irreversible/data considerations:**
- No existing table's *pre-existing* columns are altered, so rollback
  never touches `profiles`, `businesses`, `communities`, or
  `help_requests`'s original shape — only the 7 columns added to
  `help_requests` by this migration are reverted.
- The two `communities` bootstrap rows (Harare, Chinhoyi) are **not**
  deleted by this rollback sequence — they are harmless, valid rows in an
  existing, reusable table, and other future features may still want them
  to exist regardless of this migration's fate. If a full rollback
  including the seed data is genuinely required, that is a separate,
  explicit decision (delete-by-id), not an automatic part of schema
  rollback.
- If real conversations/messages/contributions/requests have been created
  before a rollback is attempted, dropping these tables (and the added
  `help_requests` columns) **destroys that data** — there is no
  data-preserving rollback path once real usage exists; this is expected
  and acceptable only while the tables are still empty/in initial
  validation (Section M, step 3), not after real traffic. Because
  `help_requests` itself pre-exists this migration, rolling back its added
  columns after real WhatsApp-originated requests have been written would
  silently discard exactly the data those columns hold (conversation
  links, match candidates) while leaving the pre-existing row shape
  intact — a partial-data-loss scenario that did not exist in the original
  five-new-table design (where the whole table was dropped, not just
  columns on a shared, pre-existing table). This is a direct, accepted
  consequence of extending an existing table rather than creating a new
  one, and must be understood before approving Section C.

---

## FINAL HUMAN APPROVAL REQUIRED

1. **[ ] Confirm the final table set** (Section L — **four** new tables
   plus the extended `help_requests`, no more, no less) is correct and
   complete.
2. **[ ] Confirm the three MUST CHANGE items** (A1 `provider_message_id`,
   A2 `source_message_id`, A3 community bootstrap step) as specified.
3. **[ ] Confirm each Section B disposition individually** — especially
   **B5 (`escalated_to_profile_id`) = DEFER**, since this reverses the
   review's earlier recommendation and should be explicitly re-confirmed,
   not silently accepted.
4. **[ ] Confirm the Section C decision** — **extend `help_requests`**
   with 7 nullable columns rather than creating a `service_requests`
   table — including the deliberate choice to reuse `requester_id`
   instead of adding a new identity column.
5. **[ ] Confirm Section D's accepted limitation** (single current match
   only, no history table, now living on `help_requests`) is acceptable
   for the pilot.
6. **[ ] Confirm Section E's normalization convention** is understood as
   an application-layer contract, not a database constraint, and will be
   implemented consistently wherever `area` is written (including the new
   `help_requests.area` column).
7. **[x] RESOLVED, CORRECTED — Section F identity-provisioning design.**
   Confirm the real-phone-number design (E.164 lookup against
   `whatsapp_identities.phone_number` → `auth.users.phone` → provision via
   `auth.admin.createUser({ phone, phone_confirm: true })`, no synthetic
   placeholder identifier) as the definitive mechanism. Identity
   provisioning is an **application requirement**
   (`lib/identity`'s `IdentityProvisioner`/`IdentityResolver`), not a
   migration requirement — no `auth` schema change accompanies this
   decision. In particular, confirm acceptance of the explicit design
   choice to treat WhatsApp provider delivery as the basis for
   `phone_confirm: true` (Section F's stated distinction between channel
   delivery verification and Supabase Auth phone verification).
8. **[ ] Confirm Section I's decision** that no outreach-tracking
   primitive is needed for the first version of the loop.
9. **[ ] Confirm Section J's RLS model conceptually** — actual `CREATE
   POLICY` statements still need to be written and separately reviewed
   before RLS is ever enabled for real.
10. **[ ] Explicitly acknowledge the carried-forward, unresolved risks:**
    `reviews`/`business_hours` RLS still disabled (independent security
    task); `contributions.contributor_profile_id ON DELETE RESTRICT`
    still an open policy choice; message-retention policy for
    `conversation_messages.content` still undecided; Case 4's accepted
    dual-identity limitation and its manual-merge gap (Section F) —
    both explicitly documented limitations, not defects, but still
    unresolved until their respective future enhancements are built.
11. **[ ] NEW — verify `help_requests`'s actual, current RLS state**
    (enabled/disabled, and any existing policies) before execution —
    unlike the four brand-new tables, this table's RLS is inherited, not
    designed from zero (Section C, criterion 9).
12. **[ ] NEW — verify `communities.id` and `businesses.id`'s actual
    column types** before execution — `help_requests.community_id` being
    `uuid` (VERIFIED) raises the possibility that `communities.id`/
    `businesses.id` are `uuid`, not the `bigint` assumed throughout the
    rest of this spec's new tables (Section C, criterion 5). If so, every
    `bigint` FK to those two columns elsewhere in this document needs
    retyping before DDL is generated — not resolved in this pass, since it
    falls outside this task's scope (the request-model decision only).
13. **[ ] NEW — verify `service_role` actually bypasses `help_requests`'s
    existing `auth.uid() = requester_id` INSERT policy** as standard
    Supabase/Postgres behavior predicts (Section F) — a cheap, standard
    sanity check, but one this design explicitly relies on.
14. **[x] RESOLVED — confirmed: no Postgres trigger exists on
    `auth.users`** that automatically creates a `profiles` row (VERIFIED).
    The `IdentityResolver`/`IdentityProvisioner` (Section F) must
    therefore explicitly create the `profiles` row itself every time it
    resolves or provisions an identity — this is now a stated application
    requirement, not an open question.
15. **[ ] Give explicit go-ahead to generate the actual migration SQL** —
    this document is the last step before that, and SQL generation does
    not begin until this checklist is signed off.
