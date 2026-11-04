-- Rankings by town, province and country; Pulse insights; Activity moments; and the CEO's view of business credit use.

create table public.zw_towns (city text primary key, province text not null);
alter table public.zw_towns enable row level security;
create policy "Anyone can read towns" on public.zw_towns for select to anon, authenticated using (true);
insert into public.zw_towns (city, province) values
 ('harare','Harare'),('chitungwiza','Harare'),('epworth','Harare'),('bulawayo','Bulawayo'),
 ('chinhoyi','Mashonaland West'),('kariba','Mashonaland West'),('karoi','Mashonaland West'),('kadoma','Mashonaland West'),('chegutu','Mashonaland West'),('norton','Mashonaland West'),('banket','Mashonaland West'),('alaska','Mashonaland West'),
 ('marondera','Mashonaland East'),('murehwa','Mashonaland East'),('mutoko','Mashonaland East'),('macheke','Mashonaland East'),('ruwa','Mashonaland East'),('beatrice','Mashonaland East'),('goromonzi','Mashonaland East'),
 ('bindura','Mashonaland Central'),('shamva','Mashonaland Central'),('mount darwin','Mashonaland Central'),('mazowe','Mashonaland Central'),('guruve','Mashonaland Central'),('mvurwi','Mashonaland Central'),('muzarabani township','Mashonaland Central'),
 ('mutare','Manicaland'),('rusape','Manicaland'),('chipinge','Manicaland'),('nyanga','Manicaland'),('chimanimani','Manicaland'),('buhera','Manicaland'),('penhalonga','Manicaland'),
 ('masvingo','Masvingo'),('chiredzi','Masvingo'),('triangle','Masvingo'),('zaka','Masvingo'),('gutu','Masvingo'),('bikita','Masvingo'),('mwenezi','Masvingo'),
 ('gweru','Midlands'),('kwekwe','Midlands'),('redcliff','Midlands'),('zvishavane','Midlands'),('shurugwi','Midlands'),('gokwe','Midlands'),('mvuma','Midlands'),
 ('victoria falls','Matabeleland North'),('hwange','Matabeleland North'),('lupane','Matabeleland North'),('binga','Matabeleland North'),
 ('gwanda','Matabeleland South'),('beitbridge','Matabeleland South'),('plumtree','Matabeleland South');

-- Rankings never mix trades: each list is one category. People are listed only for reviews they chose to sign.
create function public.app_rankings(p_scope text default 'town', p_city text default null, p_category text default null) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with input as (
    select lower(nullif(trim(coalesce(p_city, '')), '')) as city, nullif(trim(coalesce(p_category, '')), '') as category
  ), town as (
    select i.city, i.category, t.province from input i left join zw_towns t on t.city = i.city
  ), scope as (
    select *, case
      when p_scope = 'country' or city is null then 'country'
      when p_scope = 'province' and province is not null then 'province'
      else 'town' end as kind from town
  ), scoped as (
    select b.id, b.name, coalesce(nullif(b.category, ''), 'Other') as category, b.city, r.rating, r.verified_visit, r.user_id, r.is_anonymous
    from reviews r join businesses b on b.id = r.business_id_uuid left join zw_towns t on t.city = lower(b.city), scope s
    where s.kind = 'country' or (s.kind = 'town' and lower(b.city) = s.city) or (s.kind = 'province' and t.province = s.province)
  ), categories as (
    select category, count(distinct id) as businesses, count(*) as reviews from scoped group by 1
  ), chosen as (
    select coalesce((select c.category from categories c, scope s where lower(c.category) = lower(s.category)),
      (select category from categories order by reviews desc, category limit 1)) as category
  ), board as (
    select s.id as business_id, s.name, s.city, round(avg(s.rating) * 20)::int as score, count(*) as reviews, count(*) filter (where s.verified_visit) as verified
    from scoped s, chosen c where s.category = c.category group by 1, 2, 3
    order by score desc, reviews desc, name limit 20
  ), people as (
    select p.user_id, split_part(trim(p.name), ' ', 1) as first_name, p.profile_image, count(*) as reviews, count(*) * 10 as points,
      rank() over (order by count(*) desc) as place
    from scoped s join profiles p on p.user_id::text = s.user_id
    where not s.is_anonymous and coalesce(trim(p.name), '') <> '' group by p.user_id, p.name, p.profile_image
  )
  select json_build_object(
    'scope', (select kind from scope),
    'label', (select case kind when 'country' then 'Zimbabwe' when 'province' then province else initcap(city) end from scope),
    'province', (select province from scope),
    'categories', (select coalesce(json_agg(c order by c.reviews desc, c.category), '[]') from categories c),
    'category', (select category from chosen),
    'businesses', (select coalesce(json_agg(b), '[]') from board b),
    'people', (select coalesce(json_agg(json_build_object('first_name', x.first_name, 'photo', x.profile_image, 'reviews', x.reviews, 'points', x.points, 'place', x.place, 'is_me', x.user_id = auth.uid())), '[]')
      from (select * from people order by place, first_name limit 10) x),
    'me', (select json_build_object('name', p.name, 'photo', p.profile_image,
        'reviews', (select count(*) from reviews r where r.user_id = p.user_id::text),
        'businesses', (select count(*) from businesses b where b.user_id = p.user_id),
        'battles', (select count(*) from trust_battle_records t where t.user_id = p.user_id),
        'place', (select place from people where user_id = p.user_id))
      from profiles p where p.user_id = auth.uid() limit 1)
  );
