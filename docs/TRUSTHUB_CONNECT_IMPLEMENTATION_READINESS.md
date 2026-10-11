# Implementation Readiness

**Audit type:** Read-only implementation-readiness audit. No application code, migration, database, credential, external service, or deployment was changed. The SQL and live-database facts below are reported from the checked-in Connect documents; this audit made no Supabase connection and did not independently verify production schema or policies.

**Classification key:** **CONFIRMED** = directly present in inspected Connect files or explicitly documented as an inspected fact; **PROPOSED** = recommended future approach, not implemented; **UNKNOWN** = not verified or documents conflict; **BLOCKER** = must be resolved before the affected live implementation can safely proceed.

## 1. Current Project Structure

- **CONFIRMED:** The project is a Next.js 16.3.6 App Router application using React 19.2.8 and TypeScript 5.9.3, with strict TypeScript enabled and an `@/*` path alias. The root has `app/`, `lib/`, `types/`, `docs/`, `prompts/`, and a public assets directory. See [package.json](../package.json), [tsconfig.json](../tsconfig.json), and [README.md](../README.md).
- **CONFIRMED:** `app/` contains a minimal landing page, an `/admin` skeleton, and API routes for health, AI reply, and the WhatsApp webhook. No user-facing conversation workflow or other pages are present in Connect.
- **CONFIRMED:** `lib/` contains interface/factory scaffolding for identity, conversations, requests, WhatsApp, AI, TrustHub data access, community, contributions, provenance, knowledge, outreach, agents, matching, locations, notifications, seeding, analytics, launch coverage, and admin authorization. `lib/supabase/` is only a placeholder; there is no configured data client.
- **CONFIRMED:** `types/` contains 19 TypeScript modules plus a README, including the requested identity, WhatsApp/conversation, request, community, contribution, provenance, business, agent, matching, outcome, seed, media, and analytics contracts.
- **CONFIRMED:** The npm scripts are `dev`, `build`, `start`, and `lint`; no test script is declared. The installed top-level dependency tree contains Next, React, React DOM, TypeScript, ESLint, and type packages. It contains no Supabase client, WhatsApp/Meta/Twilio SDK, AI provider SDK, Overture/OSM/Overpass/Google Places SDK, or test runner. See [package.json](../package.json), [package-lock.json](../package-lock.json), and [Build Status](BUILD_STATUS.md).
- **CONFIRMED:** The source-level API currently has no `process.env` reads in `app/`, `lib/`, or `types/`; the environment template is documentation only. A focused search found no test/spec files.
- **UNKNOWN:** The documented Supabase topology is approved as one shared TrustHub project in the Architecture Plan, but `.env.example` and older Build Status text still describe that topology as undecided. Reconcile the stale environment/documentation wording before provisioning configuration. See [Architecture Plan](TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md) and [.env.example](../.env.example).

## 2. Existing Runtime Scaffolding

| Surface | What exists | Readiness |
|---|---|---|
| `/` | Static project-skeleton page. | **CONFIRMED:** no conversation UI/runtime. [app/page.tsx](../app/page.tsx) |
| `/api/health` | Returns a static `{ status: "ok" }`. | **CONFIRMED:** health check only. [health route](../app/api/health/route.ts) |
| `/api/whatsapp/webhook` | `POST` parses JSON and calls `WhatsAppProvider.parseIncomingWebhook`; current factory throws `NotConnectedError`, mapped to HTTP 501. | **CONFIRMED:** placeholder only. No GET verification handshake, provider signature verification, idempotent ingest logic, identity resolution, persistence, or reply orchestration is implemented. The required verification token is only mentioned in a TODO. [webhook route](../app/api/whatsapp/webhook/route.ts), [WhatsApp provider](../lib/whatsapp/provider.ts) |
| `/api/ai/reply` | `POST` casts parsed JSON to `AIReplyRequest`, invokes the not-connected orchestrator, returns 501; other errors become 400. | **CONFIRMED:** placeholder only. No request schema validation, prompt, policy enforcement, source routing, provider call, or output verification exists. [AI reply route](../app/api/ai/reply/route.ts), [AI orchestrator](../lib/ai/orchestrator.ts) |
| `/admin` | Static metric/community/activity placeholders, with explicit warning text. | **CONFIRMED:** no live queries, auth, authorization, or analytics. The layout explicitly says it is not secure. [admin page](../app/admin/page.tsx), [admin layout](../app/admin/layout.tsx) |

