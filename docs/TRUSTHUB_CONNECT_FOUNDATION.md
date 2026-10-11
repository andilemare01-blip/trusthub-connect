# TrustHub Connect — Foundation

This document explains the application-level foundation created in this
task: a non-live skeleton of interfaces, adapters, and types. It does not
describe a working product — most capabilities described here throw a
clearly named `NotConnectedError` today. No database table, migration,
credential, or live external connection was created to produce this
skeleton or this document.

Guiding principles, restated here because they shape every section below:

> "The community is the engine."
>
> "When TrustHub doesn't know, it asks. When the community knows, TrustHub
> remembers."
>
> "Tell TrustHub what you need."
>
> "TrustHub should launch communities with useful knowledge, not merely
> with a functioning chatbot."

WhatsApp is an interface/gateway. TrustHub/Supabase (the existing project)
is the source of truth. AI is an interpreter/orchestrator — never the
database, never the trust authority.

---

## A. What the system is

TrustHub Connect is a community intelligence and local problem-solving
network, reachable first through WhatsApp. It exists to answer "what/who do
I need locally," to notice when TrustHub doesn't have a good answer, to ask
the community in a targeted and consent-aware way, and to remember what it
learns — with provenance — so the next person gets a better answer.

## B. What the system is NOT

Not a chatbot alone, not a static directory, not a review-farming tool, not
a WhatsApp-automation gimmick, not a second TrustHub, not a second
Supabase project, not a system that manufactures trust by having an AI
declare something "verified."

## C. Source of truth

The existing TrustHub Supabase project ("Trusthub", ref
`bygtmzwsmwsibtruzbcc`) is the single source of truth for canonical data:
identity (`profiles` + Supabase Auth), `businesses`, `reviews`,
`review_helpfulness`, `business_hours`, `business_information_updates`,
`admin_users`, and the newly-verified `communities`, `community_members`,
`community_posts`, `post_comments`, `post_reactions`, `help_requests`, and
`notifications` tables. TrustHub Connect is a separate codebase that reads
and writes this data only through the adapters in `lib/trusthub`,
`lib/community`, and `lib/notifications` — it must never duplicate this
data into a parallel store. See `TRUSTHUB_CONNECT_RECON.md` and
`docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md` for the full evidence trail.

## D. Identity

One person = one TrustHub identity, regardless of whether they arrive via
WhatsApp first or the web app first. `profiles` remains canonical. A
WhatsApp identity (`types/identity.ts`'s `WhatsAppIdentity` /
`WhatsAppIdentityLink`) is only a mapping — phone number → `profiles.id` —
never a permanent, isolated WhatsApp-user store.

- `lib/identity/resolver.ts` — `IdentityResolver`: resolves an inbound
  phone number to an existing identity.
- `lib/identity/provisioner.ts` — `IdentityProvisioner`: creates a minimal,
  real `profiles`-backed identity for a brand-new WhatsApp-first person,
  through the same path TrustHub's own sign-up would use.

Both are `NotConnectedError` mocks today. The exact mechanism depends on
confirming real Supabase Auth capabilities
(`docs/IMPLEMENTATION_PREREQUISITES.md` item 4) — not implemented yet.

## E. Location

Preserves **country → city → area**. `area` is always optional — a
person or business can fully participate at city/community level with
area unknown, and area, when known, unlocks finer intelligence.
`types/location.ts` defines `LocationScope` and the confidence levels
(`user_confirmed`, `gps`, `inferred`, `unknown`); `types/community.ts`
keeps the existing `country:city:area` `communityKey` convention plus a new
`createCityLevelOrFullCommunityKey` helper that tolerates a missing area.
`lib/location/resolver.ts` is the (not-connected) seam for turning free
text or coordinates into a `LocationScope`. This does not replace or
restructure TrustHub's existing location model.

## F. Businesses/providers

Six distinct concepts are kept separate, never conflated:

