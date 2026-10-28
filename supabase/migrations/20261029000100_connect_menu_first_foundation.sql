-- TrustHub Connect: menu-first foundation.
--
-- Additive only. Nothing here changes a column or policy the live TrustHub
-- web app depends on. Every new table is server-only: RLS is enabled with no
-- policies, so only the service-role key used by Connect's server code (after
-- its own checks) can read or write. Admin pages read through the server,
-- which first verifies membership in public.admin_users.

-- 1. Reviews from WhatsApp can point at the real directory (public.businesses).
--    The original design only allowed Connect's own (empty) business table.
--    Connect reviews stay in their own table and never write into
--    public.reviews, whose triggers change counts on the live TrustHub site.
alter table public.trusthub_connect_reviews
  alter column business_id drop not null,
  add column if not exists directory_business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists whatsapp_identity_id bigint references public.whatsapp_identities(id) on delete set null,
  add column if not exists verified_visit boolean not null default false,
  add column if not exists card_code text,
  add column if not exists source_message_id text;

alter table public.trusthub_connect_reviews
  drop constraint if exists trusthub_connect_reviews_one_business,
  add constraint trusthub_connect_reviews_one_business
    check ((business_id is null) <> (directory_business_id is null));

alter table public.trusthub_connect_reviews
  drop constraint if exists trusthub_connect_reviews_reviewer_required,
  add constraint trusthub_connect_reviews_reviewer_required
    check (auth_user_id is not null or profile_id is not null or whatsapp_identity_id is not null
      or nullif(trim(both from reviewer_phone), '') is not null or is_anonymous);

create unique index if not exists trusthub_connect_reviews_source_message_key
  on public.trusthub_connect_reviews (source_message_id) where source_message_id is not null;
create index if not exists trusthub_connect_reviews_directory_business_idx
  on public.trusthub_connect_reviews (directory_business_id, created_at desc);

-- 2. Listings and business submissions remember who sent them and which
--    WhatsApp message created them, so a redelivered webhook never duplicates.
alter table public.trusthub_connect_listings
  add column if not exists whatsapp_identity_id bigint references public.whatsapp_identities(id) on delete set null,
  add column if not exists source_message_id text;
create unique index if not exists trusthub_connect_listings_source_message_key
  on public.trusthub_connect_listings (source_message_id) where source_message_id is not null;

alter table public.trusthub_connect_businesses
  add column if not exists submitted_by_whatsapp_identity_id bigint references public.whatsapp_identities(id) on delete set null,
  add column if not exists source_message_id text,
  add column if not exists possible_duplicate_of uuid references public.businesses(id) on delete set null;
create unique index if not exists trusthub_connect_businesses_source_message_key
  on public.trusthub_connect_businesses (source_message_id) where source_message_id is not null;

-- 3. Review cards (NFC/QR). The card stores only a short link with its code;
--    the code maps to a business here, so a card can be moved without reprinting.
create sequence if not exists public.connect_review_card_number_seq start 1001;
create table if not exists public.connect_review_cards (
  id uuid primary key default gen_random_uuid(),
  card_number integer not null unique default nextval('public.connect_review_card_number_seq'),
  code text generated always as ('TH-' || card_number::text) stored unique,
  business_id uuid references public.businesses(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused', 'unassigned')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.connect_review_card_number_seq owned by public.connect_review_cards.card_number;

create table if not exists public.connect_card_taps (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.connect_review_cards(id) on delete cascade,
  channel text not null default 'link' check (channel in ('nfc', 'qr', 'link', 'whatsapp')),
  tapped_at timestamptz not null default now()
);
create index if not exists connect_card_taps_card_idx on public.connect_card_taps (card_id, tapped_at desc);

-- 4. Search log: the raw material for demand intelligence ("searched, not found").
create table if not exists public.connect_search_log (
  id bigint generated always as identity primary key,
  whatsapp_identity_id bigint references public.whatsapp_identities(id) on delete set null,
  journey text not null,
  category text,
  city text,
  area text,
  query_text text check (char_length(query_text) <= 200),
  result_count integer not null default 0 check (result_count >= 0),
  source_message_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists connect_search_log_source_message_key
  on public.connect_search_log (source_message_id) where source_message_id is not null;
create index if not exists connect_search_log_created_idx on public.connect_search_log (created_at desc);
create index if not exists connect_search_log_city_idx on public.connect_search_log (lower(city), created_at desc);

-- 5. Scam reports about a phone number. Lookups count recent, non-dismissed reports.
create table if not exists public.connect_scam_reports (
  id uuid primary key default gen_random_uuid(),
  reported_phone text not null check (reported_phone ~ '^\+[1-9][0-9]{6,14}$'),
  reason text not null check (char_length(reason) between 3 and 300),
  reporter_identity_id bigint references public.whatsapp_identities(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'dismissed')),
  source_message_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists connect_scam_reports_one_per_reporter
  on public.connect_scam_reports (reported_phone, reporter_identity_id) where reporter_identity_id is not null;
create unique index if not exists connect_scam_reports_source_message_key
  on public.connect_scam_reports (source_message_id) where source_message_id is not null;
create index if not exists connect_scam_reports_phone_idx on public.connect_scam_reports (reported_phone, created_at desc);

-- 6. Credits ledger. Free credits only for now (welcome grant, earned by
--    contributing, spent on deep AI questions). Balance = sum(delta).
create table if not exists public.connect_credit_ledger (
  id bigint generated always as identity primary key,
  whatsapp_identity_id bigint not null references public.whatsapp_identities(id) on delete cascade,
  delta integer not null check (delta <> 0 and delta between -100 and 100),
  reason text not null check (reason in ('welcome', 'review', 'add_business', 'listing', 'scam_report', 'deep_question', 'admin_adjustment')),
  reference text not null,
  created_at timestamptz not null default now(),
  unique (whatsapp_identity_id, reason, reference)
);
create index if not exists connect_credit_ledger_identity_idx on public.connect_credit_ledger (whatsapp_identity_id);

alter table public.connect_review_cards enable row level security;
alter table public.connect_card_taps enable row level security;
alter table public.connect_search_log enable row level security;
alter table public.connect_scam_reports enable row level security;
alter table public.connect_credit_ledger enable row level security;

revoke all on public.connect_review_cards, public.connect_card_taps, public.connect_search_log,
  public.connect_scam_reports, public.connect_credit_ledger from anon, authenticated;
revoke all on sequence public.connect_review_card_number_seq from anon, authenticated;

comment on table public.connect_review_cards is 'TrustHub Connect: NFC/QR review cards. Code TH-#### maps to a businesses row; server-only.';
comment on table public.connect_card_taps is 'TrustHub Connect: one row per card link open. Server-only.';
comment on table public.connect_search_log is 'TrustHub Connect: every WhatsApp search with city/category/result count, for demand intelligence. Server-only.';
comment on table public.connect_scam_reports is 'TrustHub Connect: community reports about phone numbers. Server-only; never shown with reporter identity.';
comment on table public.connect_credit_ledger is 'TrustHub Connect: free credit grants and spends per WhatsApp identity. Server-only.';