$$;
revoke all on function public.app_rankings(text, text, text) from public;
grant execute on function public.app_rankings(text, text, text) to anon, authenticated;

-- Pulse: what the community is saying beneath the data. Uses the town when it has enough reviews, otherwise all of Zimbabwe.
create function public.app_insights(p_city text default null) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with themes(label, words, fix) as (values
    ('Customer service', array['service','friendly','rude','staff','helpful','attitude','polite','welcom'], 'Greet every customer and reply to every complaint within a day.'),
    ('Prices and value', array['price','expensive','cheap','value','afford','overpriced','cost','money'], 'Show prices clearly up front and offer a budget option.'),
    ('Quality', array['quality','fresh','good','bad','broken','excellent','poor','best','delicious','tasty','nice'], 'Check quality before handing over, and ask customers to raise problems before they leave.'),
    ('Speed and waiting', array['slow','wait','quick','fast','late','delay','long','queue'], 'Set a target waiting time and tell customers how long it will take.'),
    ('Honesty', array['scam','fraud','fake','lie','cheat','honest','trust','refund','stole'], 'Give receipts every time and write down what you agree.'),
    ('Cleanliness', array['clean','dirty','smell','toilet','hygien','neat'], 'Do a daily cleanliness check, including toilets and the entrance.'),
    ('Being reachable', array['call','phone','answer','whatsapp','respond','contact','reply','closed'], 'Keep your hours up to date and answer messages during business hours.')
  ), place as (
    select nullif(trim(coalesce(p_city, '')), '') as city
  ), local_count as (
    select count(*) as n from reviews v join businesses b on b.id = v.business_id_uuid, place where lower(b.city) = lower(place.city)
  ), pool as (
    select v.rating, v.comment, v.created_at, v.verified_visit, b.id, b.city, coalesce(nullif(b.category, ''), 'Other') as category
    from reviews v join businesses b on b.id = v.business_id_uuid, place, local_count
    where local_count.n < 5 or lower(b.city) = lower(place.city)
  ), scored as (
    select t.label, t.fix,
      count(*) filter (where p.rating >= 4) as praise,
      count(*) filter (where p.rating <= 3) as complaints
    from themes t join pool p on exists (select 1 from unnest(t.words) w where p.comment ilike '%' || w || '%')
    group by 1, 2
  ), growing as (
    select category,
      count(*) filter (where created_at > now() - interval '30 days') as recent,
      count(*) filter (where created_at <= now() - interval '30 days' and created_at > now() - interval '60 days') as earlier
    from pool group by 1
  )
  select json_build_object(
    'scope', case when (select n from local_count) < 5 then 'Zimbabwe' else (select city from place) end,
    'reviews', (select count(*) from pool),
    'average', (select round(avg(rating)::numeric, 1) from pool),
    'verified', (select count(*) from pool where verified_visit),
    'values', (select coalesce(json_agg(s order by s.praise desc), '[]') from (select label, praise from scored where praise > 0 order by praise desc limit 4) s),
    'complaints', (select coalesce(json_agg(s order by s.complaints desc), '[]') from (select label, complaints, fix from scored where complaints > 0 order by complaints desc limit 3) s),
    'growing', (select coalesce(json_agg(g order by g.recent desc), '[]') from (select category, recent, earlier from growing where recent > earlier order by recent desc limit 3) g)
  );
