-- Card visits, guest reviews, verified app reviews, "Did you know" facts and owner customer numbers.

-- 1. Every card opening gets a one-use visit token. A card review needs a real tap, and one tap gives one review.
alter table public.connect_card_taps
  add column visit_token uuid not null default gen_random_uuid(),
  add column used_at timestamptz;
create unique index connect_card_taps_visit_token on public.connect_card_taps(visit_token);

-- 2. The app's reviews table records which card a review came from.
alter table public.reviews
  add column card_code text,
  add column verified_visit boolean not null default false;
create index reviews_card_code on public.reviews(card_code) where card_code is not null;
create index reviews_user_business on public.reviews(user_id, business_id_uuid, created_at desc);

-- People writing directly from the app can't mark their own review as verified.
create function public.reviews_guard_card_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if TG_OP = 'INSERT' then
      NEW.verified_visit := false; NEW.card_code := null;
    else
      NEW.verified_visit := OLD.verified_visit; NEW.card_code := OLD.card_code;
    end if;
  end if;
  return NEW;
end $$;
create trigger reviews_guard_card_fields before insert or update on public.reviews
  for each row execute function public.reviews_guard_card_fields();

-- 3. WhatsApp card reviews carry the same marks into the app.
create or replace function public.connect_sync_review_to_app() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  mapped uuid;
  who text;
  new_id uuid;
begin
  if NEW.status <> 'published' or NEW.directory_business_id is null then
    return NEW;
  end if;
  select review_id into mapped from public.connect_review_app_sync where connect_review_id = NEW.id;
  if NEW.whatsapp_identity_id is not null then
    select nullif(trim(display_name), '') into who from public.whatsapp_identities where id = NEW.whatsapp_identity_id;
  end if;
  who := coalesce(who, nullif(trim(NEW.reviewer_name), ''));
  if mapped is null then
    insert into public.reviews (user_id, business_id, rating, comment, user_name, is_anonymous, created_at, card_code, verified_visit)
    values ('whatsapp:' || coalesce(NEW.whatsapp_identity_id::text, NEW.profile_id::text, NEW.id::text),
      NEW.directory_business_id::text, NEW.rating, NEW.review_text,
      coalesce(who, 'TrustHub Connect user'), NEW.is_anonymous, NEW.created_at, NEW.card_code, coalesce(NEW.verified_visit, false))
    returning id into new_id;
    insert into public.connect_review_app_sync (connect_review_id, review_id) values (NEW.id, new_id);
  else
    update public.reviews set rating = NEW.rating, comment = NEW.review_text,
      business_id = NEW.directory_business_id::text, is_anonymous = NEW.is_anonymous,
      card_code = NEW.card_code, verified_visit = coalesce(NEW.verified_visit, false)
    where id = mapped;
  end if;
  return NEW;
end; $function$;

update public.reviews r set card_code = c.card_code, verified_visit = coalesce(c.verified_visit, false)
from public.connect_review_app_sync s join public.trusthub_connect_reviews c on c.id = s.connect_review_id
where s.review_id = r.id;

-- 4. The review page checks a visit, then saves through it. Guests have no account, so the review is on nobody's record.
create function public.card_visit_open(p_visit uuid) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select json_build_object('valid', true, 'business_id', c.business_id, 'card_code', c.code)
    from connect_card_taps t join connect_review_cards c on c.id = t.card_id
    where t.visit_token = p_visit and t.used_at is null and t.tapped_at > now() - interval '12 hours'
      and c.status = 'active' and c.business_id is not null
  ), json_build_object('valid', false));
$$;