- **BLOCKER for live webhook use:** the public POST route has no provider authenticity check or request replay handling. Migration 001 supplies a unique nullable `provider_message_id` column for deduplication, but the route does not yet use it; provider signing/verification specifics depend on a provider that remains undecided.
- **BLOCKER for production admin use:** the admin route is unauthenticated and displays no real data. `AuthorizationGateway` exists only as a not-connected seam; `admin_users` has no role column according to the inspected architecture documents.

## 3. Existing Types and Interfaces

The type system is broad, but its own file comments consistently state that these are conceptual application contracts, not a confirmed schema. The key models are:

| Area | Existing contracts | Readiness / compatibility finding |
|---|---|---|
| Identity | `TrustHubProfile`, `WhatsAppIdentity`, provision/resolve result types. | **CONFIRMED:** expresses the one-TrustHub-profile mapping principle. **BLOCKER:** resolver and provisioner factories throw; `TrustHubProfile.id` is represented as `string` while the documented SQL target `profiles.id` is `bigint`, and `help_requests.requester_id` uses the Auth user UUID. Mapping rules must be explicit. [identity types](../types/identity.ts), [identity adapters](../lib/identity/resolver.ts) |
| Conversation/message | Channel, coarse conversation status, direction, sender, message. | **CONFIRMED:** basic records are modeled. **BLOCKER:** `ConversationChannel` permits only `"whatsapp"`, while `MessageChannel` and SQL permit `whatsapp | web | admin | system`; the type requires a WhatsApp identity while SQL permits nullable/channel-agnostic identity; neither type nor migration represents all 23 engine states or transition history. [conversation types](../types/conversation.ts), [engine blueprint](TRUSTHUB_CONNECT_CONVERSATION_ENGINE_BLUEPRINT.md) |
| Request/outcome | `ServiceRequest`, intent/status union, `RequestOutcome` flags for useful-answer and match confirmation. | **CONFIRMED:** outcome concepts distinguish an AI reply from a solved problem. **BLOCKER:** current migration extends existing `help_requests`, not a `service_requests` table; SQL reuses `requester_id` UUID, `title`/`description`, `community_id` UUID, and free-text `status`, while this type assumes profile IDs, `communityKey`, `requestText`, and a closed status union. The confirmation booleans in `RequestOutcome` have no corresponding persisted columns. A repository mapping and status contract are required. [request types](../types/service-request.ts), [final migration spec](TRUSTHUB_CONNECT_FINAL_MIGRATION_SPEC.md) |
| Community/location | `CommunityLocation`, `LocationScope`, city/area helpers, existing community/help-request read references. | **CONFIRMED:** country → city → optional area and key normalization helpers exist. **BLOCKER:** types use `communityKey`; migration stores `community_id` UUID plus free-text `area`; gateway reference types do not establish how to map the existing community/member/post/help-request schemas. [community types](../types/community.ts), [location types](../types/location.ts) |
| Businesses/services | `TrustHubBusiness`, hours, review, provider and unverified-candidate read models. | **CONFIRMED:** application shapes cover basic business, hours, and reviews. **BLOCKER:** `TrustHubClient` lacks a business-hours read method, and no adapter maps live snake_case rows/UUIDs to these camelCase models. [business types](../types/business.ts), [TrustHub client](../lib/trusthub/client.ts) |
| Contributions/provenance | Capability, provider recommendation, `VerificationStatus`, `Provenance`, `Evidence`, media contribution shapes. | **CONFIRMED:** all six statuses (`verified`, `observed`, `declared`, `inferred`, `potential`, `unknown`) are represented, and Migration 001’s `contributions` includes source, relationship, evidence notes, verification status, and source message link. **UNKNOWN:** the standalone `ProvenanceEvidence` type has no separate evidence-table equivalent in Migration 001; it must map to contribution columns/message metadata or be separately designed. [contribution types](../types/contribution.ts), [provenance types](../types/provenance.ts), [media types](../types/media.ts) |
| Knowledge and gaps | `KnowledgeItem`, `KnowledgeClaim`, `KnowledgeGap`, detect/resolve result. | **CONFIRMED:** useful conceptual search/gap shapes exist. **BLOCKER:** no knowledge/gap table is in Migration 001, and `KnowledgeGateway` is not connected. First release must either explicitly search contributions/existing TrustHub records or design/reuse persistence for reusable knowledge; it cannot assume a `KnowledgeItem` store. [knowledge types](../types/knowledge.ts), [knowledge gateway](../lib/knowledge/gateway.ts) |
| Outreach/consent | Outreach, recipient, response, frequency policy (`requiresOptIn: true`). | **CONFIRMED:** policy concepts are typed. **BLOCKER:** no opt-in/opt-out persistence, recipient eligibility source, outreach/response rows, or delivery implementation is present in Migration 001. Existing `community_members`/`notifications` may be reusable, but their actual columns and semantics are **UNKNOWN** in the inspected Connect documents. [outreach types](../types/outreach.ts), [outreach engine](../lib/outreach/engine.ts) |
| Agents/admin | Agent, coverage, availability, assignment; OWNER/TRUST_AGENT roles and authorization context. | **CONFIRMED:** future contracts exist. **BLOCKER:** no Trust Agent/coverage/availability/assignment or role storage is in Migration 001; current `/admin` is unauthenticated. Existing referral partners are a different marketing concept. [agent types](../types/agent.ts), [admin types](../types/admin.ts), [admin authorization](../lib/admin/authorization.ts) |
| Matching/connection | Candidate, criteria, match outcome, consented provider-contact coordination. | **CONFIRMED:** interfaces exist. **BLOCKER:** no matching algorithm/source implementation; Migration 001 stores at most one current matched business/contribution on `help_requests`, not candidate history or provider identity. [matching types](../types/matching.ts), [connection types](../types/connection.ts) |
| Discovery/analytics | `SeedSource`, `SourceEvidence`, normalized business/dedupe; analytics and launch types. | **CONFIRMED:** conceptual external provenance carries a source ID and retrieval time; `SeedSource` includes Overture and OpenStreetMap, but not Google Places. **BLOCKER:** seed/analytics/launch factories are not connected; no source-resolution result/status contract or source router exists. [seed types](../types/seed.ts), [analytics types](../types/analytics.ts), [launch types](../types/launch.ts) |