$$;
revoke all on function public.app_insights(text) from public;
grant execute on function public.app_insights(text) to anon, authenticated;

-- Activity: the moments that matter, worked out from what really happened. Your town comes first.
create function public.app_activity(p_city text default null) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with place as (
    select nullif(trim(coalesce(p_city, '')), '') as city
  ), reviewed as (
    select b.id, b.name, b.city, v.rating, v.created_at,
      row_number() over (partition by b.id order by v.created_at desc) as newest,
      row_number() over (partition by b.id order by v.created_at) as oldest,
      count(*) over (partition by b.id) as total,
      avg(v.rating) over (partition by b.id) as average
    from reviews v join businesses b on b.id = v.business_id_uuid
  ), summary as (
    select n.id, n.name, n.city, n.rating as latest, n.created_at, n.total,
      (select avg(e.rating) from reviewed e where e.id = n.id and e.newest > 1) as before
    from reviewed n where n.newest = 1
  ), moments as (
    select 'rising' as kind, id as business_id, name, city, 'is rising' as headline,
      'Latest rating ' || latest || ' stars, up from an average of ' || round(before, 1) as detail, created_at as at
    from summary where total >= 2 and latest >= before + 0.5
    union all
    select 'falling', id, name, city, 'is losing trust',
      'Latest rating ' || latest || ' stars, down from an average of ' || round(before, 1), created_at
    from summary where total >= 2 and latest <= before - 0.5
    union all
    select 'first', id, name, city, 'got its first review', 'New on TrustHub, rated ' || rating || ' stars', created_at
    from reviewed where oldest = 1 and total = 1 and created_at > now() - interval '60 days'
    union all
    select 'milestone', id, name, city, 'reached ' || oldest || ' reviews', 'A community milestone', created_at
    from reviewed where oldest in (5, 10, 25, 50, 100)
    union all
    select 'owner', b.id, b.name, b.city, 'is now owner-managed', 'The owner claimed this business', c.verified_at
    from business_claims c join businesses b on b.id = c.business_id where c.status = 'verified' and c.verified_at is not null
    union all
    select 'attention', b.id, b.name, b.city, 'is getting attention', count(*) || ' review card opens this week', max(t.tapped_at)
    from connect_card_taps t join connect_review_cards c on c.id = t.card_id join businesses b on b.id = c.business_id
    where t.tapped_at > now() - interval '7 days' group by 2, 3, 4 having count(*) >= 3
  )
  select json_build_object(
    'moments', (select coalesce(json_agg(m), '[]') from (
      select m.* from moments m, place order by (lower(m.city) = lower(place.city)) desc nulls last, m.at desc limit 20) m),
    'people', (select coalesce(json_agg(x), '[]') from (
      select split_part(trim(p.name), ' ', 1) as first_name, p.profile_image as photo, count(*) as reviews
      from reviews v join profiles p on p.user_id::text = v.user_id
      where not v.is_anonymous and coalesce(trim(p.name), '') <> '' and v.created_at > now() - interval '60 days'
      group by p.user_id, p.name, p.profile_image order by count(*) desc limit 5) x)
  );
$$;
revoke all on function public.app_activity(text) from public;
grant execute on function public.app_activity(text) to anon, authenticated;