create function public.card_review_submit(p_visit uuid, p_rating integer, p_comment text, p_anonymous boolean default false) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_uid uuid := auth.uid();
  v_text text := left(trim(coalesce(p_comment, '')), 2000);
  v_id uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if v_text = '' then raise exception 'empty_comment'; end if;
  select t.id as tap_id, c.code, c.business_id into v
  from connect_card_taps t join connect_review_cards c on c.id = t.card_id
  where t.visit_token = p_visit and t.used_at is null and t.tapped_at > now() - interval '12 hours'
    and c.status = 'active' and c.business_id is not null
  for update of t;
  if not found then raise exception 'visit_expired'; end if;
  insert into reviews (user_id, business_id, rating, comment, user_name, is_anonymous, created_at, card_code, verified_visit)
  values (coalesce(v_uid::text, 'guest:' || gen_random_uuid()), v.business_id::text, p_rating, v_text,
    case when v_uid is null then 'Verified visitor' else 'TrustHub member' end,
    v_uid is not null and coalesce(p_anonymous, false), now(), v.code, true)
  returning id into v_id;
  update connect_card_taps set used_at = now() where id = v.tap_id;
  return json_build_object('review_id', v_id, 'business_id', v.business_id);
end $$;

revoke all on function public.card_visit_open(uuid) from public;
revoke all on function public.card_review_submit(uuid, integer, text, boolean) from public;
grant execute on function public.card_visit_open(uuid) to anon, authenticated;
grant execute on function public.card_review_submit(uuid, integer, text, boolean) to anon, authenticated;

-- 5. "Did you know" facts use the owner's existing posts, so they get the same ownership checks and public reading rule.
alter table public.biz_announcements drop constraint biz_announcements_kind_check;
alter table public.biz_announcements add constraint biz_announcements_kind_check
  check (kind = any (array['announcement', 'special', 'event', 'closed', 'fact']));

-- 6. What the owner sees about their customers. Totals only, never who.
create function public.biz_customer_numbers(p_business uuid) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with taps as (
    select t.channel, t.tapped_at from connect_card_taps t join connect_review_cards c on c.id = t.card_id
    where c.business_id = p_business and t.tapped_at > now() - interval '30 days'
  ), recent as (
    select * from reviews where business_id_uuid = p_business and created_at > now() - interval '30 days'
  ), people as (
    select user_id, count(*) n, (array_agg(rating order by created_at))[1] first_rating, (array_agg(rating order by created_at desc))[1] last_rating
    from reviews where business_id_uuid = p_business and user_id not like 'guest:%' group by user_id
  ), days as (
    select to_char(tapped_at at time zone 'Africa/Harare', 'FMDay') d, count(*) n from taps group by 1 order by 2 desc limit 1
  )
  select json_build_object(
    'taps_30', (select count(*) from taps),
    'by_channel', (select coalesce(json_object_agg(channel, n), '{}') from (select channel, count(*) n from taps group by 1) x),
    'card_reviews_30', (select count(*) from recent where card_code is not null),
    'verified_30', (select count(*) from recent where verified_visit),
    'tap_to_review_pct', (select case when count(*) = 0 then null else least(100, round(100.0 * (select count(*) from recent where card_code is not null) / count(*))) end from taps),
    'known_customers', (select count(*) from people),
    'returning_customers', (select count(*) from people where n > 1),
    'rating_change', (select round(avg(last_rating - first_rating)::numeric, 1) from people where n > 1),
    'busiest_day', (select d from days),
    'fact_views', (select coalesce(sum(views), 0) from biz_announcements where business_id = p_business and kind = 'fact')
  );
$$;
revoke all on function public.biz_customer_numbers(uuid) from public, anon, authenticated;

create function public.biz_customer_insights(p_business uuid) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.biz_is_owner(p_business) then raise exception 'Not your business'; end if;
  return public.biz_customer_numbers(p_business);
end $$;
revoke all on function public.biz_customer_insights(uuid) from public, anon;
grant execute on function public.biz_customer_insights(uuid) to authenticated;

-- Benita gets the same numbers for owner reports.
do $$
declare v_def text := pg_get_functiondef('public.biz_benita_context(uuid)'::regprocedure);
begin
  if position($q$'has_website',$q$ in v_def) = 0 then raise exception 'biz_benita_context has changed'; end if;
  execute replace(v_def, $q$'has_website',$q$, $q$'customers', public.biz_customer_numbers(p_business), 'has_website',$q$);
end $$;
