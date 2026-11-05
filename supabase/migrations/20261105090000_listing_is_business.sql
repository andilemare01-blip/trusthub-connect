-- Decides whether a listing from an outside feed is really a business.
-- Returns why it isn't, or null when it is. Anything with a phone or website stays.
create or replace function public.listing_not_business_reason(p_name text, p_sub text, p_phone text, p_website text)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text := lower(btrim(replace(coalesce(p_name, ''), '’', '''')));
  s text := lower(btrim(coalesce(p_sub, '')));
  trade constant text := '\m(pvt|ltd|limited|enterprises?|investments?|holdings|trading|company|shops?|stores?|supermarket|mart|butchery|pharmacy|chemist|salon|barber|boutique|hardware|spares|motors|carsales|garage|bakery|restaurant|cafe|takeaways?|tuck ?shop|bottle ?store|bar|tavern|hotel|lodge|clinic|surgery|school|college|academy|church|bank|wholesale|furniture|electronics|fashion|services|solutions|consultants?|associates|industries|construction|engineering|transport|logistics|printers?|studio|centre|center|complex|plaza|mall|market|cash and carry|bazaar)\M';
  stay constant text := 'lodge|guest|hotel|motel|\minn\M|resort|\msuites?\M|safari|chalets|backpackers|b&b|bnb|retreat|tented|cottages?|villas?|holiday|apartments|caravan|recreation|\mcamp(site|ing)?\M';
begin
  if nullif(btrim(coalesce(p_phone, '')), '') is not null or nullif(btrim(coalesce(p_website, '')), '') is not null then return null; end if;
  if n !~ '[[:alpha:]]' or length(n) < 2 or (length(n) = 2 and n <> all (array['ok','tm','bp','zb'])) then return 'no real name'; end if;
  if n = any (array['home','house','shop','store','food','borehole','grinding mill','boarding house','room','hall','office','bar','restaurant','hostel','dorm','staff house','staff room','staff quarters','staff houses','tuck shop','tuckshop','kiosk','market','school','clinic','church','hospital','company','business','toilet','toilets','parking','car park','guest house','lodge','hotel','beerhall','beer hall','butchery','bottle store','salon','barber shop','barbershop','hair salon','pharmacy','garage','general dealer','grocery','supermarket','bakery','bus stop','rank','pepsi','coca cola','mine','shops','hardware','tuck','accommodation','accomodation','students accomodation','student accommodation']) then return 'generic name'; end if;
  if s = any (array['water point','drinking water','watering place','parking','parking space','artwork','post box','grave yard','toilets','fountain','lake','refugee site','hunting stand','camp pitch','ranger station','atm','prison','no','bed','bird sanctuary','telephone','waste transfer station','water works','political party']) then return 'not a business type: ' || s; end if;
  if s = any (array['fixme','shelter']) and n !~ trade then return 'unknown building'; end if;
  if s = 'yes' and n ~ '\m(building|room|tollgate|ticket office|resistance|tent)\M' and n !~ trade then return 'unknown building'; end if;
  if s = any (array['apartment','chalet','hostel','wilderness hut','alpine hut','camp site','lodging']) and (n !~ stay or n ~ '#') then return 'looks like a private place: ' || s; end if;
  if n !~ 'drilling|install' and n ~ 'turn ?off|borehole|booster|\mdam\M\s*#|^(block|room|ward|dorm|wing)\s*[a-z0-9]{1,3}$|\m(dorm|staff (house|houses|room|quarters)|adm[a-z]*istration block|laboratory block|lectures? house|girls hostel|boys hostel|security''s house|storeroom)\M' then return 'part of a site, not a business'; end if;
  if n ~ '^[0-9]+[a-z]?\s+.*\m(road|rd|street|st|avenue|ave|drive|close|crescent|way)$' then return 'just an address'; end if;
  if n !~ trade and n !~ '(children|care|nursing|old people|masonic|funeral|affairs)' then
    if n ~ '(homestead|home steady|\mhousehold\M|\mresidences?\M|\mresidents\M|\mresidency\M|\mhouz\M|\mkumusha\M|village head|\mheadman\M|\mfamily$|''s (place|home)\M|s home$)' then return 'a private home'; end if;
    if n ~ '\m(home|house)\M' and n !~ '(boarding|guest)' and s = any (array['guest house','guest lodge','artwork','doctor','doctors','cinema']) then return 'a private home'; end if;
    if n ~ '^(sekuru|gogo|mbuya|ambuya|amai|mai|baba|babamukuru|tete|mr|mrs|ms|va|mukoma|mainini|amainini)\.?\s' and s = any (array['guest house','hotel','guest lodge','motel','doctor','doctors','cinema','artwork','school']) then return 'a person, not a business'; end if;
  end if;
  return null;
end $$;


-- Every suburb people can filter by, town by town, with common spellings.
create table if not exists public.listing_areas (
  city text not null, area text not null, aliases text[] not null default '{}',
  primary key (city, area)
);
alter table public.listing_areas enable row level security;
drop policy if exists "Anyone can read areas" on public.listing_areas;
create policy "Anyone can read areas" on public.listing_areas for select using (true);
grant select on public.listing_areas to anon, authenticated;

insert into public.listing_areas (city, area, aliases) values
 ('Harare','Highfield','{highfields,highfiled}'),('Harare','Borrowdale','{borodale,borodel,borrowdel,borowdale,borrow dale}'),
 ('Harare','Braeside','{brayside,breside,braiside}'),('Harare','CBD','{city centre,city center,town,harare cbd}'),
 ('Harare','Avondale','{}'),('Harare','Mount Pleasant','{mt pleasant}'),('Harare','Hatfield','{}'),('Harare','Belvedere','{}'),
 ('Harare','Eastlea','{}'),('Harare','Msasa','{}'),('Harare','Southerton','{}'),('Harare','Workington','{}'),('Harare','Graniteside','{}'),
 ('Harare','Highlands','{}'),('Harare','Greendale','{}'),('Harare','Mabvuku','{}'),('Harare','Tafara','{}'),('Harare','Budiriro','{}'),
 ('Harare','Glen Norah','{glenorah}'),('Harare','Glen View','{glenview}'),('Harare','Kuwadzana','{kuwdzana}'),('Harare','Warren Park','{}'),
 ('Harare','Marlborough','{}'),('Harare','Mandara','{}'),('Harare','Newlands','{}'),('Harare','Milton Park','{}'),('Harare','Alexandra Park','{}'),
 ('Harare','Ballantyne Park','{}'),('Harare','Chisipite','{}'),('Harare','Greystone Park','{}'),('Harare','Hogerty Hill','{}'),('Harare','Helensvale','{}'),
 ('Harare','Vainona','{}'),('Harare','Pomona','{}'),('Harare','Emerald Hill','{}'),('Harare','Strathaven','{}'),('Harare','Kensington','{}'),
 ('Harare','Belgravia','{}'),('Harare','Cranborne','{}'),('Harare','Queensdale','{}'),('Harare','Hillside','{}'),('Harare','Arcadia','{}'),
 ('Harare','Ardbennie','{}'),('Harare','Willowvale','{}'),('Harare','Aspindale','{}'),('Harare','Lochinvar','{}'),('Harare','Prospect','{}'),
 ('Harare','Waterfalls','{}'),('Harare','Parktown','{}'),('Harare','Mainway Meadows','{}'),('Harare','Epworth','{}'),('Harare','Hatcliffe','{}'),
 ('Harare','Dzivarasekwa','{dzivaresekwa,dzivarasekwa}'),('Harare','Mufakose','{}'),('Harare','Mbare','{}'),('Harare','Westgate','{}'),('Harare','Bluff Hill','{}'),
 ('Harare','Mabelreign','{}'),('Harare','Sentosa','{}'),('Harare','Meyrick Park','{}'),('Harare','Tynwald','{}'),('Harare','Ashdown Park','{}'),
 ('Harare','Monavale','{}'),('Harare','Rolf Valley','{}'),('Harare','Gunhill','{gun hill}'),('Harare','Arundel','{}'),('Harare','Westwood','{}'),
 ('Harare','Matapi','{}'),('Harare','Chitungwiza','{chitown}')
on conflict do nothing;

-- Finds the suburb in an address. "Hatfield Road" is a road, not Hatfield.
create or replace function public.listing_area_from_address(p_city text, p_address text)
returns text language sql stable set search_path = public as $$
  select a.area from public.listing_areas a
  cross join lateral (select string_agg(regexp_replace(x, '([^[:alnum:] ])', '\\\1', 'g'), '|') pat from unnest(array[a.area] || a.aliases) x) p
  where lower(a.city) = lower(btrim(p_city)) and nullif(p_address, '') is not null
    and lower(p_address) ~ ('\m(' || lower(p.pat) || ')\M(?!\s+(road|rd|street|st|drive|dr|avenue|ave|way|lane|close|crescent|cres)\M)')
  order by length(a.area) desc limit 1
$$;

create or replace function public.listing_clean_name(p_name text)
returns text language sql immutable as $$
  select btrim(replace(replace(replace(replace(regexp_replace(coalesce(p_name, ''), '\s*-\s*ZimPlaza Business Directory\s*$', '', 'i'), '&#039;', ''''), '&amp;', '&'), '&quot;', '"'), '&#8211;', '-'))
$$;

-- The one gate every outside feed passes through. People adding their own business are never blocked.
create or replace function public.businesses_real_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.user_id is null and new.source in ('knowledge_records', 'overture', 'openstreetmap') then
    if public.listing_not_business_reason(new.name, new.subcategory, new.phone, new.website) is not null then return null; end if;
    new.name := public.listing_clean_name(new.name);
  end if;
  if nullif(btrim(coalesce(new.area, '')), '') is null then new.area := public.listing_area_from_address(new.city, new.address); end if;
  return new;
end $$;
drop trigger if exists businesses_real_only on public.businesses;
create trigger businesses_real_only before insert or update of address, city on public.businesses for each row execute function public.businesses_real_only();

create or replace function public.knowledge_real_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.record_type in ('business', 'service', 'school', 'healthcare') and coalesce(new.claimed_status, 'unclaimed') = 'unclaimed'
     and public.listing_not_business_reason(new.name, new.subcategory, new.phone, new.website) is not null then
    new.record_type := 'other';
  end if;
  return new;
end $$;
drop trigger if exists knowledge_real_only on public.knowledge_records;
create trigger knowledge_real_only before insert or update of name, subcategory, phone, website, record_type on public.knowledge_records for each row execute function public.knowledge_real_only();

-- Businesses around a map point, nearest first, then others in the same suburb that have no map point.
create or replace function public.businesses_near(p_lat double precision, p_lng double precision, p_km double precision default 15, p_limit int default 200)
returns setof public.businesses language sql stable set search_path = public as $$
  with near as (
    select b.id, lower(b.area) a, lower(b.city) c, 6371 * 2 * asin(least(1, sqrt(power(sin(radians(b.latitude - p_lat) / 2), 2) + cos(radians(p_lat)) * cos(radians(b.latitude)) * power(sin(radians(b.longitude - p_lng) / 2), 2)))) km
    from public.businesses b
    where b.latitude between p_lat - p_km / 110.0 and p_lat + p_km / 110.0 and b.longitude between p_lng - p_km / 100.0 and p_lng + p_km / 100.0
  ), kept as (select * from near where km <= p_km order by km limit p_limit),
  around as (select distinct a, c from (select a, c from kept where a is not null order by km limit 5) t),
  wanted as (
    select id, km from kept
    union all
    select b.id, 1000 from public.businesses b join around r on lower(b.area) = r.a and lower(b.city) = r.c where b.latitude is null
  )
  select b.* from public.businesses b join wanted w on w.id = b.id order by w.km limit p_limit + 100
$$;
grant execute on function public.businesses_near(double precision, double precision, double precision, int) to anon, authenticated;
