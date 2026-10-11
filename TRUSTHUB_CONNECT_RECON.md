# TrustHub Connect Reconnaissance

Read-only inspection of the existing canonical TrustHub project at
`C:\Users\inahm\trusthub`. No files in that project were modified. No database
connection was made — all findings below are derived from static reading of
source files only. `.env.local` was opened only to confirm which **variable
names** exist; the actual secret values are intentionally **not** reproduced
anywhere in this document.

Where something could not be verified from the available code, it is marked
**UNKNOWN**.

---

## A. Existing TrustHub Architecture

- Next.js app (`^15.5.26` per `package.json`, though `node_modules`/lint config
  shows a 16.x-era `eslint-config-next`), **Pages structure uses the App
  Router** under `src/app`, TypeScript, Tailwind CSS (`tailwindcss` +
  `@tailwindcss/postcss`).
- `package.json` name: `trusthub`, version `1.0.0`.
- Dependencies of note: `@supabase/supabase-js`, `@duckdb/node-api`, `express`,
  `cors`, `dotenv`, `server-only`, `tsx`. **No WhatsApp SDK (e.g. Twilio,
  `whatsapp-web.js`, Meta Cloud API client) and no AI provider SDK (OpenAI,
  Anthropic, etc.) are present** — confirms WhatsApp/AI are not yet built here.
- `src/` layout:
  - `app/` — route segments (one folder per route, `page.tsx` per route,
    some `api/` route handlers)
  - `components/` — currently only `notifications/` (a `NotificationCentre`
    component)
  - `data/` — static/seed data (`businesses/`, `reviews/`) used as
    **client-side fallback data**, not the primary data source
  - `lib/` — `supabase.ts` client, `location/`, `trust/`, `business-seeding/`,
    `language.ts`, `updateProfileStats.ts`
  - `types/` — only `types/business.ts` (a `Business` interface)
  - `utils/` — `trustJourney.ts` (trust points/level calculator)
- No `middleware.ts` found at the project root or in `src/` — **route
  protection is done entirely client-side**, per-page, by calling
  `supabase.auth.getUser()` inside `useEffect`.
- No `.sql` migration files were found in the repository — schema is managed
  outside the repo (Supabase dashboard/CLI elsewhere), so exact column types,
  constraints, and indexes are **UNKNOWN** beyond what application code
  reveals.

## B. Existing Supabase/Data Evidence

- Single shared browser client: `src/lib/supabase.ts`
  ```ts
  export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  ```
  Imported via the path alias `@/lib/supabase` throughout the app.
- A **separate, server-only privileged client** pattern exists in API routes,
  e.g. `src/app/api/admin/contributions/route.ts`, which builds two clients
  per request: one with the anon key (`supabaseAuth`, used only to validate
  the caller's access token) and one with `SUPABASE_SERVICE_ROLE_KEY`
  (`supabaseAdmin`, used for the privileged query). The service role key is
  never sent to the client.
- Confirmed table names referenced via `.from(...)` calls in application code:
  - `profiles`
  - `businesses`
  - `reviews`
  - `review_helpfulness`
  - `business_hours`
  - `business_claims`
  - `business_information_updates`
  - `admin_users`
  - `referral_partners`
  - `referral_events`
  - (`notifications` — inferred strongly from a fully-typed
    `TrustHubNotification` shape in `src/app/profile/page.tsx`, but no direct
    `.from("notifications")` call was located in the files opened; treat the
    **exact table name as UNKNOWN-but-likely**.)
- No table for WhatsApp, conversations, messages, service requests,
  provenance/evidence, community demand, or agent/service-area matching exists
  anywhere in the codebase.

## C. Existing Authentication and Identity

- Auth = **Supabase Auth (email + password)** only. `signup/page.tsx` calls
  `supabase.auth.signUp({ email, password })`; `login/page.tsx` calls
  `supabase.auth.signInWithPassword(...)`.
- After sign-up, the user is routed to `/create-profile` to collect: name,
  profile picture, intro, country, city, area, and location method
  (`current` vs `manual`). This is where the **community location** is first
  established for a user.
- `profiles` table (inferred fields from `admin/users/page.tsx` and
  `profile/page.tsx`):
  `id`, `user_id`, `name`, `location`, `trust_level`, `trust_points`,
  `created_at` (admin list view) plus `intro`, `language`, `joinedAt`,
  `profileImage`, `trustId` referenced in the profile page's local `Profile`
  type (some of these may be client-only state rather than actual columns —
  **UNKNOWN** which of these are persisted vs. derived).
- **Significant identity risk found:** a large amount of profile/location
  state is cached in **`localStorage`**, not exclusively Supabase:
  - `trusthub-profile`, `trusthub-signup-profile-image`,
    `trusthub-home-community`, `language`, `trusthub-reviews`.
  - `src/lib/updateProfileStats.ts` mutates `trusthub-profile` in
    `localStorage` directly (reviews/businessesAdded counters), independent of
    any Supabase write.
  - `src/lib/location/community-location.ts` reads/writes the "home
    community" exclusively via `localStorage` (`getSavedCommunityLocation`,
    `saveCommunityLocation`, `saveActiveCommunityLocation`), with an explicit
    comment that the community key is **never** trusted from stored data and
    is always recomputed from `country/city/area`.
  - This means **today's TrustHub does not have a single persistent,
    server-side source of truth for "current community"** — it's
    reconstructable from `profiles.location` server-side, but the richer
    `country/province/city/area/communityKey` structure lives only in the
    browser. This is directly relevant to the WhatsApp identity-linking
    requirement (see Section I).
