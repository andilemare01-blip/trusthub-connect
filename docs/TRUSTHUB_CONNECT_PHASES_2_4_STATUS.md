# TrustHub Connect implementation status

## Current behavior

- Supabase privileged access is created in server-only modules using `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (with the legacy service-role key fallback). The existing persistence repositories map conversations and messages to Migration 001's schema.
- The WhatsApp route supports Meta's GET verification handshake and validates POST bodies against `X-Hub-Signature-256` using the raw request body. It normalizes text messages, resolves only an already-linked TrustHub profile, checks for a previously stored provider message ID, runs the persistent conversation coordinator, sends a reply, and records accepted delivery metadata.
- The Meta transport sends text messages through the Cloud API. The existing read adapter and discovery service keep `businesses` separate from `knowledge_records`, retain provenance, and constrain discovery to the requested city.
- If no safe TrustHub profile link exists, the route acknowledges the event and logs that account linking is required. It does not invent or provision a second identity.

## Required configuration

Server-only Supabase: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

Meta WhatsApp Cloud API: `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_GRAPH_API_VERSION`.

Keep all values in deployment environment settings or an ignored local env file. Never use a `NEXT_PUBLIC_` prefix for secrets.

## Remaining setup and limits

1. Migration `docs/TRUSTHUB_CONNECT_MIGRATION_001.sql` is a draft and has **not** been applied. Review and apply it using the authorized TrustHub database workflow before enabling persistent WhatsApp processing.
2. Configure Meta's webhook URL and verification token, subscribe to message events, and provide the real app secret, access token, phone number ID, and supported Graph API version.
3. Approve and implement an account-linking/provisioning path that reuses TrustHub's canonical Auth/profile lifecycle. First-time and unlinked users are not yet onboarded by WhatsApp.
4. Add an atomic inbox/outbox claim so concurrent webhook retries cannot race between the duplicate check and processing, and so failed sends can retry without losing or duplicating replies. Current duplicate protection is a pre-check plus the existing unique provider-message constraint.
5. Incoming non-text media is not processed. Intent extraction is a small deterministic MVP for listed Zimbabwe cities and common service terms; other messages receive the coordinator's clarification response.
6. No external WhatsApp credentials or live webhook connection have been verified. Database persistence and provider delivery have only been exercised through local tests/build, not against production services.