## 4. Existing Migration 001

- **CONFIRMED:** [Migration 001 SQL](TRUSTHUB_CONNECT_MIGRATION_001.sql) is present and marked draft/review only, not executed. It creates four tables: `whatsapp_identities`, `conversations`, `conversation_messages`, `contributions`; adds seven columns/constraints/indexes to existing `help_requests`; enables RLS on the four new tables; and includes guarded Harare/Chinhoyi community seed DML.
- **CONFIRMED from the recorded SQL audit:** the final audit reports 15/15 foreign-key types and its listed SQL checks passing, including a nullable unique provider message ID, source-message link, six contribution verification statuses, and corrected UUID references to `communities`/`businesses`. This is a document audit claim, not a live database recheck in this task. See [Migration 001 Final Audit](TRUSTHUB_CONNECT_MIGRATION_001_FINAL_AUDIT.md).
- **CONFIRMED:** `help_requests` is extended, not replaced. Its existing `status` remains unconstrained text; application-level values are described in the final spec. The migration does not create `service_requests`, `KnowledgeGap`, outreach, Trust Agent, matching-history, or admin-role tables.
- **CONFIRMED:** RLS is enabled on the four new tables, with own-row SELECT policies for conversations/messages/contributions and no non-service-role write policies. The migration intentionally does not alter existing `help_requests` RLS.
- **BLOCKER before execution:** the final spec’s approval checklist has 15 items; #7 and #14 are marked resolved, while 13 boxes remain unchecked, including `help_requests` RLS and execution approval. `BUILD_STATUS.md` still describes the full checklist as pending, so status wording is stale/inconsistent. The migration’s “ready for human approval” label is not execution approval.
- **BLOCKER for the full runtime pair:** Migration 001 contains no current engine state/state history, source-attempt log, consent/opt-in record, outreach recipient/response record, agent assignment/availability, or explicit user-confirmed answer/match outcomes. Existing tables might satisfy some needs, but their schemas and policies must be inspected before claiming reuse.