- No JWT/session inspection beyond Supabase's own; no custom claims or
  role field on the `profiles` table were observed. Role/authorization for
  admin is a **separate allow-list table** (`admin_users`), not a claim on the
  user or profile.
- A `journey-started` page displays a hardcoded example "TrustHub Identity"
  code (`ZW-065432`). No code was found that actually generates or persists a
  human-readable TrustHub ID like this — **appears to be static/placeholder
  UI copy, not a real identity system**. Mark as **UNKNOWN/likely not
  implemented**.

## D. Existing Businesses, Services and Reviews

- `src/types/business.ts` defines a **camelCase** `Business` interface
  (`trustScore`, `businessVerified`, `ownerClaimed`, `openingHours`, `photos`,
  `highlights`, etc.) used for the static/local fallback data in
  `src/data/businesses/*`.
- Live Supabase queries (`admin/businesses/page.tsx`, `business/[id]/page.tsx`)
  use a **snake_case** shape instead: `category`, `subcategory`, `province`,
  `city`, `area`, `address`, `phone`, `trust_score`, `business_verified`,
  `owner_claimed`, `created_at`. There is **no shared/generated type** that
  unifies the two naming conventions — each file declares its own local type.
  This split (camelCase static data vs snake_case DB rows) is a real
  source of duplication/confusion that TrustHub Connect should avoid
  repeating.
- Categories/subcategories are **free-text strings** on the business row —
  there is no separate `categories` table/enum found anywhere in the code.
  **UNKNOWN** whether one exists in the database outside of code references.
- Reviews: `reviews` table holds `business_id`, `user_id`, `rating`,
  `comment`, `created_at` (from the insert in `review/[id]/page.tsx`). The
  business detail page also reads local/static reviews and merges them
  client-side with Supabase reviews — i.e. **reviews are not fully
  server-authoritative today**, static demo data can appear mixed with real
  reviews.
- `review_helpfulness` table holds `review_id`, `user_id`, `value`
  (`"up" | "down"`), read via `.select("review_id, user_id, value")`.
- `business_hours` table holds `business_id`, `day_of_week`, `opens_at`,
  `closes_at`, `is_closed`, `created_at`.
- Trust score calculation: `src/lib/trust/businessTrustScores.ts` computes a
  score client/server-side from the average of `reviews.rating` (not stored
  as a running aggregate anywhere observed — computed on demand).
- `src/lib/trust/../utils/trustJourney.ts` computes a **user-level** trust
  score (`trustPoints`, `trustLevel`, `trustProgress`) from
  `reviews` count and `businessesAdded` count — this is distinct from the
  business trust score above.

## E. Existing Communities and Location

- `src/lib/location/community-location.ts` is the canonical location-key
  logic:
  - `communityKey` = `country:city:area`, all lower-cased,
    non-alphanumerics replaced with `-` (province deliberately excluded from
    the key).
  - Helper functions: `normaliseLocation`, `normaliseLocationPart`,
    `createCommunityKey`, `createCommunityLocation`,
    `createEmptyCommunityLocation`, `getSavedCommunityLocation` (reads from
    `localStorage`, not the database).
