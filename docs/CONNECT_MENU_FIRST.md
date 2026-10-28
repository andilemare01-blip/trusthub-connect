# TrustHub Connect: menu-first journeys

How the WhatsApp experience, review cards and admin fit together, and the decisions behind them.

## Message flow

```
WhatsApp → /api/whatsapp/webhook → handlePersistentTrustHubTurn (server-entry)
        → ConversationCoordinator.handleTurn
            1. ConnectJourneys.handle   welcome, menu, review cards, every guided flow
            2. connectIntent            "write a review", "add a business", guest tips, "create my profile"
            3. existing search / community / outcome logic
        → reply + optional interactive (list or buttons) → Meta Cloud API
```

- `lib/connect/menu.ts`: the 10-row menu. Rows are routed by stable id (`menu.find`), never by wording.
- `lib/connect/journeys.ts`: every flow, one question at a time. State lives in `conversation.connect` and is saved in the coordinator snapshot.
- `lib/connect/store.ts` / `supabase-store.ts`: the only place flows touch the database. Tests use `InMemoryConnectStore`.
- `lib/connect/parse.ts`: deterministic parsers (price, town/suburb, phone, card code). No AI.

## Where data goes

| Journey | Table | Starts as |
|---|---|---|
| Rate or review | `trusthub_connect_reviews` (`directory_business_id` → `businesses`) | `published` for card taps, otherwise `pending` |
| Add a business | `trusthub_connect_businesses` | `pending`; approving in admin also inserts into `businesses` (`source = trusthub_connect`) |
| Buy/sell, jobs, houses | `trusthub_connect_listings` | `pending` |
| Every search | `connect_search_log` | n/a |
| Scam reports | `connect_scam_reports` | `open` |
| Credits | `connect_credit_ledger` | 10 welcome credits; +1 per review, business or listing; −1 per deep question (refunded on failure) |
| Feedback | `feedback` (TrustHub's own table, category `connect_whatsapp`) | n/a |

Connect reviews never write into `public.reviews`: its triggers change review counts on the live TrustHub site. Publishing Connect reviews into TrustHub's main review display is a later, deliberate step.

All new tables are server-only (RLS on, no policies). Migration: `supabase/migrations/20261029000100_connect_menu_first_foundation.sql`.

## Review cards

A card stores only `https://<site>/r/TH-####?s=nfc` (the QR code uses `?s=qr`). The code maps to a business in `connect_review_cards`, so a card can be paused or moved without reprinting. The landing page counts the tap (`connect_card_taps`, skipping link-preview robots) and opens `wa.me/<TRUSTHUB_WHATSAPP_NUMBER>?text=REVIEW TH-####`.

QR codes come from `lib/connect/qr.ts`, a dependency-free encoder verified by decoding its output with OpenCV.

## Admin (`/admin`)

Sign-in uses TrustHub's own Supabase accounts (email and password); only users in `admin_users` get a session. Every admin API re-checks membership. Sections: Overview, To check (moderation), Review cards, System health.

## Environment variables

| Name | Purpose |
|---|---|
| `TRUSTHUB_WHATSAPP_NUMBER` | The Connect WhatsApp number people message, digits only (e.g. `263771234567`). Needed by the card landing page. |
| `PUBLIC_BASE_URL` | The production site, e.g. `https://trusthub-connect.vercel.app`. Card links and QR codes always point here. |

Existing: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `WHATSAPP_*`, `OPENROUTER_API_KEY`.

## Rules the code keeps

- A success message is sent only after the store confirmed the write.
- Unverified listings and businesses are labelled as unchecked.
- A typed number only opens the menu when no flow is waiting for an answer, so a rating of "5" stays a rating.
- One review per person per business every 30 days.
- Every write carries the WhatsApp message id, so a redelivered webhook never saves twice.