## 5. Conversation Engine Dependencies

- **CONFIRMED:** The approved blueprint defines 23 internal states and four message-owner classes; it explicitly says state labels are internal and that AI cannot invent facts, policies, provider details, or trust/verification claims.
- **CONFIRMED:** Existing code has type contracts and separate not-connected factories for identity, conversations, requests, AI intent/entity/contribution extraction, media parsing, and response composition.
- **BLOCKER:** No conversation orchestrator, state transition implementation, persisted state/history policy, pattern selector, profile/location onboarding logic, or follow-up runner exists. The only API route calls the one-method AI reply mock.
- **BLOCKER:** No persistent identity resolver/provisioner exists. The final migration spec describes phone provisioning, but [Implementation Prerequisites](IMPLEMENTATION_PREREQUISITES.md) and the earlier Architecture Plan still mark project Auth configuration/provisioning as blocked/unknown. The final spec also conditions `phone_confirm: true` on trust in the selected WhatsApp provider’s delivery guarantees; that provider is not selected or connected.
- **PROPOSED:** The engine should call deterministic data/source interfaces and own state/consent transitions; AI should be limited to interpretation and wording from retrieved evidence, never the source of truth.

## 6. Source Resolution Dependencies

- **CONFIRMED:** `TrustHubClient` is a read-oriented seam for profile, business, community business list, service providers, and reviews; all methods currently throw. It has no hours method, source-candidate search contract, or freshness/result status.
- **CONFIRMED:** `CommunityGateway` exposes community, help-request, and post reads, but is not connected; the `CommunityRepository` is an in-memory map that loses data on restart. Neither offers consented participant selection or response writes.
- **CONFIRMED:** `SeedOrchestrator` has generic `extract`, `normalize`, and `deduplicate` interfaces but every method throws. `SeedSource` omits Google Places, and no Overture/OSM/Overpass/Google adapter, routing policy implementation, or external credentials/configuration exist in Connect.
- **CONFIRMED:** Provenance recording and human/rule-based verification are interfaces only. The `KnowledgeVerifier.review` contract accepts a caller-supplied decided status, including `verified`; a production implementation must enforce reviewer authorization and evidence policy rather than trusting this parameter.
- **BLOCKER:** There is no resolver implementing the approved source hierarchy or the “no results found is last” rule. No implementation records which sources were checked, skipped, unavailable, or declined; no source freshness/conflict evaluation runs; no answer composer consumes typed evidence.
- **PROPOSED:** Make source resolution a separate module with typed candidates/claims and source status, but have it return results to the conversation coordinator so the state machine can choose clarification, community, human, external discovery, or final uncertainty.

## 7. Structures We Can Reuse