- There is **no dedicated `communities` table observed** in code — community
  identity is currently a derived string key, not a persisted row with its
  own id/metadata (population, active user count, etc.). The `/communities`
  route (`src/app/communities/page.tsx`) and `/api/communities/seed` route
  exist for **business seeding by location**, not for managing a community
  entity itself.
- `src/app/api/communities/seed/route.ts` simply re-exports a `POST` handler
  from another module (`src/lib/business-seeding/orchestrator.ts` chain) —
  the actual seeding logic lives in `lib/business-seeding/`.
- Location detection UI exists at `src/app/location/page.tsx` (not fully
  read line-by-line, but present) supporting both device geolocation
  ("current") and manual entry.

## F. Existing Contributors/Agents

- `src/app/agents/page.tsx` (also reachable as "Partner" dashboard) reads a
  **`referral_partners`** row for the logged-in user
  (`user_id, partner_code, display_name, status, created_at`) and
  **`referral_events`** rows (`partner_id, event_type, created_at`,
  event types at least include `"visit"` and `"signup"`).
- Admin-side partner management: `src/app/admin/partners/page.tsx` — lists
  all `referral_partners` and all `referral_events`, computes active/pending
  counts and total visits/signups.
- This is a **referral/distribution-partner** concept (partner code, status
  `active|pending|suspended`), not the same thing as a "TrustHub Agent" who
  would field WhatsApp requests or verify businesses in person. There is
  **no evidence of a WhatsApp-facing "agent" concept** anywhere in the repo.
- `business_claims` table (`admin/claims/page.tsx`) captures a different kind
  of "contributor": someone claiming ownership of a business
  (`applicant_name, role, phone, whatsapp, email, verification_notes,
  status, submitted_at, reviewer_notes`), with status values `pending`,
  `contacted`, `verified`, `rejected`, `call_again`. Notably this table
  **already stores a WhatsApp number** for a claimant, even though there is
  no WhatsApp messaging integration — this is the closest existing artifact
  to a "WhatsApp-linked identity."
- `business_information_updates` table (surfaced in the UI as "Contributions")
  stores community-submitted field corrections: `business_id, user_id,
  business_name, field_name, suggested_value, source, evidence_notes,
  status, created_at`. This is effectively a **provenance/evidence pattern
  already in production** (field_name + suggested_value + source +
  evidence_notes + status) — highly relevant prior art for TrustHub Connect's
  future provenance/evidence tracking.

## G. Existing Discovery/Seeding

- `src/lib/business-seeding/` is a full pipeline:
  - `types.ts` — `SeededBusiness`, `BusinessSeedSource`
    (`overture | openstreetmap | google | community | manual`),
    `BusinessSeedConfidence` (`high | medium | low`).
  - `orchestrator.ts` — merges results from Overture Maps, OpenStreetMap, and
    Google (via `overture-server.ts`, `openstreetmap.ts`, `google.ts`),
    deduplicates (`dedupe.ts`), normalizes (`normalize.ts`), and persists via
    `supabase.ts` (`getCommunityBusinesses`, `saveSeededBusinesses`,
    `acquireCommunitySeedLock`, `releaseCommunitySeedLock` — implies a
    **seed-lock mechanism**, likely a table tracking in-progress seeding per
    community, exact table name **UNKNOWN**, not opened).
  - `source-registry.ts`, `index.ts` — orchestration wiring.
- Static fallback business data exists per-city in `src/data/businesses/`
  (`harare.ts`, `bulawayo.ts`, `chiredzi.ts`, `masvingo.ts`, plus a generic
  `businesses.ts` and `localBusinesses.ts`, and a deprecated
  `businesses.old.ts`). This is demo/seed data, **not** meant to be reused
  as-is by TrustHub Connect.
- `/api/communities/seed` (`POST`) triggers the orchestrator for a given
  community/location.

## H. What TrustHub Connect Can Reuse

- **Supabase project** itself — same `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` variable
  *names* (not values — TrustHub Connect must get its own credentials
  provisioned by the user when the time comes; do not assume a shared
  Supabase project is appropriate without explicit approval).