1. Existing TrustHub `businesses` rows (canonical, read via
   `lib/trusthub`'s `TrustHubClient`).
2. Individual self-declared service providers (`types/business.ts`'s
   `ServiceProvider` — "I am a hairdresser").
3. TrustHub users who have declared a capability (`types/contribution.ts`'s
   `CapabilityDeclaration`, recorded via `lib/contributions`).
4. Community-recommended providers ("I know a plumber in Chinhoyi" —
   `types/contribution.ts`'s `ProviderRecommendation`).
5. Unverified candidates (`types/business.ts`'s
   `UnverifiedProviderCandidate`).
6. Verified businesses/providers (verification state lives in
   `types/provenance.ts`'s `VerificationStatus`, never assumed).

TrustHub Connect does not duplicate `businesses` into a new database —
only application interfaces/adapters reference it.

## G. Community

The live database already has `communities`, `community_members`,
`community_posts`, `post_comments`, `post_reactions`, and `help_requests`
(VERIFIED — see `docs/TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md` Section 5).
TrustHub Connect must not build a second community architecture.
`lib/community/gateway.ts`'s `CommunityGateway` is the intended reuse seam
(not-connected today — the exact column-level schema of these tables is
still unverified, `docs/IMPLEMENTATION_PREREQUISITES.md` item 7). The
older `lib/community/repository.ts` in-memory placeholder predates this
discovery and is now explicitly marked superseded in its own doc comment —
kept only for local development, not as a real persistence layer.

Hierarchy supported: country → city → area/community → members → activity
→ demand → knowledge gaps → contributions.

## H. Knowledge

`types/knowledge.ts`'s `KnowledgeItem` is a reusable, searchable unit of
remembered knowledge, carrying a `VerificationStatus`
(`verified | observed | declared | inferred | potential | unknown` —
`types/provenance.ts`). `KnowledgeClaim` is a single assertion contributing
to an item, with attached `Evidence`. `lib/knowledge/gateway.ts`'s
`KnowledgeGateway` searches existing knowledge and detects gaps — not
connected yet.

## I. Knowledge gaps

`types/knowledge.ts`'s `KnowledgeGap` captures why TrustHub didn't have an
answer (`repeated_question`, `repeated_service_request`,
`unanswered_request`, `missing_provider_category`,
`missing_business_information`, `missing_contact_information`,
`missing_area_information`). `GapDetectionResult`/`GapResolution` round out
the detect → resolve lifecycle. No table is created for this yet.

## J. Outreach

`types/outreach.ts` models `CommunityOutreach` → `OutreachRecipient` →
`OutreachResponse`, governed by an explicit `OutreachPolicy`
(`requiresOptIn: true`, frequency/interval limits). `lib/outreach/engine.ts`'s
`OutreachEngine` plans outreach, selects recipients, and records responses
— not connected yet. Delivery is intended to reuse the existing, VERIFIED
`public.notifications` table (`user_id, type, title, message, entity_type,
entity_id, metadata, dedupe_key, read_at, created_at`) via
`lib/notifications/gateway.ts`'s `NotificationGateway`, rather than a
second notification system. Outreach must never spam someone simply
because they were mentioned before — dedupe/frequency/opt-in are part of
the interface contract, not an afterthought.

## K. Contributions

`types/contribution.ts` distinguishes `CapabilityDeclaration` (self) from
`ProviderRecommendation` (about someone else), each preserving contributor
identity, category, community, contact preference/info, relationship, and
source. Recorded via `lib/contributions/repository.ts`'s
`ContributionRepository` — not connected. Business-related contributions
should be able to feed TrustHub's existing, VERIFIED
`business_information_updates` review process rather than a competing one
(`lib/provenance/recorder.ts`, extended from the existing pattern — not
rebuilt).

## L. Provenance

`types/provenance.ts`'s `Provenance` (who supplied it, source, relationship,
when) and `Evidence` (description, notes, provenance) generalize the
evidence/provenance pattern TrustHub already proves works in
`business_information_updates`. `lib/provenance/recorder.ts` records
contributions/evidence; the new `lib/provenance/verifier.ts`'s
`KnowledgeVerifier` is the seam for the explicit human/rule-based review
step that can move a `VerificationStatus` toward `verified` — AI never
performs this step itself.

## M. Requests

`types/service-request.ts`'s `ServiceRequest` carries a single shared
status enum (`SERVICE_REQUEST_STATUSES`:
`open, answered, matched, escalated_to_agent, resolved, unanswered`) so
statuses are never scattered as ad hoc strings. `RequestIntent` classifies
what the person wants; `RequestOutcome` is the explicit, separate
confirmation record — "problem solved" must never simply mean "the AI
replied." `lib/requests/repository.ts`'s `ServiceRequestRepository` is the
not-connected persistence seam. Before this becomes real, the existing
`public.help_requests` table must be inspected — it may already cover part
of this need.

## N. Matching

`types/matching.ts`'s `MatchCriteria` (category, country, city, area,
communityKey) feeds a deterministic, rule-based `MatchingEngine`
(`lib/matching/engine.ts`) — no ML ranking, no final scoring implemented.
`types/connection.ts` and `lib/matching/connection.ts`'s
`ConnectionCoordinator` model the consent-based "can you contact this one
for me?" flow (`ContactRequest` → `ProviderConsent` → `ConnectionRequest` →
`ConnectionOutcome`) — private contact details are never exposed without
consent, and no live WhatsApp calling is implemented.

## O. Agent network

`types/agent.ts` defines `TrustAgent`, `AgentCoverage`, `AgentAvailability`,
and `AgentAssignment` — explicitly distinct from TrustHub's existing
`referral_partners` (marketing referrals). `lib/agents/registry.ts`'s
`TrustAgentRegistry` is the not-connected seam. `admin_users` is not
modified by any of this — it still has only `user_id` and `created_at`
(VERIFIED, no role column).

