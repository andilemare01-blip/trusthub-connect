# TrustHub Connect build status

_Updated: 2026-09-29, seed candidate evaluation and provenance foundation._

## Implemented

- Trusted, server-only Supabase callers validate required URL and secret
  configuration and fail explicitly when unavailable. Secret keys are not
  imported by client modules.
- The Meta WhatsApp Cloud API adapter verifies webhook HMAC signatures,
  validates inbound structure, normalizes sender/timestamp/message IDs, and
  supports outbound text. Inbound media is stored as metadata; transcription
  and image interpretation are not claimed.
- Webhook responses use correlation IDs; logs include event, outcome and
  provider message ID without phone numbers, message text or credentials.
- Persistent conversation and message repositories preserve coordinator
  state, source/provenance details, request context, media metadata and
  provider message IDs. Duplicate message IDs are guarded in the repository
  and coordinator.
- Live discovery reads the existing `businesses` and `knowledge_records`
  independently. Knowledge results require an approved source, a business or
  service record, and an exact city match. Area/country filters are strict;
  verification is never upgraded. Contact, service, opening-hour and source
  details are retained.
- Natural-language request parsing has no fixed city whitelist and asks for a
  city when absent. Replies distinguish source, verification and confidence.
- The WhatsApp path runs a structured deterministic understanding adapter
  for request, location, urgency, answerability, contributions and escalation.
  It reports AI as unavailable and never fabricates local facts; a model
  provider remains unconfigured.
- Explicit provider recommendations and self-capability statements are
  extracted conservatively, preserve their exact original message, and are
  stored as `declared` contributions linked to the canonical contributor,
  community (when resolved), conversation and unique source message.
- Media inputs receive an honest text clarification when transcription or
  vision is unavailable.
- Additive Migration 001 is applied. It created `whatsapp_identities`,
  `conversations`, `conversation_messages`, and `contributions`, extended the
  existing `help_requests`, and reused the existing `communities` table.
- Additive Migration 002 is applied. It adds a nullable unique source-message
  constraint so webhook retries cannot create duplicate contributions.

## Current boundary

- Meta credentials and WhatsApp account configuration are not present, so the
  provider is not live or externally tested.
- First-time WhatsApp senders are not auto-provisioned. The canonical TrustHub
  Auth-to-profile creation flow still needs confirmation and integration;
  unknown senders receive `account_link_required`. The system does not create
  a shadow identity.
- Human/community outreach still requires a real notification/agent handoff
  provider. Consent and pending state are tracked; no notification is sent.
- The AI route remains an unconfigured placeholder; no AI provider is wired.
- `/admin` remains placeholder UI and is not a production-secure admin
  surface.
- Live Supabase security advisors report pre-existing exposed
  `SECURITY DEFINER` RPCs, mutable search paths on legacy functions, and
  disabled leaked-password protection. These TrustHub-wide findings were not
  altered by Connect. The new WhatsApp identity table intentionally has
  default-deny RLS with no client policy.
- Current live catalog checks show RLS enabled on `reviews` and
  `business_hours`, with public SELECT policies (and authenticated own-row
  review writes). This corrects older recon text that reported RLS disabled;
  Connect did not change these policies.
- Existing TrustHub discovery view was not used because it does not filter
  source reuse status. The adapter directly gates the canonical knowledge
  source relation.
- Added a candidate-only seed evaluator for Overture, OpenStreetMap,
  community, manual and registry evidence. It normalizes names, retains the
  original source reference/retrieval time/payload, and defaults external
  directory/map records to `POTENTIAL` and unverified.
- Location normalization accepts structured city input or a known Zimbabwe
  locality as its own address component. It will not derive a city from a
  road/route name; unresolved or conflicting locations require review.
- Deduplication returns advisory create/enrich/duplicate/review decisions.
  It uses source ID, normalized name, city, phone, website, address and
  coordinates conservatively. Similar names alone require review. Enrichment
  proposes values only for canonical fields that are empty and surfaces
  conflicts without overwriting canonical data.
- The evaluator has no database client or writer. No Overture/OSM feed is
  connected and no seed/correction records were imported or changed in
  Supabase. Community candidates remain `DECLARED`; the existing approved
  source gate in discovery remains in effect.
- Added deterministic community-intelligence helpers: explicit-consent,
  city-scoped community-help requests with an idempotent repository port;
  exact-community and availability-aware Trust Agent ranking; privacy-aware
  repeated/unanswered-demand gap detection; explicit-confirmation outcome
  metrics; and opt-in/frequency-limit outreach planning. These are
  application contracts and local logic, not new tables or live dispatch.
- Added a consent-first Trust Agent handoff provider interface and local fake
  with assignment status acknowledgement; no assignment database, agent
  directory, or real dispatch is connected.
