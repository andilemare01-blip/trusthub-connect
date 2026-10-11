# TrustHub Connect Source and Answer Resolution Policy

**Status:** Design policy only. This document does not connect or enable any source, implement runtime behavior, approve a migration, or change the TrustHub database.

## 1. Purpose and status labels

This policy defines how Wisdom should decide what to consult before presenting uncertainty. **“No results found” is a controlled last state, not the first response.** An empty result from one query means only that the query did not find a suitable record; it does not prove that no answer exists.

- **CONFIRMED** means the principle is established in the product direction or recorded by the inspected Connect architecture documents. It does not mean a runtime integration exists.
- **PROPOSED** means this document specifies future behavior that needs product/implementation approval.
- **UNKNOWN** means the available project documents cannot establish the needed fact, threshold, permission, or capability.

The source documents include [Conversation Engine Blueprint](TRUSTHUB_CONNECT_CONVERSATION_ENGINE_BLUEPRINT.md), [Recon](../TRUSTHUB_CONNECT_RECON.md), [Architecture Plan](TRUSTHUB_CONNECT_ARCHITECTURE_PLAN.md), and [Pre-Migration Blueprint](TRUSTHUB_CONNECT_PRE_MIGRATION_BLUEPRINT.md), plus the PDF-sourced Wisdom library. Statements about live TrustHub data below reflect those documents; this task made no database connection and independently verified no live rows or policies.

## 2. Governing principles

- **CONFIRMED:** TrustHub is the network and source of truth; Wisdom is its conversational interface. “When TrustHub doesn't know, it asks. When the community knows, TrustHub remembers.”
- **CONFIRMED:** The Wisdom PDF’s “No results found” examples distinguish “no reliable match in current TrustHub data” from “nobody exists,” then offer clarification, widening the search, community input, or a Trust Agent route.
- **PROPOSED:** Resolve the user’s goal, choose only relevant sources, evaluate evidence and freshness, and offer suitable next steps before final uncertainty. Do not require every source to be searched for every question.
- **PROPOSED:** Keep source and confidence attached to each material claim. A source being available, returned by a search, or summarized by AI does not make a claim verified.
- **PROPOSED:** Present useful answers early when evidence is adequate. Do not delay a clear, reliable answer just to exhaust unrelated sources.
- **UNKNOWN:** The live availability, permissions, update cadence, complete data coverage, and query safety of future Connect source integrations are not established by this document.

## 3. Source hierarchy and authority

The hierarchy is an order of authority for resolving Connect questions, not a mandatory serial checklist. Route by question type; sources lower in the list cannot silently override or upgrade higher-authority TrustHub facts.

| Source class | Role and appropriate use | Authority and limits |
|---|---|---|
| **1. TRUSTHUB DATABASE** | Primary source for existing TrustHub knowledge: business records, approved corrections, supported reviews/reputation signals, and other explicitly approved records. | **CONFIRMED:** Existing architecture treats TrustHub data as canonical for TrustHub identities, businesses, and reviews. **PROPOSED:** Prefer this source first for TrustHub-held facts and preserve the record’s own verification/provenance. A missing row is not proof the entity does not exist. Exact access, row policies, field freshness, and source status remain **UNKNOWN**; the recon and pre-migration blueprint identify security/schema checks still required. |
| **2. COMMUNITY** | Opted-in participants provide local knowledge, personal experience, recommendations, corrections, and answers to community questions. | **CONFIRMED:** Community knowledge is central to the product direction. **PROPOSED:** Treat a response as an attributed declaration/evidence item, not an established fact. Requester consent and participant opt-in are required before an outreach request is sent. No WhatsApp group is assumed. |
| **3. TRUST AGENTS / HUMAN** | Human help when local judgement, intervention, conflict handling, or an unresolved request requires a person. | **CONFIRMED:** The architecture distinguishes Trust Agents from referral partners and supports human escalation as a future capability. **PROPOSED:** A human may provide judgement or additional evidence, but an agent statement is still attributed evidence unless the approved verification process supports a verified status. Do not imply an agent is available until availability is confirmed. |
| **4. OVERTURE** | Potential external discovery/enrichment for suitable place/business searches. | **CONFIRMED:** Existing TrustHub reconnaissance describes Overture Maps in a separate business-seeding pipeline. **PROPOSED:** A returned listing is an external lead, not a TrustHub-verified business. Connect access/configuration and permitted reuse are **UNKNOWN**. |
| **5. OPENSTREETMAP / OVERPASS** | Potential external place/location discovery for suitable local business, place, and geographic questions. | **CONFIRMED:** Existing TrustHub reconnaissance describes OpenStreetMap discovery in a separate pipeline. **PROPOSED:** Treat results as external leads and retain source and retrieval context. Coverage, freshness, permitted query pattern, applicable attribution/licensing obligations, and Connect configuration are **UNKNOWN**. |
| **6. GOOGLE PLACES** | Potential fallback external discovery/enrichment when other applicable sources do not provide a useful candidate. | **PROPOSED:** Consider only after TrustHub approval, configuration, and review of provider terms, cost, privacy, and retention. A Google Places result is not TrustHub verification. Availability and approval are **UNKNOWN**. |
| **GENERAL KNOWLEDGE / AI** | Appropriate for general explanatory questions that do not require current/local records or TrustHub policy. | **PROPOSED:** A future approved AI may explain general concepts within its limits; it must not fabricate TrustHub policy, live facts, local listings, or evidence. Use an authored TrustHub source for product/privacy/policy answers. No AI provider is connected or selected; coverage and safeguards are **UNKNOWN**. |

