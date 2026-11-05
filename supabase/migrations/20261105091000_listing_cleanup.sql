-- Applied live on 5 Nov 2026. The removed rows are kept in the private schema
-- listing_cleanup_20261105. See the listing_homes_with_phones wrapper below.
alter function public.listing_not_business_reason(text, text, text, text) rename to listing_reason_core;

create or replace function public.listing_not_business_reason(p_name text, p_sub text, p_phone text, p_website text)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text := lower(btrim(replace(coalesce(p_name, ''), '’', '''')));
  s text := lower(btrim(coalesce(p_sub, '')));
begin
  if nullif(btrim(coalesce(p_phone, '')), '') is not null and nullif(btrim(coalesce(p_website, '')), '') is null and s <> '' then
    if n ~ '(homestead|home steady|\mhousehold\M|\mresidences?\M|\mresidents\M|\mresidency\M|\mkumusha\M|village head|\mheadman\M)' and n !~ '(guest|lodge|hotel|school|clinic|health|hospital|church|children|care|nursing)' then return 'a private home'; end if;
    if s = 'apartment' and (n ~ '^[0-9]' or n !~ 'lodge|guest|hotel|motel|\minn\M|resort|\msuites?\M|safari|chalets|backpackers|b&b|bnb|cottages?|villas?|holiday|apartments') then return 'looks like a private place: apartment'; end if;
  end if;
  return public.listing_reason_core(p_name, p_sub, p_phone, p_website);
end $$;
