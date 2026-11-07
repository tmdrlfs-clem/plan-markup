-- Story 8.4 (FR80, AR21): product activity events for pilot metrics.
--
-- activity_events  one row per completed action, named <domain>.<past_verb>
--                  (markup.exported, drawing.printed): when, who, which markup
--                  set (a drawings row, when the user has one for the file),
--                  how many pages and markups, and the kind of output. Never
--                  drawing content, titles or file names: there is no free
--                  text or JSON column to put them in.
--
-- Insert own (active users only, into their own markup set); select by the
-- platform admin only; never updated or deleted by users. The time
-- is the server's (a trigger), and each user may record at most 120
-- events a minute (public.consume_rate_limit, as apply_markup_ops does).

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  drawing_id uuid references public.drawings (id) on delete set null,
  page_count integer not null,
  markup_count integer not null default 0,
  kind text not null,
  constraint activity_events_name_check check (name in ('markup.exported', 'drawing.printed')),
  constraint activity_events_page_count_check check (page_count between 1 and 100000),
  constraint activity_events_markup_count_check check (markup_count between 0 and 10000000),
  constraint activity_events_kind_check check (
    (name = 'markup.exported' and kind in ('editable', 'flattened'))
    or (name = 'drawing.printed' and kind in ('with_markups', 'without_markups'))
  )
);

create index activity_events_occurred_idx on public.activity_events (occurred_at desc);
create index activity_events_name_idx on public.activity_events (name, occurred_at desc);
create index activity_events_user_idx on public.activity_events (user_id);
create index activity_events_drawing_idx on public.activity_events (drawing_id);

comment on table public.activity_events is 'Product activity events (Story 8.4, FR80): no drawing content. Insert own; platform admin reads.';

-- ---------------------------------------------------------------------------
-- app.fn_activity_event_defaults(): the server's time and the per-user
-- rate limit. SECURITY DEFINER only to call
-- consume_rate_limit (service_role only); its caller is auth.uid() (NFR22).
-- ---------------------------------------------------------------------------
create function app.fn_activity_event_defaults()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- The user stays as given: RLS (checked after this trigger) refuses anyone else.
  new.occurred_at := pg_catalog.now();
  select r.allowed into v_allowed
  from public.consume_rate_limit(
    'activity_events',
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_uid::text, 'UTF8')), 'hex'),
    120,
    60
  ) r;
  if not v_allowed then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

revoke execute on function app.fn_activity_event_defaults() from public, anon, authenticated;

create trigger activity_events_defaults
  before insert on public.activity_events
  for each row execute function app.fn_activity_event_defaults();

alter table public.activity_events enable row level security;

create policy activity_events_insert_own on public.activity_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select app.fn_is_active_user())
    and (drawing_id is null or exists (select 1 from public.drawings d where d.id = drawing_id and d.owner_id = (select auth.uid())))
  );

create policy activity_events_select_admin on public.activity_events
  for select to authenticated
  using ((select app.fn_is_platform_admin()));

revoke all on public.activity_events from anon;
revoke all on public.activity_events from authenticated;
grant select, insert on public.activity_events to authenticated;