### External-source boundary

- **CONFIRMED:** The existing TrustHub codebase has a discovery/seeding pipeline that references Overture, OpenStreetMap, and Google; the Connect documentation does not establish that these providers are connected to this conversation engine.
- **PROPOSED:** External discovery may add a *candidate* to a conversation or approved ingestion process. It must not silently overwrite a TrustHub record, become a review/reputation signal, or receive a `verified` status merely because a provider returned it.
- **PROPOSED:** Before any future use, define deduplication, normalization, provenance capture, freshness handling, permitted use/attribution, correction, and review. Existing architecture says business deduplication must respect the existing `(source, source_id)` uniqueness where applicable; any actual schema/write path must first be verified and approved.
- **UNKNOWN:** Whether any external result can be retained, displayed, or reused under provider terms; which provider APIs/accounts will be approved; and their coverage, costs, rate limits, and freshness guarantees.

## 4. Resolve the question before selecting sources

Before search, Wisdom should infer or clarify only what changes the answer path:

- User goal and intent: discover a place, get a recorded business fact, ask a community question, understand a general concept, correct information, compare options, or act on an urgent request.
- Subject/entity and requested attribute: for example, a business, service, hours, phone, address, reputation, price, appointment, or location.
- Geography at country → city → optional area. Use a confirmed request location; ask when ambiguity changes candidate relevance. Do not require an area when a city-level answer is useful.
- Time sensitivity and freshness needed: “open now,” “tonight,” and “available today” need current evidence; a stored listing without an update time may not answer them.
- Constraints or preferences that materially change the search, such as service type, travel distance, price range, or accessibility needs.
- Whether uncertainty is acceptable and whether the user consents to a community request or human handoff.

**PROPOSED:** Ask one useful clarifying question when ambiguity would produce materially different results. Do not make the person fill in every possible field. Keep internal routing/state labels invisible to the user; explain the practical reason for a question instead.

## 5. Question-type routing

These routes are **PROPOSED**. They describe the order of consideration and branches, not available integrations or a requirement to contact every source.

