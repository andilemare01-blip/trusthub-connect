-- "Review later": a customer picks a time and Wisdom reminds them on WhatsApp.
create table public.connect_review_reminders (
  id uuid primary key default gen_random_uuid(),
  whatsapp_identity_id bigint not null references public.whatsapp_identities(id) on delete cascade,
  card_code text not null,
  business_name text not null,
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'done', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index connect_review_reminders_due on public.connect_review_reminders(due_at) where status = 'scheduled';
create index connect_review_reminders_person on public.connect_review_reminders(whatsapp_identity_id, status);
alter table public.connect_review_reminders enable row level security;
revoke all on public.connect_review_reminders from anon, authenticated;

create function public.connect_reminders_claim(p_limit integer default 20) returns table (id uuid, card_code text, business_name text, phone_number text)
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select r.id from connect_review_reminders r where r.status = 'scheduled' and r.due_at <= now()
    order by r.due_at limit p_limit for update skip locked
  ), claimed as (
    update connect_review_reminders r set status = 'sent', sent_at = now() from due where r.id = due.id
    returning r.id, r.card_code, r.business_name, r.whatsapp_identity_id
  )
  select c.id, c.card_code, c.business_name, w.phone_number from claimed c join whatsapp_identities w on w.id = c.whatsapp_identity_id;
$$;
revoke all on function public.connect_reminders_claim(integer) from public, anon, authenticated;

select cron.schedule('connect-review-reminders', '* * * * *', $job$
  select net.http_get(
    url := 'https://trusthub-connect.vercel.app/api/cron/review-reminders',
    headers := jsonb_build_object('x-benita-secret', (select value from public.benita_settings where key = 'cron_secret')),
    timeout_milliseconds := 30000)
  where exists (select 1 from public.connect_review_reminders where status = 'scheduled' and due_at <= now());
$job$);
