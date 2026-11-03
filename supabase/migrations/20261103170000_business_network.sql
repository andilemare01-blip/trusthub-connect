-- TrustHub business network: agents own their businesses, every payment is one row, commission is
-- worked out when the CEO confirms a payment, Benita tokens, and the three-way deal chat.
-- All new tables are RLS-on with no policies: only the server (service_role) can touch them.
-- The API routes decide who is asking (CEO, agent token, verified owner, deal link) and every function
-- below filters to that person. Nothing here is exposed to anon or authenticated.

create table public.biz_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
insert into public.biz_settings(key, value) values
  ('commission_rate','0.10'), ('website_from_usd','30'), ('ceo_whatsapp','');

alter table public.business_claims add column if not exists agent_code text;
alter table public.connect_review_cards add column if not exists agent_id bigint references public.connect_agents(id) on delete set null;

create table public.biz_agent_links (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  agent_id bigint not null references public.connect_agents(id) on delete cascade,
  source text not null check (source in ('link','card','deal','ceo')),
  linked_at timestamptz not null default now());
create index biz_agent_links_agent on public.biz_agent_links(agent_id);

create table public.biz_deals (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
  business_id uuid references public.businesses(id) on delete set null,
  business_name text not null,
  contact_name text,
  contact_phone text,
  package text not null default 'website',
  stage text not null default 'new' check (stage in ('new','talking','quoted','won','lost')),
  quoted_usd numeric(10,2),
  agent_id bigint references public.connect_agents(id) on delete set null,
  source text not null default 'package_page',
  last_text text,
  last_at timestamptz not null default now(),
  ceo_seen_at timestamptz, agent_seen_at timestamptz, business_seen_at timestamptz,
  created_at timestamptz not null default now());
create index biz_deals_agent on public.biz_deals(agent_id);
create index biz_deals_business on public.biz_deals(business_id);

create table public.biz_deal_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.biz_deals(id) on delete cascade,
  sender text not null check (sender in ('business','agent','ceo','benita')),
  sender_name text not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now());
create index biz_deal_messages_deal on public.biz_deal_messages(deal_id, created_at);

create table public.biz_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  business_name text not null,
  deal_id uuid references public.biz_deals(id) on delete set null,
  agent_id bigint references public.connect_agents(id) on delete set null,
  product text not null check (product in ('website','tokens_small','tokens_large','growth','pro','other')),
  amount_usd numeric(10,2) check (amount_usd is null or amount_usd >= 0),
  method text, ref text, note text,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  submitted_by text not null default 'business' check (submitted_by in ('business','ceo')),
  confirmed_at timestamptz, decided_by uuid,
  created_at timestamptz not null default now());
create unique index biz_payments_ref on public.biz_payments(lower(ref)) where coalesce(ref,'') <> '' and status <> 'rejected';
create index biz_payments_status on public.biz_payments(status, confirmed_at);

create table public.biz_commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.biz_payments(id) on delete cascade,
  agent_id bigint not null references public.connect_agents(id),
  once_key text not null,
  rate numeric(5,4) not null,
  amount_usd numeric(10,2) not null,
  status text not null default 'owed' check (status in ('owed','paid','void')),
  paid_ref text, paid_at timestamptz,
  created_at timestamptz not null default now());
-- Once-off: one commission per business per family (website, tokens, plan), however often they pay again.
create unique index biz_commissions_once on public.biz_commissions(once_key) where status <> 'void';
create index biz_commissions_agent on public.biz_commissions(agent_id, status);

create table public.biz_token_ledger (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  delta integer not null,
  reason text not null,
  payment_id uuid references public.biz_payments(id) on delete set null,
  created_at timestamptz not null default now());
create index biz_token_ledger_business on public.biz_token_ledger(business_id);
create unique index biz_token_welcome on public.biz_token_ledger(business_id) where reason = 'welcome';

alter table public.biz_settings enable row level security;
alter table public.biz_agent_links enable row level security;
alter table public.biz_deals enable row level security;
alter table public.biz_deal_messages enable row level security;
alter table public.biz_payments enable row level security;
alter table public.biz_commissions enable row level security;
alter table public.biz_token_ledger enable row level security;
revoke all on public.biz_settings, public.biz_agent_links, public.biz_deals, public.biz_deal_messages,
  public.biz_payments, public.biz_commissions, public.biz_token_ledger from anon, authenticated;

create function public.biz_tokens(p_business uuid) returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta),0)::int from biz_token_ledger where business_id = p_business $$;