| Question type | Resolution path | Routing notes |
|---|---|---|
| **Local business or service discovery** | TrustHub database → community when local experience/coverage matters and the requester agrees → Trust Agent when human help is appropriate → Overture → OpenStreetMap/Overpass → Google Places fallback only if later approved/configured. | For a provider recommendation, prioritize community experience and/or a suitable human route before presenting an external listing as a recommendation. For a simple place-finding query, an enabled external discovery source may be suitable without waiting for community outreach. External results remain leads. |
| **Business hours, phone, address, or service area** | TrustHub database → clarify entity/location → community/business correction path when the record may be wrong → appropriate external enrichment if later enabled. | Return recorded details with their source and freshness. Do not present stale or undated hours as current. Ask whether the user wants to submit a correction; preserve the old claim and correction evidence rather than silently replacing history. |
| **Reputation, reviews, “can I trust them?”, or personal recommendation** | TrustHub’s available reputation/evidence → community reports with consent where relevant → Trust Agent for conflict or unresolved local judgement. | External place discovery is not proof of quality. Keep individual reports attributed; separate TrustHub review signals from community experience. Do not invent or recalculate a trust level. |
| **Community question or local practical knowledge** | TrustHub knowledge → requester-permissioned community request → Trust Agent when community help is unavailable, insufficient, inappropriate, or the user asks for a person. | Do not route through place APIs when the question needs local human knowledge rather than a directory listing. Preserve opt-in and consent; no group-message assumption. |
| **General knowledge or explanation** | Approved TrustHub-authored material when asking about TrustHub → otherwise an approved AI/general-knowledge path if available and suitable → clarify or state uncertainty. | Do not query business/place providers by default. For current, local, regulated, or consequential facts, identify the need for a current authoritative source; do not pass model recall off as verified. |
| **Time-sensitive local question** | Most relevant current TrustHub record/source → suitable live external source if approved and configured → community or Trust Agent if the missing fact depends on local/current experience. | Check retrieval/update time and timezone where available. If freshness cannot be established, say that current status is unconfirmed and suggest a direct confirmation where useful. “Open now” must not be inferred from stale hours. |
| **TrustHub identity, product capability, privacy, or policy** | Approved, current TrustHub-authored policy/product material → human/Trust Agent if the question is unresolved. | AI may explain approved wording but must not invent policies or promises. General AI knowledge and external business sources are not substitutes for TrustHub policy. |
| **Business correction or user contribution** | Existing TrustHub record → collect the proposed correction and its source/evidence → approved review path; community or business confirmation when appropriate. | Existing `business_information_updates` is documented as a provenance/evidence pattern. Whether a new contribution type should reuse it is a future design decision; do not assume a write path or auto-approve submitted claims. |
| **Location, nearest option, or outside-community request** | Confirm/resolve location → TrustHub records → applicable external geographic/place source if approved → community/agent if local knowledge is needed. | Preserve country → city → optional area. If the requested area is outside current coverage, explain that boundary; do not imply no businesses exist there. |

### Local business/service decision path

For a request such as “I need a plumber in Chinhoyi,” the proposed process is:

1. Understand the service and confirm location/urgency only where needed.
2. Search applicable TrustHub records. A zero-result lookup is an internal gap, not yet a user-facing final answer.
3. If TrustHub has no reliable match, explain the gap. Ask permission before creating a community request. Do not ask if the user has declined or if community routing is unsuitable.
4. If community help is unavailable, insufficient, conflicting, or unsuitable, offer a Trust Agent only where an actual route may exist and the user consents.
5. If external discovery is enabled and appropriate, check Overture, then OpenStreetMap/Overpass, then Google Places only as an approved fallback. State clearly that externally discovered candidates are not TrustHub-verified.
6. Compare candidates with the user’s goal and evidence needs. Return a useful lead with provenance or continue to the final uncertainty state.

For simple discovery (“somewhere to eat nearby”), the system may skip community/agent escalation and use an approved external discovery source after checking TrustHub data. For quality, safety, or firsthand recommendations, external discovery alone is insufficient.

## 6. Search, evaluation, and confidence

### Search handling

- **PROPOSED:** Search by the interpreted intent, relevant entity/attribute, normalized location and reasonable synonyms/category variants. Resolve a likely duplicate or ambiguous entity before presenting a specific record.
- **PROPOSED:** A first empty search may lead to one targeted clarification or an appropriate broader search (for example, an area or service-name variant), not an unbounded retry loop.
- **PROPOSED:** Record which eligible sources were checked, skipped, unavailable, or declined, so “not checked” is not confused with “checked and empty.” Do not expose internal routing logs unnecessarily.
- **UNKNOWN:** Search limits, synonym/category model, ranking thresholds, retry limits, and source-specific timeouts are not defined.

### Provenance and claim status

Use the existing conceptual states documented by TrustHub Connect: **Verified, Observed, Declared, Inferred, Potential, Unknown**. Status is claim-specific; one business can have a verified identity and unverified hours, for example.

| Status | Proposed meaning | Natural user wording |
|---|---|---|
| **Verified** | Supported by an approved TrustHub verification process for this particular claim. | “TrustHub has verified this detail.” Say this only when the relevant verification evidence/status actually exists. |
| **Observed** | Directly observed by a named source/person or recorded observation, with time/context; it may no longer be current. | “This was observed on [date/context]; it may have changed.” |
| **Declared** | Stated by a business, user, community member, or agent, with the declarant/source identified where permitted. | “A member of your community reported this.” / “The business says it is open until 6.” |
| **Inferred** | Derived from other information or model interpretation, not independently confirmed. | “That suggests [interpretation], but I can’t confirm it.” |
| **Potential** | An externally discovered or otherwise incomplete candidate needing confirmation. | “I found a possible listing; the details still need checking.” |
| **Unknown** | Evidence is absent, insufficient, stale, inaccessible, or too conflicting to support the requested claim. | “I haven’t found enough reliable information to confirm that.” |