- **CONFIRMED (documented existing TrustHub structures):** canonical `profiles`/Auth, `businesses`, `reviews`, `business_hours`, `business_information_updates`, `communities`, `community_members`, `community_posts`, `post_comments`, `post_reactions`, `help_requests`, `notifications`. Exact schema/policies vary in verification; do not infer from a table name alone. See [Recon](../TRUSTHUB_CONNECT_RECON.md), [Architecture Plan](TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md), and [Pre-Migration Blueprint](TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md).
- **CONFIRMED:** `business_information_updates` is the existing provenance/evidence pattern for corrections to fields on existing businesses. It should not be assumed to cover all general/provider contributions.
- **CONFIRMED (Migration 001 draft):** proposed `whatsapp_identities`, conversation/message history, generalized contributions, and an additive `help_requests` extension are the intended storage base; `businesses` and `communities` remain canonical, not duplicated.
- **CONFIRMED:** Existing `businesses.source`/`source_id` and unique `(source, source_id)` are documented deduplication affordances for approved ingestion, but do not constitute an external search adapter or proof of freshness/verification.
- **PROPOSED:** Reuse existing community/notification facilities for opt-in outreach only after their full schemas, RLS, usage, and delivery semantics are verified. Reuse existing `help_requests` rather than introducing another request table.

## 8. Structures Still Required

The following are missing as **runtime behavior** even where a type/interface exists:

- **BLOCKER:** A stateful conversation coordinator that persists/resumes the approved states, maps them to coarse conversation/request statuses, handles timeouts, and routes source outcomes without showing internal labels.
- **BLOCKER:** A real TrustHub data adapter with reviewed row mapping, minimum source-query methods (including hours if in scope), deterministic filters, provenance, and safe failure behavior.
- **BLOCKER:** A source-resolution contract/implementation for TrustHub records, community evidence, human evidence, Overture, OpenStreetMap/Overpass, and eventual Google fallback; source attempt and freshness semantics need design.
- **BLOCKER:** Requester consent and community-participant opt-in/opt-out enforcement, recipient selection/frequency controls, and auditable response collection. The current migration does not represent these; existing community/notification structures may or may not.
- **BLOCKER:** Human handoff routing, availability/assignment, consent-scoped context transfer, and unsuccessful-handoff handling.
- **BLOCKER:** Explicit outcome capture distinguishing an answer delivered from useful-answer confirmation, successful connection/match, resolved, unresolved, abandoned, and follow-up-required.
- **BLOCKER:** Runtime safety guardrails that prevent unsupported local facts, source-status upgrades, fabricated contacts/hours/prices, and final uncertainty before suitable routes are considered.
- **PROPOSED:** First-class source-attempt/state-event persistence may be needed for resumability/audit. Decide whether to add schema or whether existing messages/metadata and current operational tables can meet the policy without ambiguity.
- **UNKNOWN:** Whether existing `community_members`, `community_posts`, `help_requests`, and `notifications` can support an opt-in, consented response workflow. Inspect exact columns, constraints, current RLS, and behavior before deciding additional schema is required.

## 9. Database Dependencies

- **CONFIRMED:** Migration 001 gives a limited base for canonical identity mapping, conversation/message persistence, a provider message ID for idempotency, a generalized contribution/provenance row, and a cross-channel request linked to `help_requests`.
- **CONFIRMED:** `contributions` can hold `source`, `relationship`, `evidence_notes`, `verification_status`, `source_message_id`, `subject_type`, and links to the conversation/request; `help_requests` can hold intent/category/channel, current match IDs, area, and existing lifecycle timestamps.
- **BLOCKER:** The database design does not store the 23-engine-state model, source attempts and their outcomes, requester/recipient consent, opt-in/out/frequency eligibility, outreach responses as distinct operational records, agent assignment/availability, or explicit useful-answer/match confirmation. `help_requests.status` is intentionally not constrained and existing RLS is inherited/unknown.
- **UNKNOWN:** Some omitted concepts may map to existing community tables or notification metadata. The approved final migration spec intentionally defers a dedicated outreach subsystem and relies on manual/notification/conversation primitives for a minimal loop; that can support a limited workflow only after existing table semantics and consent enforcement are confirmed.
- **Conclusion — sufficiency:** **PROPOSED:** Migration 001 is a reasonable persistence base for a constrained first slice (identity link, conversation, message, request, attributed contribution) if approved, applied, and verified. It is **not sufficient by itself** for both complete runtimes and their auditable consent/source/outcome behavior. Additional **schema design or a verified reuse decision** is required before live community/human/external routing; this does not automatically mean another table or migration must be created.
- **BLOCKER before applying SQL:** the migration file is unexecuted; final human approval is incomplete; `help_requests` RLS must be reconciled; source documents disagree on some underlying verification status. The audit makes no database call.