-- The CEO's view of what businesses and WhatsApp users spend credits on.
create function public.ceo_credit_use() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  with ledger as (
    select l.*, case
      when l.reason = 'welcome' then 'welcome'
      when l.payment_id is not null then 'bought'
      when l.reason like 'refund: %' then replace(l.reason, 'refund: ', '')
      else l.reason end as use
    from biz_token_ledger l
  ), spending as (
    select * from ledger where use not in ('welcome', 'bought')
  ), per_business as (
    select business_id,
      coalesce(sum(delta) filter (where use = 'welcome'), 0) as free,
      coalesce(sum(delta) filter (where use = 'bought'), 0) as bought,
      coalesce(-sum(delta) filter (where use not in ('welcome', 'bought')), 0) as spent,
      coalesce(sum(delta), 0) as remaining,
      max(created_at) filter (where use not in ('welcome', 'bought')) as last_used
    from ledger group by 1
  )
  select json_build_object(
    'totals', json_build_object(
      'free', (select coalesce(sum(free), 0) from per_business), 'bought', (select coalesce(sum(bought), 0) from per_business),
      'spent', (select coalesce(sum(spent), 0) from per_business), 'remaining', (select coalesce(sum(remaining), 0) from per_business)),
    'uses', (select coalesce(json_agg(u order by u.tokens desc), '[]') from (
      select use, -sum(delta) as tokens, count(*) filter (where delta < 0) as times from spending group by 1 having sum(delta) < 0) u),
    'businesses', (select coalesce(json_agg(x order by x.spent desc, x.business), '[]') from (
      select b.name as business, p.free, p.bought, p.spent, p.remaining, p.last_used,
        (select s.use from spending s where s.business_id = p.business_id group by 1 order by -sum(s.delta) desc limit 1) as top_use
      from per_business p join businesses b on b.id = p.business_id) x),
    'customers', (select coalesce(json_agg(c order by c.times desc), '[]') from (
      select reason, count(*) as times, sum(delta) as credits from connect_credit_ledger group by 1) c)
  );
$$;
revoke all on function public.ceo_credit_use() from public, anon, authenticated;

-- Rankings compare like with like, so messy category names are grouped into trades.
create function public.app_trade(p_category text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when c ~ 'restaurant|food|dining|cafe|takeaway|bakery|fast' then 'Food & Dining'
    when c ~ 'hotel|lodge|accommodation|tourism|guest' then 'Hotels & Stays'
    when c ~ 'barber|salon|beauty|hair|spa' then 'Hair & Beauty'
    when c ~ 'retail|shop|store|grocer|supermarket|market' then 'Shops'
    when c ~ 'motor|garage|vehicle|car|mechanic' then 'Motoring'
    when c ~ 'health|clinic|pharmacy|hospital|doctor|dental' then 'Health'
    when c ~ 'school|education|college|university' then 'Education'
    when c ~ 'music|venue|club|bar|entertainment' then 'Entertainment'
    when c ~ 'construction|engineer|hardware|plumb|electric' then 'Building & Trades'
    when c = '' then 'Other'
    else initcap(regexp_replace(c, '^others?\s*-\s*', ''))
  end
  from (select lower(trim(coalesce(p_category, ''))) as c) x
$$;
do $$
declare v_def text := pg_get_functiondef('public.app_rankings(text,text,text)'::regprocedure);
begin
  execute replace(v_def, $q$coalesce(nullif(b.category, ''), 'Other') as category$q$, $q$app_trade(b.category) as category$q$);
end $$;
do $$
declare v_def text := pg_get_functiondef('public.app_insights(text)'::regprocedure);
begin
  execute replace(v_def, $q$coalesce(nullif(b.category, ''), 'Other') as category$q$, $q$app_trade(b.category) as category$q$);
end $$;

-- Approves every waiting listing at once, from the admin To check screen.
create function public.ceo_listings_approve_all() returns integer
language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare v_count integer;
begin
  update trusthub_connect_listings set status = 'approved', updated_at = now() where status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.ceo_listings_approve_all() from public, anon, authenticated;