- **PROPOSED:** Preserve source identity, retrieval/contribution time, relevant context, evidence, verification status, and conflicts alongside each claim. Keep original community statements separate from AI summaries or normalized fields.
- **PROPOSED:** Evaluate relevance, claim type, source authority for that claim, recency, corroboration, geographic match, and contradictions. Several copies of the same underlying report do not automatically count as independent corroboration.
- **PROPOSED:** Do not assign a numeric confidence threshold in this policy. Present the evidence/status distinctions above until a reviewed threshold and verification process are approved.
- **UNKNOWN:** Operational definitions of `Verified` and `Observed`, freshness windows by data type, minimum corroboration, evidence review authority, and conflict-resolution rules.

### Freshness and conflicts

- **PROPOSED:** Treat hours, availability, prices, phone numbers, and time-sensitive service claims as volatile. Prefer a source with a recent, attributable timestamp; if none exists, disclose the limitation and avoid stating a present-tense fact as certain.
- **PROPOSED:** Keep conflicting reports attributed and separate. Explain the conflict in plain language, offer another appropriate source or a Trust Agent, and do not collapse disagreement into a single confident answer.
- **UNKNOWN:** Provider-specific freshness guarantees and expiry periods. No source in the project documents guarantees real-time data.

## 7. Community escalation

When TrustHub lacks enough reliable information, Wisdom should not jump straight to “No results found.” A suitable response is:

> “I don't have a reliable answer yet. Want me to ask your community?”

If the user agrees, the **PROPOSED** flow is:

1. Create a scoped request only after explicit requester consent.
2. Contact only suitable, opted-in participants under approved frequency and privacy rules. This is a community response system; it need not be a WhatsApp group.
3. Share only the minimum request context needed. Do not reveal the requester’s identity/contact details by default.
4. Preserve contributor, original response, timestamp, community, subject, “how they know,” evidence, consent/share scope, and any processing or moderation separately.
5. Evaluate relevance, freshness, support, and conflicts. A community response remains **Declared** unless a separate approved process establishes a different status.
6. Return useful information with its source/status, then ask whether it helped. A response is not proof that the user’s problem was solved.
7. Consider reusable TrustHub knowledge only under approved provenance, privacy, correction, freshness, and retention rules.

If the user declines, do not send the request. Offer clarification, a suitable external discovery path, a Trust Agent where appropriate and available, or the final uncertainty response. **UNKNOWN:** participant selection, notification delivery, moderation, consent records, frequency limits, and response-time expectations.

## 8. Trust Agent / human escalation

- **PROPOSED offer conditions:** community routing is unavailable, yields no useful response, produces unresolved conflicts, is inappropriate for the question, the request needs human/local judgement, or the user asks for a person. Do not offer an operational route unless availability can be checked or clearly described as unconfirmed.
- **PROPOSED consent:** Explain why a handoff may help and ask permission before passing context. Declining must not be represented as resolving the request.
- **PROPOSED context to pass:** minimum necessary user goal/request; confirmed country/city/area; relevant constraints and urgency; concise conversation summary; source claims, evidence, freshness, and unresolved conflicts; and the user’s consent/scope. Do not pass unrelated history or private contributor details.
- **PROPOSED handoff states:** offer → consent → assignment/availability check → waiting/accepted → agent response → outcome, or unsuccessful/unavailable handoff. Identify the human as a human; AI must never impersonate them.
- **UNKNOWN:** Trust Agent roster, coverage, hours, assignment, service-level expectations, contact method, and authorization. Existing docs say this capability is not established in the current TrustHub product.

## 9. Final uncertainty state

Wisdom may reach the final uncertainty response when the relevant TrustHub search and suitable clarifications have been attempted, and relevant community, human, or approved external paths have either been considered and exhausted or are unsuitable, unavailable, declined, or not configured. This is not a requirement to call every source.

Natural responses include:

- “I still don't have a reliable answer, and I don't want to make one up.”
- “I haven't found enough trustworthy information to confirm that.”
- “I found a possible listing, but I couldn't confirm the details.”

Then offer the next useful option if one exists: refine the location/request, try a different category or source, ask the community with permission, contact a Trust Agent if available, leave the request open only if that capability is real and accepted, or stop here. Do not promise a later update unless a real follow-up mechanism and consent exist.

Use “No results found” only when it accurately describes a bounded search and does not imply that the business/person/answer does not exist. Prefer “I didn't find a reliable match in the sources I could check” plus what the user can do next.

## 10. Memory and demand flywheel

