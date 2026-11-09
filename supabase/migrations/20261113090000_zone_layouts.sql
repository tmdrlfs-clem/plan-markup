-- Story 9.8 (FR73, A7): 4541 placement runs.
--
-- zone_layouts  one row per zone per Place heads run: which markup set and zone
--               (the zone markup's id; no foreign key, because the zone may
--               not have reached the server yet when its layout is saved),
--               the ruleset and version the run used (A7: a later rule
--               change never silently re-reads an old layout), the placer
--               inputs in mm, the result (heads, notes or a typed error) and
--               the oracle report. Append-only: a re-run adds a row.
--
-- Insert by whoever has access to the markup set (the owner until shares,
-- Epic 8); select the same; never updated or deleted by users (the rows go
-- with the markup set). Each user may save at most 120 rows a minute.
--
-- activity_events gains sprinkler.placed (kinds all_zones, selected_zones):
-- page_count is the run's one page and markup_count the heads placed. Counts
-- only, never drawing content.

create table public.zone_layouts (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  zone_id uuid not null,
  ruleset_id text not null,
  rule_figure_version text not null,
  status text not null,
  head_count integer not null default 0,
  inputs jsonb not null,
  result jsonb not null,
  report jsonb,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint zone_layouts_ruleset_check check (ruleset_id ~ '^[a-z0-9-]{1,40}$' and rule_figure_version ~ '^[0-9]{1,6}$'),
  constraint zone_layouts_status_check check (status in ('placed', 'infeasible', 'failed')),
  constraint zone_layouts_head_count_check check (head_count between 0 and 5000),
  constraint zone_layouts_inputs_check check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 1048576),
  constraint zone_layouts_result_check check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 1048576),
  constraint zone_layouts_report_check check (report is null or (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 1048576))
);

create index zone_layouts_zone_idx on public.zone_layouts (drawing_id, zone_id, created_at desc);
create index zone_layouts_created_by_idx on public.zone_layouts (created_by);

comment on table public.zone_layouts is 'A 4541 placement run per zone (Story 9.8, A7): ruleset version, inputs, result, report. Append-only.';

-- ---------------------------------------------------------------------------
-- app.fn_zone_layout_defaults(): the server's time, the caller as author and
-- the per-user rate limit. SECURITY DEFINER only to call consume_rate_limit
-- (service_role only); its caller is auth.uid() (NFR22).
-- ---------------------------------------------------------------------------
create function app.fn_zone_layout_defaults()
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
  new.created_at := pg_catalog.now();
  select r.allowed into v_allowed
  from public.consume_rate_limit(
    'zone_layouts',
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

revoke execute on function app.fn_zone_layout_defaults() from public, anon, authenticated;

create trigger zone_layouts_defaults
  before insert on public.zone_layouts
  for each row execute function app.fn_zone_layout_defaults();

alter table public.zone_layouts enable row level security;

create policy zone_layouts_insert_access on public.zone_layouts
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select app.fn_is_active_user())
    and app.fn_effective_access(drawing_id) in ('owner', 'edit')
  );

create policy zone_layouts_select_access on public.zone_layouts
  for select to authenticated
  using ((select app.fn_is_active_user()) and app.fn_effective_access(drawing_id) is not null);

revoke all on public.zone_layouts from anon;
revoke all on public.zone_layouts from authenticated;
grant select, insert on public.zone_layouts to authenticated;

-- ---------------------------------------------------------------------------
-- activity_events: sprinkler.placed
-- ---------------------------------------------------------------------------
alter table public.activity_events drop constraint activity_events_name_check;
alter table public.activity_events drop constraint activity_events_kind_check;
alter table public.activity_events add constraint activity_events_name_check
  check (name in ('markup.exported', 'drawing.printed', 'sprinkler.placed'));
alter table public.activity_events add constraint activity_events_kind_check check (
  (name = 'markup.exported' and kind in ('editable', 'flattened'))
  or (name = 'drawing.printed' and kind in ('with_markups', 'without_markups'))
  or (name = 'sprinkler.placed' and kind in ('all_zones', 'selected_zones'))
);