## P. Launch coverage

A city must not launch into an empty knowledge base. `types/launch.ts`
defines `LaunchCommunity` (status: `pre_launch, building_coverage, ready,
active, paused`), `KnowledgeCoverage`/`CoverageCategory`, and
`LaunchReadiness`. `lib/launch/coverage.ts`'s `LaunchCoverageTracker`
evaluates a community's status — not connected. The same mechanism is
meant to work identically for Harare, Chinhoyi, and future communities.

## Q. Seed/discovery

A **new, separate, non-live** seed architecture
(`types/seed.ts`, `lib/seed/orchestrator.ts`) is scaffolded to eventually
replace/retire TrustHub's existing `lib/business-seeding/*` pipeline —
**only after validation**, e.g. against Chinhoyi. That existing pipeline is
untouched, not deleted, not rewritten. Conceptual pipeline: `SOURCE →
EXTRACT → NORMALIZE → LOCATION RESOLVE → COUNTRY/CITY/AREA → CATEGORY
NORMALIZE → DEDUPLICATE → PROVENANCE → QUALITY CHECK → TRUSTHUB`. No source
(Overture, OpenStreetMap, official registries, community, manual) is
connected in this task, and no scraping of sources whose terms disallow it
is implemented.

## R. Analytics

`types/analytics.ts` adds `MetricDefinition`, `AnalyticsQuery`,
`CommunityMetric`, `DemandMetric`, `OutcomeMetric` alongside the existing
UI label constants. `lib/analytics/gateway.ts`'s `AnalyticsGateway` is the
not-connected seam for deriving dashboard metrics from operational records
— no separate analytics database, consistent with the already-approved
architecture decision.

## S. Admin

The existing `/admin` UI skeleton is unchanged. `types/admin.ts` adds
`AdminRoleName` (`OWNER | TRUST_AGENT`), `AdminIdentity`, `Permission`,
`AuthorizationPolicy`, `AdminContext`. `lib/admin/authorization.ts`'s
`AuthorizationGateway` is the not-connected server-side seam intended to
eventually use the same verified-token pattern already proven correctly in
TrustHub's `/api/admin/contributions`. `admin_users` is not modified.
`/admin` remains an explicitly non-production, unauthenticated skeleton.

## T. Security

**Unresolved, CRITICAL, carried forward from the architecture plan:**
`public.reviews` and `public.business_hours` have RLS **disabled** in the
live database. This was not remediated in this task and must not be
silently worked around — it is a required security task for whoever owns
the TrustHub database. No RLS was enabled/disabled, no policy was written,
no table was modified, by this task. Every new interface in this skeleton
is a mock; no service-role key or credential is used anywhere.

## U. AI usage

AI is used for understanding natural language, intent classification
(`lib/ai`'s `IntentClassifier`), structured extraction
(`EntityExtractor`, `ContributionExtractor`), interpreting voice
transcripts (`ConversationInterpreter`), normalizing information, and
composing responses (`ResponseComposer`) — all currently
`AIInterfaceNotConnectedError` mocks. AI is deliberately **not** used for
deterministic operations: database lookup, counting, grouping, dashboard
metrics, exact category matching, simple routing, duplicate checking, or
basic community resolution. Principle: "AI interprets. TrustHub verifies.
The database remembers. The community fills the gaps."

## V. Data flywheel

```
ASK → RECORD → IDENTIFY GAP → ASK COMMUNITY → CONTRIBUTE → STRUCTURE
  → VERIFY/CLASSIFY → REMEMBER → IMPROVE
```

This loop is represented directly in the folder structure: `requests/` +
`conversations/` (ASK/RECORD) → `knowledge/` (IDENTIFY GAP) →
`outreach/` + `notifications/` (ASK COMMUNITY) → `contributions/`
(CONTRIBUTE) → `provenance/` (STRUCTURE/VERIFY) → `knowledge/` again
(REMEMBER) → `analytics/` + `launch/` (IMPROVE, measure coverage).

## W. What is intentionally NOT implemented yet

- No database table, column, or migration for any concept above.
- No RLS policy written, changed, or remediated (including the
  `reviews`/`business_hours` finding — see Section T).
- No live Supabase connection, WhatsApp provider connection, or AI provider
  connection — every adapter throws a clearly named `NotConnectedError`.
- No credentials of any kind were added or requested.
- No deployment.
- No modification to the existing TrustHub project or trusthub-sos.
- No deletion or rewrite of TrustHub's existing seeding pipeline.
- No scoring/ranking algorithm for matching (rule-based only, and not even
  the rules are implemented yet — only the interface).
- No admin authentication — `/admin` remains a UI-only skeleton.