- Added a deduplicating fake notification provider and validated runtime
  audit-event contract that rejects sensitive attribute names and non-scalar
  payloads. No production event sink or notification delivery is configured.
- Added an injectable deterministic answer generator. It formats only
  resolver evidence and preserves evidence IDs, provenance, confidence and
  uncertainty; it does not add local facts.
- The WhatsApp fake can now simulate parse and send failures. The real Meta
  provider remains credential-gated.

## Phase readiness

- **Phase 2 — server caller and persistent state: implemented; live operation
  blocked.** The Meta webhook boundary verifies signed raw payloads before
  parsing, uses a server-only Supabase client, resolves an existing linked
  profile, persists conversation/message state and contribution provenance,
  and deduplicates sequential provider retries. The conversation repository
  is injectable for tests. Live database access cannot be checked in this
  environment because no Supabase server credential is configured. First
  time users still need TrustHub's approved sign-up/account-link policy.
- **Phase 3 — WhatsApp provider: implementation complete; Meta connection
  blocked.** The provider handles signed inbound payloads, text and media
  metadata, normalized sender/message/time fields, outbound text and delivery
  IDs. Fakes exercise the application path. Meta app/account configuration
  and credentials are absent, so live delivery and webhook subscription are
  unverified.
- **Phase 4 — AI and orchestration: deterministic foundation implemented;
  real AI/community operations blocked.** Intent, city/category, urgency,
  clarification, contribution detection, provenance, answer resolution and
  consent-gated community/human escalation work without model-generated local
  facts. Demand-gap/outcome computation, consent-aware request construction,
  local agent ranking and notification/audit ports are implemented. A real
  model, persistent community-help queue/notifier and agent assignment store
  are not connected.
- **Seed persistence: candidate evaluation implemented; discovery feeds and
  writes deferred.** Overture/OSM retrieval and a reviewed persistence path
  remain unconnected. The evaluator has no writer by design, and no external
  record is promoted to verified.

## Configuration required for an actual WhatsApp deployment