- **`profiles` table and Supabase Auth** as the persistent user identity —
  this is the natural anchor for "same person on WhatsApp and web."
- **`businesses`, `reviews`, `review_helpfulness`, `business_hours`,
  `business_claims`** as the existing discovery/trust data TrustHub Connect
  should read from (not duplicate) when answering WhatsApp questions about
  businesses/services.
- **`business_information_updates`** as an existing, working
  provenance/evidence-submission pattern — the eventual WhatsApp-driven
  "community contribution" and "service request evidence" flows should
  follow (and ideally extend, not replace) this same shape:
  field/value/source/evidence_notes/status.
- **`admin_users`** allow-list pattern for authorization — the same pattern
  (a table of authorized user ids, checked server-side with the service-role
  key) is the right building block for TrustHub Connect's future
  OWNER/TRUST_AGENT access control, rather than inventing a new mechanism.
- **`community-location.ts`** key derivation logic (`country:city:area`) as
  the starting convention for a future real `communities` table's natural
  key — but it needs to move from `localStorage`-only to a persisted,
  server-side concept for WhatsApp use (a phone-first user has no browser
  `localStorage`).
- **`referral_partners` / `referral_events`** as prior art for tracking
  distribution/agent activity and events, useful conceptually for future
  agent/service-area matching and activity dashboards — but it models
  *referral marketing*, not *operational service matching*, so it likely
  needs a distinct new structure rather than reuse.
- **Business seeding pipeline concepts** (source, sourceConfidence,
  dedupe, seed-lock) as a pattern to follow if/when TrustHub Connect needs to
  enrich or query business data, without rebuilding a second seeding system.

## I. What TrustHub Connect Will Eventually Need

(Conceptual needs only — **no schemas are proposed or created here**.)

- A way to link a **WhatsApp phone number** to an existing (or newly created)
  TrustHub `profiles` row, so the same person is recognized whether they
  arrive via WhatsApp first or via the web app first. Today's TrustHub has no
  phone-number-keyed identity path at all (auth is email/password only); the
  only phone number currently stored anywhere is the ad hoc `whatsapp` field
  on `business_claims`, which is unrelated to end-user identity.
- WhatsApp conversation/session state (distinct from a single message log) —
  does not exist today.