create function public.biz_tokens_spend(p_business uuid, p_cost integer, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_left integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business::text, 7));
  v_left := public.biz_tokens(p_business);
  if v_left < p_cost then raise exception 'You need % tokens for this. You have %.', p_cost, v_left; end if;
  insert into biz_token_ledger(business_id, delta, reason) values (p_business, -p_cost, left(p_reason,60));
  return v_left - p_cost;
end $$;

create function public.biz_tokens_refund(p_business uuid, p_cost integer, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into biz_token_ledger(business_id, delta, reason) values (p_business, p_cost, 'refund: '||left(p_reason,50)) $$;

-- First agent keeps the business; only the CEO can move it (p_force).
create function public.biz_link_agent(p_business uuid, p_agent bigint, p_source text, p_force boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_business is null or p_agent is null then return; end if;
  if p_force then
    insert into biz_agent_links(business_id, agent_id, source) values (p_business, p_agent, p_source)
    on conflict (business_id) do update set agent_id = excluded.agent_id, source = excluded.source, linked_at = now();
  else
    insert into biz_agent_links(business_id, agent_id, source) values (p_business, p_agent, p_source) on conflict (business_id) do nothing;
  end if;
end $$;

-- Verifying a claim: owner row, free plan, welcome tokens so Benita works on day one, and the agent link.
create or replace function public.biz_on_claim_verified() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agent bigint;
begin
  if new.status = 'verified' and (old.status is distinct from 'verified') then
    insert into business_owners(business_id, user_id, claim_id, role)
    values (new.business_id, new.user_id, new.id, coalesce(nullif(new.role,''),'owner'))
    on conflict (business_id, user_id) do nothing;
    insert into biz_subscriptions(business_id, plan, status) values (new.business_id, 'free', 'active')
    on conflict (business_id) do nothing;
    insert into biz_token_ledger(business_id, delta, reason) values (new.business_id, 12, 'welcome')
    on conflict do nothing;
    select id into v_agent from connect_agents where upper(code) = upper(new.agent_code) and active limit 1;
    if v_agent is null then
      select agent_id into v_agent from connect_review_cards where business_id = new.business_id and agent_id is not null order by created_at limit 1;
      perform public.biz_link_agent(new.business_id, v_agent, 'card');
    else
      perform public.biz_link_agent(new.business_id, v_agent, 'link');
    end if;
    new.verified_at := coalesce(new.verified_at, now());
    insert into notifications(user_id, type, title, message, entity_type, entity_id, dedupe_key)
    values (new.user_id, 'business_claim', 'Your business is verified',
            'You can now reply to reviews, and Benita has a free report waiting for you.', 'business', new.business_id,
            'claim_verified_'||new.id)
    on conflict do nothing;
  end if;
  return new;
end $$;

create function public.biz_product_price(p_product text) returns numeric language sql immutable as $$
  select case p_product when 'growth' then 30 when 'pro' then 60 when 'tokens_small' then 5 when 'tokens_large' then 15 end::numeric $$;

create function public.biz_payment_submit(p_business uuid, p_product text, p_method text, p_ref text) returns json
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text := nullif(trim(left(p_ref,120)),''); v_name text;
begin
  if p_product not in ('tokens_small','tokens_large','growth','pro') then raise exception 'Choose a product first.'; end if;
  if v_ref is null then raise exception 'Add the payment reference.'; end if;
  select name into v_name from businesses where id = p_business;
  if v_name is null then raise exception 'That business was not found.'; end if;
  begin
    insert into biz_payments(business_id, business_name, agent_id, product, amount_usd, method, ref)
    values (p_business, v_name, (select agent_id from biz_agent_links where business_id = p_business), p_product,
            public.biz_product_price(p_product), left(p_method,40), v_ref)
    returning id into v_id;
  exception when unique_violation then raise exception 'That payment reference was already used.'; end;
  if p_product in ('growth','pro') then
    insert into biz_subscriptions(business_id, plan, status, requested_plan, payment_method, payment_ref, requested_at)
    values (p_business, 'free', 'active', p_product, left(p_method,40), v_ref, now())
    on conflict (business_id) do update set requested_plan = excluded.requested_plan, payment_method = excluded.payment_method,
      payment_ref = excluded.payment_ref, requested_at = now(), updated_at = now();
  end if;
  return json_build_object('status','requested','payment_id',v_id);
end $$;

-- The older page still calls this: keep it working, and make its requests appear on the CEO desk.
create or replace function public.biz_request_plan(p_business uuid, p_plan text, p_method text, p_ref text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.biz_is_owner(p_business) then raise exception 'Not your business'; end if;
  if p_plan not in ('growth','pro') then raise exception 'Unknown plan'; end if;
  return public.biz_payment_submit(p_business, p_plan, p_method, p_ref);
end $$;

create function public.biz_owner_context(p_business uuid) returns json language sql stable security definer set search_path = public as $$
  with b as (select * from businesses where id = p_business),
  cat as (select lower(trim(regexp_replace(coalesce(subcategory, category, ''), '^.*-\s*', ''))) c from b)
  select json_build_object(
    'tokens', public.biz_tokens(p_business),
    'payments', (select coalesce(json_agg(json_build_object('id',p.id,'product',p.product,'amount',p.amount_usd,'status',p.status,'created_at',p.created_at) order by p.created_at desc),'[]') from biz_payments p where p.business_id = p_business),
    'open_deal', (select d.token from biz_deals d where d.business_id = p_business and d.stage not in ('won','lost') order by d.last_at desc limit 1),
    'has_website', nullif(trim(coalesce(b.website,'')),'') is not null,
    'bought_website', exists (select 1 from biz_payments p where p.business_id = p_business and p.product = 'website' and p.status = 'confirmed'),
    'website_from', (select value from biz_settings where key = 'website_from_usd'),
    'ceo_whatsapp', (select nullif(value,'') from biz_settings where key = 'ceo_whatsapp'),
    'reviews', (select count(*) from reviews where business_id_uuid = p_business),
    'unanswered', (select count(*) from reviews r where r.business_id_uuid = p_business and not exists (select 1 from biz_review_replies x where x.review_id = r.id)),
    'category', (select nullif(c,'') from cat),
    'searches_30', (select count(*) from connect_search_log s, cat where s.created_at > now() - interval '30 days' and cat.c <> ''
       and (s.category ilike '%'||cat.c||'%' or s.query_text ilike '%'||cat.c||'%') and (s.city is null or b.city is null or s.city ilike '%'||b.city||'%')),
    'report_run', exists (select 1 from biz_insights i where i.business_id = p_business and i.source = 'ai'))
  from b
$$;

create function public.deal_settings() returns json language sql stable security definer set search_path = public as $$
  select json_object_agg(key, value) from biz_settings where key in ('website_from_usd','ceo_whatsapp') $$;

create function public.deal_greet(p_deal uuid) returns void language plpgsql security definer set search_path = public as $$
declare d biz_deals; v_agent text;
begin
  select * into d from biz_deals where id = p_deal;
  select name into v_agent from connect_agents where id = d.agent_id;
  insert into biz_deal_messages(deal_id, sender, sender_name, body) values (p_deal, 'benita', 'Benita (AI assistant)',
    'Hi! I''m Benita, TrustHub''s AI assistant. Thanks for asking about the Digital Package for '||d.business_name||'. '
    ||case when v_agent is null then 'Our Marketing Executive' else v_agent||' (your agent) and our Marketing Executive' end
    ||' will reply in this chat. To start, tell us what you sell and what you want customers to be able to do on your website.');
  update biz_deals set last_text = 'New enquiry', last_at = now() where id = p_deal;
end $$;

-- Someone with no account, from the public package page. Guarded against floods, and it never hands back
-- an existing chat: knowing a phone number must not open somebody's conversation.
create function public.deal_start(p_contact text, p_business text, p_phone text, p_package text, p_agent_code text) returns json
language plpgsql security definer set search_path = public as $$
declare v_agent bigint; v_phone text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),9); r biz_deals;
begin
  if length(trim(coalesce(p_contact,''))) < 2 or length(trim(coalesce(p_business,''))) < 2 then raise exception 'Add your name and your business name.'; end if;
  if length(v_phone) < 9 then raise exception 'Add a phone number we can reach you on.'; end if;
  if (select count(*) from biz_deals where created_at > now() - interval '1 hour' and source = 'package_page') >= 30 then
    raise exception 'We are getting a lot of requests. Please try again in a few minutes.'; end if;
  if exists (select 1 from biz_deals where right(regexp_replace(coalesce(contact_phone,''),'\D','','g'),9) = v_phone and stage not in ('won','lost')) then
    raise exception 'We already have a request from this number. Our team will contact you, or use the WhatsApp button.'; end if;
  select id into v_agent from connect_agents where upper(code) = upper(nullif(trim(p_agent_code),'')) and active limit 1;
  insert into biz_deals(business_name, contact_name, contact_phone, package, agent_id, source)
  values (left(trim(p_business),120), left(trim(p_contact),80), left(trim(p_phone),30), left(coalesce(nullif(p_package,''),'website'),40), v_agent, 'package_page')
  returning * into r;
  perform public.deal_greet(r.id);
  return json_build_object('token', r.token);
end $$;

create function public.deal_open_for_owner(p_business uuid, p_package text, p_source text) returns json
language plpgsql security definer set search_path = public as $$
declare r biz_deals; v_name text; v_phone text;
begin
  select * into r from biz_deals where business_id = p_business and stage not in ('won','lost') order by last_at desc limit 1;
  if found then return json_build_object('token', r.token); end if;
  select name, phone into v_name, v_phone from businesses where id = p_business;
  if v_name is null then raise exception 'That business was not found.'; end if;
  insert into biz_deals(business_id, business_name, contact_phone, package, agent_id, source)
  values (p_business, v_name, v_phone, left(coalesce(nullif(p_package,''),'website'),40), (select agent_id from biz_agent_links where business_id = p_business), left(coalesce(p_source,'dashboard'),30))
  returning * into r;
  perform public.deal_greet(r.id);
  return json_build_object('token', r.token);
end $$;

create function public.deal_start_by_agent(p_agent_token text, p_contact text, p_business text, p_phone text) returns json
language plpgsql security definer set search_path = public as $$
declare v_agent bigint; r biz_deals;
begin
  select id into v_agent from connect_agents where dashboard_token = p_agent_token and active;
  if v_agent is null then raise exception 'This agent link is not active.'; end if;
  if length(trim(coalesce(p_business,''))) < 2 then raise exception 'Add the business name.'; end if;
  insert into biz_deals(business_name, contact_name, contact_phone, agent_id, source)
  values (left(trim(p_business),120), left(trim(coalesce(p_contact,'')),80), left(trim(coalesce(p_phone,'')),30), v_agent, 'agent')
  returning * into r;
  perform public.deal_greet(r.id);
  return json_build_object('token', r.token, 'id', r.id);
end $$;

-- One door into a chat: the key must match the role, and an agent only ever reaches their own deals.
create function public.deal_find(p_role text, p_key text, p_deal uuid) returns public.biz_deals
language plpgsql stable security definer set search_path = public as $$
declare d biz_deals;
begin
  if p_role = 'business' then select * into d from biz_deals where token = p_key;
  elsif p_role = 'agent' then select x.* into d from biz_deals x join connect_agents a on a.id = x.agent_id where x.id = p_deal and a.dashboard_token = p_key and a.active;
  elsif p_role = 'ceo' then select * into d from biz_deals where id = p_deal;
  end if;
  if d.id is null then raise exception 'This chat was not found.'; end if;
  return d;
end $$;

create function public.deal_read(p_role text, p_key text, p_deal uuid) returns json
language plpgsql security definer set search_path = public as $$
declare d biz_deals := public.deal_find(p_role, p_key, p_deal);
begin
  update biz_deals set
    ceo_seen_at = case when p_role = 'ceo' then now() else ceo_seen_at end,
    agent_seen_at = case when p_role = 'agent' then now() else agent_seen_at end,
    business_seen_at = case when p_role = 'business' then now() else business_seen_at end
  where id = d.id;
  return json_build_object(
    'id', d.id, 'business', d.business_name, 'stage', d.stage, 'package', d.package, 'quoted', d.quoted_usd,
    'agent', (select name from connect_agents where id = d.agent_id),
    'contact', case when p_role <> 'business' then json_build_object('name', d.contact_name, 'phone', d.contact_phone) end,
    'me', p_role,
    'ceo_whatsapp', (select nullif(value,'') from biz_settings where key = 'ceo_whatsapp'),
    'messages', (select coalesce(json_agg(json_build_object('id',m.id,'sender',m.sender,'name',m.sender_name,'body',m.body,'at',m.created_at) order by m.created_at),'[]') from biz_deal_messages m where m.deal_id = d.id));
end $$;

create function public.deal_post(p_role text, p_key text, p_deal uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare d biz_deals := public.deal_find(p_role, p_key, p_deal); v_body text := left(trim(coalesce(p_body,'')),2000); v_name text;
begin
  if v_body = '' then raise exception 'Write a message first.'; end if;
  v_name := case p_role when 'ceo' then 'Marketing Executive'
    when 'agent' then coalesce((select name from connect_agents where id = d.agent_id),'Agent')||' (agent)'
    else coalesce(nullif(d.contact_name,''), d.business_name) end;
  insert into biz_deal_messages(deal_id, sender, sender_name, body) values (d.id, p_role, v_name, v_body);
  update biz_deals set last_text = left(v_body,140), last_at = now(), stage = case when stage = 'new' then 'talking' else stage end where id = d.id;
end $$;

-- CEO desk ---------------------------------------------------------------------------------------
create function public.ceo_desk() returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'claims', (select coalesce(json_agg(json_build_object('id',c.id,'business',b.name,'city',b.city,'listed_phone',b.phone,'applicant',c.applicant_name,'role',c.role,'phone',c.phone,'notes',c.verification_notes,'submitted_at',c.submitted_at,
        'has_owner', exists (select 1 from business_owners o where o.business_id = c.business_id)) order by c.submitted_at),'[]')
      from business_claims c join businesses b on b.id = c.business_id where c.status in ('pending','contacted','call_again')),
    'payments', (select coalesce(json_agg(json_build_object('id',p.id,'business',p.business_name,'product',p.product,'amount',p.amount_usd,'method',p.method,'ref',p.ref,'agent',a.name,'created_at',p.created_at) order by p.created_at),'[]')
      from biz_payments p left join connect_agents a on a.id = p.agent_id where p.status = 'pending'),
    'deals', (select coalesce(json_agg(json_build_object('id',d.id,'business',d.business_name,'contact',d.contact_name,'phone',d.contact_phone,'stage',d.stage,'quoted',d.quoted_usd,'agent_id',d.agent_id,'agent',a.name,'last_text',d.last_text,'last_at',d.last_at,'source',d.source,
        'unread', exists (select 1 from biz_deal_messages m where m.deal_id = d.id and m.sender in ('business','agent') and m.created_at > coalesce(d.ceo_seen_at,'epoch')) or d.ceo_seen_at is null) order by d.last_at desc),'[]')
      from biz_deals d left join connect_agents a on a.id = d.agent_id where d.stage not in ('won','lost')),
    'agents', (select coalesce(json_agg(json_build_object('id',a.id,'name',a.name,'code',a.code,'active',a.active) order by a.name),'[]') from connect_agents a),
    'cards', (select coalesce(json_agg(json_build_object('id',c.id,'code',c.code,'agent_id',c.agent_id,'business',b.name) order by c.card_number desc),'[]') from connect_review_cards c left join businesses b on b.id = c.business_id),
    'settings', (select json_object_agg(key, value) from biz_settings))
$$;

create function public.ceo_claims_approve(p_ids uuid[], p_actor uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_done integer; v_all integer;
begin
  select count(*) into v_all from business_claims where status in ('pending','contacted','call_again') and (p_ids is null or id = any(p_ids));
  -- One owner per business: the earliest claim wins, and a business that already has an owner stays for you to look at.
  with pick as (
    select distinct on (c.business_id) c.id from business_claims c
    where c.status in ('pending','contacted','call_again') and (p_ids is null or c.id = any(p_ids))
      and not exists (select 1 from business_owners o where o.business_id = c.business_id)
    order by c.business_id, c.submitted_at)
  update business_claims c set status = 'verified', reviewed_by = p_actor from pick where c.id = pick.id;
  get diagnostics v_done = row_count;
  return json_build_object('approved', v_done, 'skipped', v_all - v_done);
end $$;

create function public.ceo_claim_reject(p_id uuid, p_actor uuid) returns void language sql security definer set search_path = public as $$
  update business_claims set status = 'rejected', reviewed_by = p_actor where id = p_id $$;

create function public.ceo_payment_record(p_business uuid, p_business_name text, p_deal uuid, p_agent bigint, p_product text, p_amount numeric, p_method text, p_ref text, p_note text, p_actor uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := nullif(trim(coalesce(p_business_name,'')),''); v_agent bigint := p_agent; v_business uuid := p_business;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount received.'; end if;
  if p_deal is not null then
    select coalesce(v_business, business_id), coalesce(v_name, business_name), coalesce(v_agent, agent_id) into v_business, v_name, v_agent from biz_deals where id = p_deal;
  end if;
  if v_business is not null then select coalesce(name, v_name) into v_name from businesses where id = v_business; end if;
  if v_name is null then raise exception 'Choose who paid.'; end if;
  begin
    insert into biz_payments(business_id, business_name, deal_id, agent_id, product, amount_usd, method, ref, note, submitted_by)
    values (v_business, v_name, p_deal, v_agent, p_product, p_amount, left(p_method,40), nullif(trim(left(p_ref,120)),''), left(p_note,300), 'ceo')
    returning id into v_id;
  exception when unique_violation then raise exception 'That payment reference was already used.'; end;
  return public.ceo_payment_decide(v_id, 'confirm', p_amount, p_actor);
end $$;

create function public.ceo_payment_decide(p_id uuid, p_decision text, p_amount numeric, p_actor uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p biz_payments; v_amount numeric; v_agent bigint; v_rate numeric; v_family text; v_key text; v_commission numeric := 0; v_tokens int; v_warn text;
begin
  select * into p from biz_payments where id = p_id for update;
  if p.id is null then raise exception 'That payment was not found.'; end if;

  if p_decision = 'reject' then
    if p.status <> 'pending' then raise exception 'That payment was already decided.'; end if;
    update biz_payments set status = 'rejected', decided_by = p_actor where id = p.id;
    if p.product in ('growth','pro') then update biz_subscriptions set requested_plan = null, updated_at = now() where business_id = p.business_id; end if;
    return json_build_object('status','rejected');
  end if;

  if p_decision = 'undo' then
    if p.status <> 'confirmed' then raise exception 'Only a confirmed payment can be undone.'; end if;
    update biz_payments set status = 'rejected', decided_by = p_actor where id = p.id;
    if exists (select 1 from biz_commissions where payment_id = p.id and status = 'paid') then
      v_warn := 'The agent was already paid for this sale. Recover that money with them directly.'; end if;
    update biz_commissions set status = 'void' where payment_id = p.id and status = 'owed';
    insert into biz_token_ledger(business_id, delta, reason, payment_id)
      select business_id, -delta, 'undo payment', null from biz_token_ledger where payment_id = p.id;
    return json_build_object('status','undone','warning',v_warn);
  end if;

  if p_decision <> 'confirm' then raise exception 'Unknown decision.'; end if;
  if p.status <> 'pending' then raise exception 'That payment was already decided.'; end if;
  v_amount := coalesce(p_amount, p.amount_usd);
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount received.'; end if;
  v_agent := coalesce(p.agent_id, (select agent_id from biz_agent_links where business_id = p.business_id));
  update biz_payments set status = 'confirmed', amount_usd = v_amount, agent_id = v_agent, confirmed_at = now(), decided_by = p_actor where id = p.id;

  if p.product in ('growth','pro') and p.business_id is not null then
    insert into biz_subscriptions(business_id, plan, status, current_period_end) values (p.business_id, p.product, 'active', now() + interval '1 month')
    on conflict (business_id) do update set plan = excluded.plan, status = 'active',
      current_period_end = greatest(coalesce(biz_subscriptions.current_period_end, now()), now()) + interval '1 month', requested_plan = null, updated_at = now();
  end if;
  v_tokens := case p.product when 'tokens_small' then 50 when 'tokens_large' then 200 when 'growth' then 10 when 'pro' then 40 else 0 end;
  if v_tokens > 0 and p.business_id is not null then
    insert into biz_token_ledger(business_id, delta, reason, payment_id) values (p.business_id, v_tokens, p.product, p.id);
  end if;
  if p.deal_id is not null then update biz_deals set stage = 'won', last_at = now() where id = p.deal_id; end if;
  if p.business_id is not null then
    insert into notifications(user_id, type, title, message, entity_type, entity_id, dedupe_key)
    select o.user_id, 'payment_confirmed', 'Payment received', 'Thank you. Your payment of $'||v_amount||' is confirmed.', 'business', p.business_id, 'payment_'||p.id from business_owners o where o.business_id = p.business_id
    on conflict do nothing;
  end if;

  if v_agent is not null then
    v_rate := (select value::numeric from biz_settings where key = 'commission_rate');
    v_family := case when p.product in ('growth','pro') then 'plan' when p.product like 'tokens%' then 'tokens' else p.product end;
    v_key := coalesce(p.business_id::text, 'deal:'||p.deal_id::text, 'payment:'||p.id::text)||':'||v_family;
    if not exists (select 1 from biz_commissions where once_key = v_key and status <> 'void') then
      v_commission := round(v_amount * v_rate, 2);
      insert into biz_commissions(payment_id, agent_id, once_key, rate, amount_usd) values (p.id, v_agent, v_key, v_rate, v_commission);
    end if;
  end if;
  return json_build_object('status','confirmed','commission',v_commission);
end $$;

create function public.ceo_commissions_pay(p_ids uuid[], p_ref text) returns json
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update biz_commissions set status = 'paid', paid_at = now(), paid_ref = left(p_ref,120) where id = any(p_ids) and status = 'owed';
  get diagnostics v_n = row_count;
  return json_build_object('paid', v_n);
end $$;

create function public.ceo_revenue(p_from timestamptz, p_to timestamptz, p_agent bigint, p_product text, p_city text) returns json
language sql stable security definer set search_path = public as $$
  with sales as (
    select p.*, b.city, a.name agent_name, c.id commission_id, c.amount_usd commission, c.status commission_status
    from biz_payments p
    left join businesses b on b.id = p.business_id
    left join connect_agents a on a.id = p.agent_id
    left join biz_commissions c on c.payment_id = p.id and c.status <> 'void'
    where p.status = 'confirmed'
      and (p_from is null or p.confirmed_at >= p_from) and (p_to is null or p.confirmed_at < p_to)
      and (p_agent is null or p.agent_id = p_agent) and (p_product is null or p.product = p_product)
      and (p_city is null or b.city ilike p_city))
  select json_build_object(
    'totals', json_build_object(
      'revenue', (select coalesce(sum(amount_usd),0) from sales),
      'sales', (select count(*) from sales),
      'commission_owed', (select coalesce(sum(commission) filter (where commission_status = 'owed'),0) from sales),
      'commission_paid', (select coalesce(sum(commission) filter (where commission_status = 'paid'),0) from sales),
      'net', (select coalesce(sum(amount_usd),0) - coalesce(sum(commission),0) from sales)),
    'by_agent', (select coalesce(json_agg(t order by t.revenue desc),'[]') from (select coalesce(agent_name,'No agent (direct)') agent, agent_id, sum(amount_usd) revenue, count(*) sales,
        coalesce(sum(commission) filter (where commission_status = 'owed'),0) owed, coalesce(sum(commission) filter (where commission_status = 'paid'),0) paid from sales group by 1,2) t),
    'by_product', (select coalesce(json_agg(t order by t.revenue desc),'[]') from (select product, sum(amount_usd) revenue, count(*) sales from sales group by 1) t),
    'by_month', (select coalesce(json_agg(t order by t.month),'[]') from (select to_char(confirmed_at,'YYYY-MM') "month", sum(amount_usd) revenue from sales group by 1) t),
    'rows', (select coalesce(json_agg(json_build_object('id',id,'at',confirmed_at,'business',business_name,'city',city,'product',product,'amount',amount_usd,'method',method,'ref',ref,'agent',agent_name,'commission',commission,'commission_status',commission_status,'commission_id',commission_id) order by confirmed_at desc),'[]') from (select * from sales order by confirmed_at desc limit 500) r),
    'cities', (select coalesce(json_agg(distinct b.city),'[]') from biz_payments p join businesses b on b.id = p.business_id where p.status = 'confirmed' and b.city is not null))
$$;

create function public.ceo_deal_update(p_deal uuid, p_stage text, p_quoted numeric, p_agent bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_business uuid;
begin
  update biz_deals set stage = coalesce(p_stage, stage), quoted_usd = coalesce(p_quoted, quoted_usd), agent_id = coalesce(p_agent, agent_id), last_at = now()
  where id = p_deal returning business_id into v_business;
  if p_agent is not null then perform public.biz_link_agent(v_business, p_agent, 'ceo', true); end if;
end $$;

create function public.ceo_card_agent(p_card uuid, p_agent bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_business uuid;
begin
  update connect_review_cards set agent_id = p_agent, updated_at = now() where id = p_card returning business_id into v_business;
  perform public.biz_link_agent(v_business, p_agent, 'card');
end $$;

create function public.ceo_setting_set(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key not in ('commission_rate','website_from_usd','ceo_whatsapp') then raise exception 'Unknown setting.'; end if;
  if p_key = 'commission_rate' and (p_value !~ '^0?\.[0-9]+$') then raise exception 'Enter the rate like 0.10 for 10%%.'; end if;
  update biz_settings set value = left(trim(p_value),40), updated_at = now() where key = p_key;
end $$;

-- Agent desk: only this agent's rows, found from their private token -----------------------------
create function public.agent_desk(p_token text) returns json language sql stable security definer set search_path = public as $$
  with me as (select id from connect_agents where dashboard_token = p_token and active)
  select json_build_object(
    'owed', (select coalesce(sum(c.amount_usd),0) from biz_commissions c where c.agent_id = (select id from me) and c.status = 'owed'),
    'paid', (select coalesce(sum(c.amount_usd),0) from biz_commissions c where c.agent_id = (select id from me) and c.status = 'paid'),
    'businesses', (select coalesce(json_agg(json_build_object('name',b.name,'city',b.city,'reviews',b.reviews_count,'plan',public.biz_current_plan(b.id),
        'claimed', exists (select 1 from business_owners o where o.business_id = b.id)) order by l.linked_at desc),'[]')
      from biz_agent_links l join businesses b on b.id = l.business_id where l.agent_id = (select id from me)),
    'sales', (select coalesce(json_agg(json_build_object('business',p.business_name,'product',p.product,'amount',p.amount_usd,'at',p.confirmed_at,'commission',c.amount_usd,'status',c.status) order by p.confirmed_at desc),'[]')
      from biz_payments p left join biz_commissions c on c.payment_id = p.id and c.status <> 'void' where p.agent_id = (select id from me) and p.status = 'confirmed'),
    'deals', (select coalesce(json_agg(json_build_object('id',d.id,'token',d.token,'business',d.business_name,'contact',d.contact_name,'stage',d.stage,'last_text',d.last_text,'last_at',d.last_at,
        'unread', exists (select 1 from biz_deal_messages m where m.deal_id = d.id and m.sender in ('business','ceo') and m.created_at > coalesce(d.agent_seen_at,'epoch'))) order by d.last_at desc),'[]')
      from biz_deals d where d.agent_id = (select id from me)),
    'cards', (select coalesce(json_agg(json_build_object('code',c.code,'business',b.name,'taps',(select count(*) from connect_card_taps t where t.card_id = c.id)) order by c.card_number),'[]')
      from connect_review_cards c left join businesses b on b.id = c.business_id where c.agent_id = (select id from me)),
    'settings', (select json_object_agg(key, value) from biz_settings where key = 'website_from_usd'))
  where exists (select 1 from me)
$$;

-- Everything Benita reads for a report. Numbers come from TrustHub's own data, never from a guess.
create function public.biz_benita_context(p_business uuid) returns json language sql stable security definer set search_path = public as $$
  with b as (select * from businesses where id = p_business),
  cat as (select lower(trim(regexp_replace(coalesce(subcategory, category, ''), '^.*-\s*', ''))) c from b)
  select json_build_object(
    'name', b.name, 'category', b.category, 'subcategory', b.subcategory, 'city', b.city, 'area', b.area, 'description', b.description,
    'reviews', (select coalesce(json_agg(json_build_object('rating',r.rating,'comment',left(coalesce(r.comment,''),500),'date',left(r.created_at::text,10))),'[]') from (select * from reviews where business_id_uuid = p_business order by created_at desc limit 80) r),
    'searches', (select coalesce(json_agg(t),'[]') from (select coalesce(s.query_text, s.category) q, count(*) n from connect_search_log s, cat
        where s.created_at > now() - interval '60 days' and cat.c <> '' and (s.category ilike '%'||cat.c||'%' or s.query_text ilike '%'||cat.c||'%') and (s.city is null or b.city is null or s.city ilike '%'||b.city||'%') group by 1 order by 2 desc limit 10) t),
    'similar_nearby', (select count(*) from businesses c where c.id <> b.id and c.category = b.category and c.city is not distinct from b.city),
    'facts', (select coalesce(json_agg(json_build_object('label',f.label,'value',coalesce(f.value::text,f.value_text),'unit',f.unit,'currency',f.currency)),'[]') from (select distinct on (fact_key) * from benita_facts order by fact_key, effective_from desc) f)
  ) from b
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('biz_tokens','biz_tokens_spend','biz_tokens_refund','biz_link_agent','biz_payment_submit','biz_owner_context',
      'deal_settings','deal_greet','deal_start','deal_open_for_owner','deal_start_by_agent','deal_find','deal_read','deal_post','ceo_desk','ceo_claims_approve','ceo_claim_reject',
      'ceo_payment_record','ceo_payment_decide','ceo_commissions_pay','ceo_revenue','ceo_deal_update','ceo_card_agent','ceo_setting_set','agent_desk','biz_benita_context','biz_product_price')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