Set server-side `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or the legacy
`SUPABASE_SERVICE_ROLE_KEY`), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
and `WHATSAPP_GRAPH_API_VERSION`. `SUPABASE_PUBLISHABLE_KEY` is used only by
authenticated user-facing callers. No values are included in the repository.

## Verification

Latest verification: `npm test` 75/75 passed; `npm run lint`,
`npx tsc --noEmit`, `npm run build` (Next.js 16.3.6), and
`git diff --check` all passed. Coverage includes community-help consent and
idempotency, exact-community agent matching, explicit-outcome metrics,
knowledge gaps, opt-in/frequency enforcement, notification deduplication,
privacy-safe audit events, and evidence-grounded response generation, plus
locality/road-name handling,
seven city-local search cases, sparse and unknown locations, external and
community provenance, conservative dedup/enrichment, the
existing source approval gate, unavailable database configuration, the
RLS contract in Migration 001, and WhatsApp identity repeat-link/conflict
and no-name-guess behavior. No live seed import, WhatsApp send or real
sender identity provisioning was attempted.

## Exact next manual step

Confirm the canonical policy for first-time WhatsApp users: should the
verified WhatsApp phone provision a Supabase Auth user and TrustHub profile,
or should users link an existing profile through TrustHub's authenticated
flow? Then provision the appropriate existing credentials, deploy the route
at a public HTTPS URL, configure the Meta webhook callback and `messages`
subscription, and link the pilot sender to its canonical profile. Until those
steps are done, use local fakes/tests; the public Meta flow cannot complete a
first-time user conversation.

Run `npm run build` from the repository root for the next local build check.

## Identity/community continuation — 2026-09-29

### IMPLEMENTED

- The current WhatsApp route resolves the normalized inbound number through
  the server-side Supabase `whatsapp_identities` repository and loads the
  canonical TrustHub profile. The applied migration enforces unique phone
  numbers and unique non-null profile links.
- Unknown/unlinked numbers remain `account_link_required`. No email/name
  matching or WhatsApp-only profile creation occurs.
- Tests cover existing mapping resolution, unresolved senders, repeat linking,
  conflicting profile rejection, and no display-name-based identity guess.

### BLOCKED

- First-time Auth provisioning and user-facing phone linking require an
  approved Auth/identity-proof flow. No such proof route or web UI exists.
- Persistent community-help requests remain blocked: the existing
  `help_requests` repository supports service request persistence, but a
  consent-aware community share needs durable consent evidence plus a safe
  idempotency constraint. No verified migration adds these fields/constraints.
- No schema change was made because the Supabase CLI is unavailable here; the
  Supabase workflow requires creating migrations through that CLI.

### UNKNOWN

- Supabase phone Auth/provider settings, Auth hooks/profile creation behavior,
  detailed live `help_requests` constraints and policies, and current live
  project migration state were not revalidated.
- `SUPABASE_URL`, server secret credentials, and Meta credentials were not
  available in this environment. No live Supabase/Meta call or deployment was
  performed.

**Continuation verification:** `npm test` — 75/75 passed; `npm run lint` —
passed; `npx tsc --noEmit` — passed; `npm run build` — passed (Next.js
16.3.6); `git diff --check` — passed. No migration syntax or Supabase
advisor check was run because no migration was created and the Supabase CLI
is unavailable.

## Persistent help-request processing continuation — 2026-09-29

### IMPLEMENTED

- The persistent request read model now reports `timeToUsefulAnswerSeconds`
  for resolved requests by deriving it from `created_at`/`resolved_at` with the
  same guards as the outcome-metrics aggregation; unresolved or malformed rows
  still return `null`. No new column or migration is required.
- Idempotent request creation now also compares `area`, so an idempotency key
  replayed for a different area is reported as a conflict instead of silently
  returning a different logical request.
- Outcome recording (`help_request_outcomes` upsert plus lifecycle sync) and the
  durable community-help consent adapter are now covered by tests: one outcome
  row per request, only a confirmed resolution closes a request, consent
  evidence is written once and never overwritten, cross-community replay is
  rejected, and a request without consent evidence is never exposed.

### BLOCKED

- The columns/tables this path depends on are specified by the checked-in
  migrations `20260929114103_trusthub_connect_consent_requests_outcomes_audit.sql`
  and `20260929114650_connect_help_requests_consent_outcomes_security.sql`.
  They remain unverified against the live database, and no Supabase CLI,
  server credential or live-schema inspection exists in this environment, so
  nothing was created or applied. The application fails closed on a missing
  schema instead of assuming one.
- RLS/grant verification, Meta credentials, first-time account linking, and a
  real AI provider remain blocked exactly as before.

**Verification:** `npm test` — 90/90 passed; `npm run lint` — passed;
`npx tsc --noEmit` — passed; `npm run build` — passed (Next.js 16.3.6).

## Live-schema alignment of the persistent help-request path — 2026-09-29

The owner verified the live TrustHub Supabase project (`bygtmzwsmwsibtruzbcc`):
the Connect migration history already contains migrations 001/002 plus the
consent/requests/outcomes/audit, consent-outcomes-security and
help-request-status-contract migrations, and the live `help_requests` table
already carries the idempotency and consent columns with a unique
`idempotency_key`. No migration was re-applied and no database object, policy or
grant was changed in this session.

### IMPLEMENTED

- Audited every Supabase repository against that verified live schema: the
  request, identity, conversation, contribution, agent-handoff, outcome and
  runtime-event adapters read and write only columns that exist live, use the
  live UUID/bigint identifier types, stay inside the live status/channel/
  sender/event CHECK values, and keep the RLS posture (service-role writes only
  for `help_request_outcomes`, `trust_agent_assignments` and
  `connect_runtime_events`). No column is invented and no unused live column is
  written with a fabricated value.
- Fixed the one provable mismatch: the durable community-help adapter no longer
  attempts to attach consent evidence to an existing `help_requests` row — the
  live `connect_help_request_evidence_guard` trigger rejects that update with
  SQLSTATE 23514. A community share now only reuses the canonical request that
  already carries atomic consent, and refuses the share with a clear validation
  error when the request has no consent or belongs to another community. No
  statement that the database must reject is sent, and the canonical
  title/description are no longer rewritten.
- Tests mirror the live trigger and record every attempted UPDATE, proving the
  share path issues zero writes.

### BLOCKED

- A real database read/write check is still impossible here: no `.env` and no
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY` exist in this environment, so the server
  client fails closed and only the local contract tests run. Provisioning a
  server credential is the gate for an end-to-end live run.

### EXACT NEXT STEP

- `SupabaseServiceRequestRepository.recordOutcome()` has no production caller:
  the conversation engine has no explicit requester confirmation turn, so no
  request ever reaches `answered`/`matched`/`unanswered`. Adding that
  explicit-confirmation step (and recording the confirmed match into the existing
  live `matched_business_id`/`matched_contribution_id` columns) is the next
  implementation step; it needs no schema change.
- Owner attention: the live INSERT guard requires an idempotency key plus consent
  evidence on every new `help_requests` row, which also applies to non-Connect
  TrustHub writers. Connect always supplies both; any other writer must be
  checked before it starts failing.

**Verification:** `npm test` — 93/93 passed; `npm run lint` — passed;
`npx tsc --noEmit` — passed. No migration, DDL, policy, grant or live database
change was made.
