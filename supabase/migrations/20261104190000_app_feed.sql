-- Feeds the TrustHub app from Benita and Connect: the Pulse and Activity feed,
-- community seeding through Benita, and an accurate businesses-added count.

create function public.app_pulse(p_city text default null) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with place as (select nullif(trim(coalesce(p_city, '')), '') as city)
  select json_build_object(
    'city', (select city from place),
    'facts', (select coalesce(json_agg(json_build_object('key', f.fact_key, 'label', f.label, 'value', f.value, 'unit', f.unit, 'currency', f.currency, 'date', f.effective_from)), '[]')
      from (select distinct on (fact_key) * from benita_facts where fact_key in ('fuel.petrol_blend', 'fuel.diesel', 'fuel.lpg', 'fx.usd_zwg') order by fact_key, effective_from desc) f),
    'news', (select coalesce(json_agg(n), '[]') from (
      select b.title, b.url, b.source_name, b.published_at, b.towns from benita_news b, place
      order by exists (select 1 from unnest(b.towns) t where lower(t) = lower(place.city)) desc, b.published_at desc nulls last limit 6) n),
    'reviews', (select coalesce(json_agg(r), '[]') from (
      select v.business_id_uuid as business_id, b.name as business, b.city, v.rating, left(coalesce(v.comment, ''), 140) as comment,
        case when v.is_anonymous then 'Anonymous' else coalesce(nullif(v.user_name, ''), 'TrustHub member') end as author,
        v.verified_visit, v.created_at
      from reviews v join businesses b on b.id = v.business_id_uuid, place
      order by (lower(b.city) = lower(place.city)) desc nulls last, v.created_at desc limit 8) r),
    'demand', (select coalesce(json_agg(d), '[]') from (
      select s.category, count(*) as searches from connect_search_log s, place
      where s.created_at > now() - interval '30 days' and coalesce(s.category, '') <> ''
        and (place.city is null or s.city is null or lower(s.city) = lower(place.city))
      group by 1 having count(*) >= 2 order by 2 desc limit 6) d),
    'posts', (select coalesce(json_agg(p), '[]') from (
      select a.business_id, b.name as business, b.city, a.kind, a.title, a.body from biz_announcements a join businesses b on b.id = a.business_id, place
      where a.is_active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      order by (lower(b.city) = lower(place.city)) desc nulls last, a.created_at desc limit 6) p),
    'jobs', (select coalesce(json_agg(j), '[]') from (
      select l.title, l.city, l.source_url from trusthub_connect_listings l, place
      where l.intent = 'recruiting' and l.status = 'pending' and l.source_url is not null and (l.expires_at is null or l.expires_at > now())
      order by (lower(l.city) = lower(place.city)) desc nulls last, l.created_at desc limit 5) j),
    'totals', (select json_build_object(
        'businesses', (select count(*) from businesses b where place.city is null or lower(b.city) = lower(place.city)),
        'new_30', (select count(*) from businesses b where b.created_at > now() - interval '30 days' and (place.city is null or lower(b.city) = lower(place.city))),
        'reviews', (select count(*) from reviews v join businesses b on b.id = v.business_id_uuid where place.city is null or lower(b.city) = lower(place.city)),
        'verified', (select count(*) from reviews v join businesses b on b.id = v.business_id_uuid where v.verified_visit and (place.city is null or lower(b.city) = lower(place.city))))
      from place)
  );
$$;
revoke all on function public.app_pulse(text) from public;
grant execute on function public.app_pulse(text) to anon, authenticated;

-- A new community is filled from what Benita already holds. If it is thin, Benita looks it up once.
create function public.app_seed_community(p_city text, p_area text default null) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_area text := nullif(trim(coalesce(p_area, '')), '');
  v_city_count integer;
  v_area_count integer := 0;
  v_looking boolean := false;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if v_city is null then return json_build_object('city_count', 0, 'area_count', 0, 'looking', false); end if;
  select count(*) into v_city_count from businesses where lower(city) = lower(v_city);
  if v_area is not null then select count(*) into v_area_count from businesses where lower(city) = lower(v_city) and lower(area) = lower(v_area); end if;
  if (v_city_count < 30 or (v_area is not null and v_area_count < 10))
     and (select count(*) from benita_live_lookups where looked_up_at > now() - interval '1 hour') < 20 then
    perform benita_call(jsonb_build_object('action', 'live', 'text', 'businesses in ' || left(concat_ws(' ', v_area, v_city), 80), 'city', left(v_city, 60), 'terms', jsonb_build_array('shops', 'restaurants', 'services')));
    v_looking := true;
  end if;
  return json_build_object('city_count', v_city_count, 'area_count', v_area_count, 'looking', v_looking);
end $$;
revoke all on function public.app_seed_community(text, text) from public, anon;
grant execute on function public.app_seed_community(text, text) to authenticated;

-- Keep the stored businesses-added count true.
create function public.profiles_sync_businesses_added_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update profiles p set businesses_added = (select count(*) from businesses b where b.user_id = p.user_id) where p.user_id = NEW.user_id;
  return null;
end $$;
create function public.profiles_sync_businesses_added_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update profiles p set businesses_added = (select count(*) from businesses b where b.user_id = p.user_id) where p.user_id = OLD.user_id;
  return null;
end $$;
create trigger profiles_businesses_added_insert after insert on public.businesses for each row when (NEW.user_id is not null) execute function public.profiles_sync_businesses_added_insert();
create trigger profiles_businesses_added_delete after delete on public.businesses for each row when (OLD.user_id is not null) execute function public.profiles_sync_businesses_added_delete();
update public.profiles p set businesses_added = (select count(*) from public.businesses b where b.user_id = p.user_id);
