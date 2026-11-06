-- Links a TrustHub app profile to a WhatsApp number. The app asks for a one-time code and opens WhatsApp with
-- "LINK <code>" typed in. The message arriving from that number proves the person owns it, with no SMS cost.
create table public.connect_link_codes (
  code text primary key,
  profile_id bigint not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index connect_link_codes_profile on public.connect_link_codes(profile_id);
alter table public.connect_link_codes enable row level security;
revoke all on public.connect_link_codes from public, anon, authenticated;
comment on table public.connect_link_codes is 'TrustHub Connect: one-time codes that link an app profile to a WhatsApp number. Server-only.';

-- The WhatsApp number the app sends people to, digits only. Fill this in before release.
insert into public.biz_settings (key, value) values ('connect_whatsapp_number', '') on conflict (key) do nothing;

create or replace function public.connect_start_link()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  profile bigint;
  new_code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  number text;
begin
  select id into profile from public.profiles where user_id = auth.uid() order by id limit 1;
  if profile is null then raise exception 'Create your profile first.'; end if;
  if exists (select 1 from public.whatsapp_identities where profile_id = profile) then
    return jsonb_build_object('linked', true);
  end if;
  select regexp_replace(value, '\D', '', 'g') into number from public.biz_settings where key = 'connect_whatsapp_number';
  if coalesce(number, '') = '' then raise exception 'WhatsApp linking is being set up. Please try again soon.'; end if;
  delete from public.connect_link_codes where profile_id = profile;
  insert into public.connect_link_codes (code, profile_id, expires_at) values (new_code, profile, now() + interval '15 minutes');
  return jsonb_build_object('linked', false, 'code', new_code, 'number', number);
end; $$;
revoke all on function public.connect_start_link() from public, anon;
grant execute on function public.connect_start_link() to authenticated;

create or replace function public.connect_finish_link(p_code text, p_identity bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  profile bigint;
  current_profile bigint;
  person text;
begin
  select profile_id into profile from public.connect_link_codes
    where code = lower(p_code) and used_at is null and expires_at > now() for update;
  if profile is null then return jsonb_build_object('status', 'expired'); end if;
  if exists (select 1 from public.whatsapp_identities where profile_id = profile and id <> p_identity) then
    return jsonb_build_object('status', 'profile_taken');
  end if;
  select profile_id into current_profile from public.whatsapp_identities where id = p_identity for update;
  if not found then return jsonb_build_object('status', 'expired'); end if;
  if current_profile is not null and current_profile <> profile then
    return jsonb_build_object('status', 'phone_taken');
  end if;
  select nullif(trim(name), '') into person from public.profiles where id = profile;
  update public.whatsapp_identities
    set profile_id = profile, linked_at = now(), display_name = coalesce(nullif(trim(display_name), ''), person)
    where id = p_identity;
  update public.connect_link_codes set used_at = now() where code = lower(p_code);
  return jsonb_build_object('status', 'linked', 'name', person);
end; $$;
revoke all on function public.connect_finish_link(text, bigint) from public, anon, authenticated;
grant execute on function public.connect_finish_link(text, bigint) to service_role;