- Message history — does not exist today.
- Service requests (a community member asking for a service/business they
  couldn't find) — does not exist today; closest analog is
  `business_information_updates`, which is about *correcting* existing
  business data, not *requesting* something absent.
- A persisted `communities` concept (not just a derived string key) with its
  own identity, so metrics (adoption/demand/growth) can be aggregated and
  compared across Harare/Chinhoyi/others over time.
- Community questions / community demand signal capture — does not exist.
- Agent/service-area matching (which Trust Agent covers which community/
  service category) — does not exist; `referral_partners` is the nearest
  concept but models referral marketing, not operational coverage.
- "Successful match," "problem solved," and "time to useful answer" as
  first-class, measurable events — none of these are tracked anywhere today;
  all current metrics (trust points/level, business trust score) are
  computed from `reviews`/`businessesAdded` counts only.
- Community missions — no equivalent concept exists.
- Dashboard analytics tables/materialized views for the metrics used in the
  new `/admin` skeleton — none exist; current admin pages query live rows
  directly and compute counts/aggregates in the browser at request time.

## J. Proposed Data Relationships

No new tables or relationships are being created in this step. Conceptually,
based on confirmed evidence above, any future design should treat:

```
auth.users (Supabase Auth)
   └─ profiles (existing)              ← persistent TrustHub identity anchor
        └─ [future] whatsapp_identities  ← links a phone number to a profile
             └─ [future] conversations
                  └─ [future] messages
        └─ [future] service_requests
        └─ business_information_updates (existing) ← provenance/evidence pattern to extend
        └─ reviews (existing) ─┬─ review_helpfulness (existing)
                                └─ businesses (existing) ─┬─ business_hours (existing)
                                                           └─ business_claims (existing)
   └─ admin_users (existing)            ← authorization allow-list pattern to extend for OWNER/TRUST_AGENT
   └─ referral_partners (existing) ─ referral_events (existing) ← nearest analog to agent activity tracking
[derived, not persisted] communityKey = country:city:area  ← candidate natural key for a future communities table
```

This diagram is descriptive of what exists/what's implied, not a proposal to
build it yet.

## K. Admin Dashboard Data Requirements

For the `/admin` skeleton's placeholder metrics to eventually become real,
each will need a data source that **does not currently exist** in a
query-ready/aggregated form:

- Total Users, New Sign-ups, Active Users → aggregates over `profiles`
  (existing table, but "active" and "new" windows/definitions are UNKNOWN and
  undefined today).
- WhatsApp Conversations → requires the not-yet-built conversations/messages
  structures (Section I).
- Service Requests, Unanswered Requests → requires the not-yet-built service
  request structure.
- Problems Solved, Successful Matches, Time to Useful Answer → requires new
  event/outcome tracking not present anywhere today.
- Community Contributions → could map to `business_information_updates`
  (existing) plus any future community-question contribution type.
- Businesses / Services Added → maps to `businesses` (existing,
  `created_at`).
- Harare / Chinhoyi / Other Communities → requires a persisted `communities`
  concept (Section E/I) or, at minimum, grouping `profiles.location` /
  `businesses.city` values, which today are **free-text, not normalized**.
- Community Demand, Top Unanswered Requests, Recent Contributions, Recent
  Users, Recent Problems Solved, Agent Activity → all require the
  not-yet-built structures above; only "Recent Users" and "Recent
  Contributions" have an existing partial data source
  (`profiles`, `business_information_updates`).

## L. RLS/Security Concerns

- **No RLS policy source (SQL) exists in either repository** — RLS
  enforcement, if any, lives only in the Supabase project's database
  configuration and is **UNKNOWN/unverifiable from code**.
- Authorization for admin routes is done **client-side first**
  (`supabase.auth.getUser()` + a `.from("admin_users")` check performed with
  the **anon key** on the client in `admin/page.tsx`, `admin/users/page.tsx`,
  `admin/businesses/page.tsx`, `admin/partners/page.tsx`,
  `admin/claims/page.tsx`) — this only works safely if RLS on `admin_users`
  and every admin-readable table already restricts rows server-side;
  otherwise the client-side check is purely cosmetic. **Whether RLS actually
  restricts these tables is UNKNOWN from code alone.**
- The **service-role key is used** properly in at least one place
  (`/api/admin/contributions/route.ts`) — token is verified server-side
  before privileged queries. This is the correct pattern and should be the
  template for TrustHub Connect's own privileged admin endpoints, rather than
  the client-side-only pattern used by the older admin pages.
- Secrets are stored in `.env.local` (not committed — `.gitignore` present at
  repo root, contents not enumerated here). Variable **names** confirmed to
  exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. **Values were not copied into this document
  or any TrustHub Connect file.**
- No CSRF/rate-limiting/middleware protections were observed on API routes.

## M. Environment Variables Eventually Required

(Names only — values are never to be committed to source control regardless
of project.)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- WhatsApp provider credentials (exact names depend on chosen provider —
  e.g. Meta Cloud API vs Twilio — **not decided, UNKNOWN**)
- AI provider API key (provider **not decided, UNKNOWN**)

None of the above have been added to TrustHub Connect. TrustHub Connect does
not yet have its own `.env.local`/Supabase project connected.

## N. Risks and Unknowns

- **UNKNOWN**: exact full column list/types/constraints for every table
  above — only columns actually referenced in the code were confirmed.
- **UNKNOWN**: whether RLS policies exist and what they restrict.
- **UNKNOWN**: whether `notifications` is the real table name (inferred from
  a type shape only, no direct query site was located in the files opened).
- **UNKNOWN**: the exact seed-lock table name behind
  `acquireCommunitySeedLock`/`releaseCommunitySeedLock` (not opened).
- **UNKNOWN**: whether a `categories`/`services` table exists in the database
  even though none is referenced in application code (category/subcategory
  are free-text in all code paths seen).
- **UNKNOWN**: whether the "TrustHub Identity" code shown on
  `journey-started` (e.g. `ZW-065432`) is generated anywhere or purely
  decorative placeholder text.
- **Real risk identified**: significant profile/community state lives only
  in browser `localStorage` today (home community, cached profile stats,
  cached reviews). Any WhatsApp-first identity flow **must not** assume this
  client-side state is available or authoritative — the server-side
  `profiles` row (and a future `whatsapp_identities` link) must become the
  single source of truth to avoid duplicate/divergent identities.
- **Real risk identified**: two incompatible naming conventions for business
  data (camelCase static type vs snake_case DB rows) with no shared mapping
  layer — TrustHub Connect should not copy this pattern; it should read
  directly from the DB shape and define its own single set of types.
- Because there are no in-repo SQL migrations, TrustHub Connect cannot fully
  verify the production schema without direct (currently disallowed)
  Supabase access. Any future schema work must be validated against the real
  database, not assumed from application code alone.

## O. Recommended Implementation Order

(Recommendation only — nothing below is being built yet.)

1. Get explicit approval on identity architecture: how a WhatsApp phone
   number maps to a `profiles` row (new table vs. new column), including the
   "no duplicate identity" rule.
2. Get explicit approval on a persisted `communities` concept (vs. continuing
   to derive `communityKey` from free text) since the admin dashboard's
   geographic section depends on it.
3. Define the minimal service-request + conversation/message schema needed
   to support WhatsApp end-to-end, reusing the
   `business_information_updates` provenance pattern for evidence rather than
   inventing a new shape.
4. Define the event/outcome tracking needed for "successful match," "problem
   solved," and "time to useful answer" metrics before wiring the admin
   dashboard cards to real data.
5. Decide on the RBAC mechanism for `/admin` (extending `admin_users`-style
   allow-list vs. a new `role` concept) and implement it using the
   server-side-verified-token pattern already proven in
   `/api/admin/contributions`, not the older client-side-only checks.
6. Only after 1–5 are approved: connect Supabase, add environment variables,
   and begin schema/migration work.

---

## DO NOT BUILD YET

The following are deliberately postponed until reconnaissance and
architecture are reviewed and approved:

- Any Supabase connection from TrustHub Connect (client, server, or admin key)
- Any database tables, columns, or migrations
- WhatsApp provider integration/credentials
- AI provider integration/credentials
- Real authentication or session handling for `/admin` (currently no auth at
  all — must not be presented as secure)
- Persisted `communities` table/entity
- WhatsApp identity ↔ TrustHub profile linking logic
- Conversation/message storage
- Service request storage and lifecycle
- Community contribution/question storage (beyond what already exists in
  TrustHub as `business_information_updates`)
- Provenance/evidence schema beyond what already exists in TrustHub
- Community demand intelligence aggregation
- Agent/service-area matching logic
- Match success / problem-solved / time-to-useful-answer tracking
- Community missions
- Real dashboard analytics queries/materialized views (the `/admin` UI
  remains placeholder-only)
- Any reuse of TrustHub's Supabase project without explicit owner approval

---

## Current implementation addendum — 2026-09-29

The foregoing recon is a historical snapshot. Later project-owner briefs
authorized implementation and additive schema changes; this addendum records
the current state without rewriting that audit trail.

- The owner-approved target is the existing TrustHub project. Migration 001
  added `whatsapp_identities`, `conversations`, `conversation_messages`, and
  `contributions`, extended the existing `help_requests`, and reused
  `communities`. Migration 002 added a nullable unique source-message key for
  contribution retry idempotency. Both are recorded in Supabase migration
  history.
- Connect reads `businesses` and `knowledge_records` separately. Knowledge
  discovery requires approved reuse status and exact local scope; it does not
  rely on the existing discoverable-business view because that view does not
  enforce source reuse eligibility.
- Persistent messaging works for WhatsApp identities already linked to
  canonical profiles. First-time sender provisioning remains unimplemented
  until the account-creation/Auth-to-profile workflow is confirmed.
- The Meta adapter and signed webhook route are implemented but not live;
  credentials, public webhook URL, Meta app subscription, and verification
  have not been supplied or tested.
- AI remains unconfigured. A deterministic understanding adapter handles
  initial request structure and marks AI provider status unavailable.
- Explicit provider recommendations/self-capability statements from linked
  users are preserved and stored as declared contributions; they are not
  promoted into verified business records automatically.
- Current status and verification results are in `docs/BUILD_STATUS.md` and
  `docs/AGENT_PROGRESS.md`.
- Latest live catalog verification supersedes historical recon notes that
  said `reviews` and `business_hours` had RLS disabled: both currently show
  RLS enabled with public SELECT policies; `reviews` also has authenticated
  own-row write policies. Connect did not alter these policies.