## 10. Environment / Credential Dependencies

- **CONFIRMED:** [.env.example](../.env.example) contains empty placeholders for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_PROVIDER_API_KEY`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and `AI_PROVIDER_API_KEY`. No code in `app/`, `lib/`, or `types/` currently reads these variables.
- **CONFIRMED:** `.gitignore` ignores `.env*`; this avoids committing environment files but also ignores `.env.example` by the broad pattern unless explicitly force-added/exceptioned. No secret values were read during this audit.
- **UNKNOWN:** `.env.example` says the Supabase project relationship is undecided, while the Architecture Plan says shared-project topology is approved. No Supabase SDK is installed and no environment variables are consumed, so no actual connection is configured.
- **BLOCKER for live provider work:** WhatsApp and AI provider choices/configuration are unresolved; external-source approval and any Google Places configuration are absent. The example file has no Google Places/Overpass/O​​verture configuration variables. Do not add credentials until the providers, ownership, access policy, and deployment secret-management plan are approved.
- **CONFIRMED:** No credentials, secret values, or external connections were added or used by this audit.

## 11. Security / RLS Dependencies

- **CONFIRMED (recorded live inspection, not independently rechecked):** `reviews` and `business_hours` have RLS disabled. Do not build a data path that assumes those tables are protected. Existing RLS policy bodies for other referenced TrustHub tables remain unknown. See [Implementation Prerequisites](IMPLEMENTATION_PREREQUISITES.md).
- **CONFIRMED:** Migration 001 enables RLS on its four new tables and defines own-row SELECT policies; it intentionally leaves existing `help_requests` RLS untouched. The final SQL audit leaves `help_requests` current RLS and policy state as an open pre-execution item.
- **BLOCKER:** Do not apply or depend on the migration until its remaining approval checklist is signed and `help_requests` RLS is inspected/reconciled. The migration is marked for human approval, not execution.
- **BLOCKER:** The webhook route is publicly callable and has no provider signature verification, handshake, rate limit, payload validation, or idempotent persistence logic. The migration’s provider message ID is only storage support, not handler security.
- **BLOCKER:** `/admin` has no authentication or authorization. No route protection or role storage is implemented.
- **PROPOSED:** Keep all privileged Supabase/Auth Admin operations server-side; never expose service-role credentials. Require safe input validation and webhook authenticity/idempotency before live provider activation; enforce verified status only through authorized evidence review.
- **UNKNOWN:** Raw message retention is effectively indefinite under Migration 001’s content column and lacks an expiry/redaction policy. Consent audit, sensitive data handling, logging policy, and retention/deletion rules need product/security approval before production use.
- **CONFIRMED:** TrustHub SOS remains separate. No SOS table or integration is part of Migration 001 or this audit.

## 12. Implementation Order

**Recommendation: option 3 — implement the Conversation Engine runtime and Source & Answer Resolution runtime together as one coordinated runtime layer, with separate internal modules/interfaces.** This is **PROPOSED**, based on the inspected state model and source policy. The engine’s `searching_trusthub`, `answer_found`, `answer_uncertain`, `missing_information`, community/human escalation, and final uncertainty transitions are driven by the resolver’s result. Implementing either as an independent finished runtime would leave the other’s contract and last-state behavior implicit.

Recommended sequence:

1. **Reconcile prerequisites and document conflicts.** Confirm one Supabase topology across docs; resolve the phone/Auth/`phone_confirm` verification conflict; inspect live `help_requests`/community schemas and RLS through an approved read-only process; close the remaining Migration 001 human approval items. Do not connect anything during that step without explicit approval.
2. **Align contracts before wiring.** Define a mapping from current TS models to actual SQL: UUID vs. bigint IDs; Auth UUID vs. profile ID; `community_id` vs. `communityKey`; `help_requests` vs. `ServiceRequest`; coarse persistence statuses vs. internal engine states; and the outcome-confirmation contract.
3. **Build a coordinated, provider-neutral core against test fixtures.** Implement pure state transitions and source-route decisions together. The router must return typed candidates with source/status/freshness and explicit checked/skipped/unavailable/declined outcomes; the coordinator enforces consent, no-invention constraints, and the final uncertainty gate. Keep AI out of deterministic lookup, trust status, and routing decisions.
4. **Add automated tests before live wiring.** Cover identity unresolved/returning flows, request clarification, TrustHub empty results, source failure, community consent granted/declined, conflicting/stale evidence, external lead labeling, unavailable agent, and final uncertainty. **BLOCKER:** no test runner or test script currently exists; choose/approve the project test harness before relying on this layer for real traffic.
5. **Wire persistence only after database gates.** Once Migration 001 is approved/applied and verified, add server-side repositories and the `help_requests` mapping. Before full source routing, decide how consent/outreach/response, source attempts/freshness, agent handoff, and explicit outcomes are persisted or safely reused from verified existing structures.
6. **Connect providers incrementally and only when approved.** First an approved, authenticated/idempotent WhatsApp adapter; then TrustHub reads behind RLS-reviewed server-side access; then community/agent pathways; then individually approved external discovery (Overture, OSM/Overpass, Google Places fallback). Add an AI provider only after deterministic retrieval/guardrails and disclosure/evaluation are in place.

This is a coordinated layer, not a monolithic component: the state coordinator, source resolver, persistence ports, and provider adapters retain separate responsibilities.

## 13. Blockers

| Classification | Blocker | Scope blocked |
|---|---|---|
| **BLOCKER** | No real database, WhatsApp, AI, community, notification, identity, request, provenance, agent, or source-search adapter exists; most factories throw `NotConnectedError`. | Any live end-to-end runtime. |
| **BLOCKER** | Migration 001 is unexecuted and 13 of its 15 final approval checklist items are unchecked; `help_requests` RLS/policies remain unverified. | Persistence-backed implementation and migration execution. |
| **BLOCKER** | Phone/Auth configuration is documented as blocked in prerequisites/architecture but described as supported in the later migration spec; `phone_confirm: true` depends on a not-yet-selected provider trust assumption. | Persistent WhatsApp identity provisioning. |
| **BLOCKER** | Types and migration are not yet reconciled for channel, identifier, community, request, and status mappings. | Repository implementation and safe serialization/deserialization. |
| **BLOCKER** | Community opt-in/opt-out, eligible-member schema, requester consent, notification delivery, and response semantics are absent or unknown. | Permissioned community escalation. |
| **BLOCKER** | No agent role/roster/coverage/availability/assignment exists in SQL or live code; `/admin` is unauthenticated. | Automated/trackable Trust Agent escalation and privileged operations. |
| **BLOCKER** | No source router, freshness/conflict evaluator, source-attempt ledger, or rule enforcing final “no results” state exists. | Source & Answer Resolution runtime. |
| **BLOCKER** | Webhook signature verification and replay-safe processing are absent from the route (the migration column alone does not implement either). | Public WhatsApp webhook activation. |
| **BLOCKER** | No test runner/test script is present. | Confidence in state/routing/security behavior before production. |
| **BLOCKER** | The Conversation Engine Blueprint §20 still says the PDF was inaccessible and zero entries were processed, while the current library is complete and independently inventories 1,000 unique IDs/68 categories. | Treating the approved design documents as internally reconciled; update/reconcile this stale statement before final engine prompt/pattern wiring. This audit does not modify the blueprint. |

## 14. UNKNOWNs Requiring Confirmation

- **UNKNOWN:** Exact current `help_requests` RLS state and policies; exact `community_members`, `community_posts`, `post_comments`, `post_reactions`, and `notifications` columns, constraints, policies, and semantics.
- **UNKNOWN / documentary conflict:** Whether the project-specific Supabase Auth settings allow the described phone-only provisioning path; whether `phone_confirm: true` is justified by the eventual WhatsApp provider; and whether any Auth trigger/profile provisioning behavior has been verified in a source that supersedes the still-blocked prerequisite document.
- **UNKNOWN:** Safe account matching for an email-based existing profile with no phone. The final spec accepts a possible temporary second identity until an explicit link flow; product acceptance of that limitation should be confirmed against the persistent-identity principle.
- **UNKNOWN:** Whether user conversation states should be persisted explicitly, reconstructed from messages, or mapped into coarse statuses; lifecycle for changed intents, timeouts, waiting, follow-up, and unresolved requests.
- **UNKNOWN:** What counts as `Verified`/`Observed`, evidence/corroboration thresholds, source-specific freshness windows, conflict resolution, and whether/how external candidates can be retained or reused under provider terms.
- **UNKNOWN:** Community consent evidence, participant opt-in/out and frequency preference storage, recipient eligibility, reply handling, moderation, and whether existing community tables/notifications support the intended loop.
- **UNKNOWN:** Agent roster/role storage, service-area coverage, availability, assignment, authorization, handoff service levels, and fallback operations.
- **UNKNOWN:** Exact useful-answer, successful-match, resolved, unanswered, abandoned, and follow-up definitions; who confirms outcomes and how disagreements are represented.
- **UNKNOWN:** Google Places approval/configuration; Overture and OpenStreetMap/Overpass coverage, terms, attribution, freshness, costs/rate limits, and approved usage. `types/seed.ts` currently does not include Google Places.
- **UNKNOWN:** Message/media retention, deletion/anonymization, privacy controls, consent audit, and security monitoring before real conversations are stored.
- **UNKNOWN:** Whether a separate persisted source-attempt record is required or whether message metadata/operational records suffice for the intended auditability.

## 15. Safe First Implementation Boundary

**PROPOSED safe boundary for the next code task:** implement only the provider-neutral, test-only coordinated core: (1) conversation state transition/coordination contracts and (2) source-resolution decision logic that returns attributed, status-bearing candidates and explicit source outcome states. Use fixtures/fake adapters, not actual TrustHub, Supabase, WhatsApp, AI, community notifications, Overture, OSM/Overpass, or Google Places. Ensure empty TrustHub results do not directly become final uncertainty; test permitted clarification/community/human/external branches and the final-state guard. Do not wire the existing public webhook or expose `/admin` data as production functionality.

The first *persistent/live* implementation boundary is later and remains blocked until type/schema reconciliation, Migration 001 approval/execution, `help_requests` RLS verification, identity provisioning decisions, and consent/outreach/agent/source-persistence decisions are complete. Migration 001 is a base for simple message/request/contribution persistence; it is not a complete schema contract for the two approved runtimes.

### Audit conclusion

- **CONFIRMED:** extensive architecture/types and placeholder routes exist; the source PDF library is currently complete; Migration 001 SQL exists and has a recorded pre-execution audit.
- **BLOCKER:** neither runtime is implemented or connected, and the draft migration remains unexecuted with outstanding approval/security and contract-alignment work.
- **PROPOSED:** implement the conversation and source-resolution cores together as a coordinated, provider-neutral, test-first layer; add real adapters only after the listed gates are closed.
- **Scope confirmation:** this audit created no code, schema, migration, credentials, service connection, or deployment.