**PROPOSED:** A knowledge gap can become useful demand data without treating every user message as reusable public knowledge:

```text
Question
→ demand signal / unresolved need
→ data gap identified
→ permissioned community request when appropriate
→ contribution or external candidate
→ provenance and evidence preserved
→ review / freshness / conflict handling
→ reusable TrustHub knowledge when approved
→ easier answer for the next person
```

- Record the minimum operational facts needed to understand repeated demand: normalized intent/category, location at the permitted community granularity, outcome, and relevant times/source-attempt status. Do not retain unnecessary raw message or personal details merely for analytics.
- Deduplicate repeated demand signals where appropriate without discarding independent evidence or merging separate people/requests incorrectly.
- Reuse a contribution only with its provenance, claim status, freshness, evidence, and applicable sharing/privacy conditions intact. A correction should add evidence/history, not silently rewrite the original source.
- **CONFIRMED from existing documents:** demand aggregation and reusable knowledge are future capabilities; no Connect demand/knowledge-gap runtime is established. Existing `business_information_updates` is documented as a provenance/evidence pattern, not as proof it covers every new question type.
- **UNKNOWN:** retention, deletion/correction, aggregation thresholds, whether a repeat question becomes one gap or multiple, and which contributions may be reused without re-contacting contributors.

## 11. Conversational rules Wisdom must never break

Wisdom must never:

- Invent a local business, provider, phone number, opening time, availability, price, review, or trust/reputation signal.
- Convert a community declaration or external listing into a TrustHub-verified fact because AI processed or repeated it.
- Say a source was checked when it was unavailable, disabled, declined, or not actually queried.
- Treat an empty TrustHub result as proof that no answer exists or say “no results” before suitable resolution paths are considered.
- Force every question through business/location sources, or call community/agent routes without consent and appropriateness.
- Claim an external source is TrustHub-verified, or expose internal routing details when a simple source explanation is enough.
- Invent provider-specific source freshness, legal/privacy assurances, or a follow-up promise.
- Pretend to be a Trust Agent or human.

TrustHub controls source access, authored policy, consent, routing, and what can be claimed. AI may interpret and phrase within those boundaries only. TrustHub SOS remains a separate safety system; this policy neither extends it nor creates a Connect-to-SOS route. Serious or emergency situations must follow separately approved safety guidance, whose exact handoff is **UNKNOWN** here.

## 12. Future database and Migration 001 implications

These are **PROPOSED conceptual information needs only**, not a schema, table list, migration, or approval to write one. Future Connect persistence should be able to represent:

- The user’s question/request, normalized intent/category, location scope, relevant constraints, timestamps, and outcome.
- Which source classes were checked, skipped, unavailable, or declined; query/retrieval time; external provider/source identifiers; and candidate matching/deduplication outcomes.
- Claim-level provenance: source/contributor, original statement or evidence reference, timestamp/context, status (`verified`, `observed`, `declared`, `inferred`, `potential`, `unknown`), freshness, and conflicts.
- Requester consent for community/human sharing, participant opt-in/eligibility, sharing scope, outreach and response history, and opt-out/frequency controls.
- Trust Agent offers, consented context handoff, assignment/availability, responses, and unsuccessful handoffs.
- Gap/demand signals, whether an answer was useful, user-confirmed resolution separately from an AI answer, and any approved reusable-knowledge decision with audit history.

Before Migration 001 is finalized, compare these needs with the actual approved conversation model and inspect existing `businesses`, `business_information_updates`, `help_requests`, community structures, and notification capabilities for reuse. Existing architecture documents explicitly warn against duplicate business/community/request structures and identify schema/policy questions still requiring verification. Any source writes, external enrichment storage, RLS/access rules, provider terms, and retention design require separate approval. **No database or migration is created or applied by this policy.**

## 13. Validation and unresolved decisions

- **CONFIRMED alignment:** TrustHub remains source of truth; Wisdom is the interface; provenance and uncertainty remain visible; community escalation is permission-based; Trust Agents remain a human path; AI does not replace either; TrustHub SOS stays separate.
- **PROPOSED resolution order:** understand → type → relevant TrustHub search → evidence/freshness evaluation → suitable consented community/human/external route → final uncertainty only when applicable paths are exhausted or unsuitable.
- **UNKNOWN:** Live Connect access to TrustHub, source credentials/configuration, external provider approval and terms, source coverage/freshness, verification standards, confidence thresholds, community operations, agent availability, and persistence/retention policy.
- No production database, integration, credential, secret, or application behavior is changed or authorized by this document.