-- Story 10.9, founder request (2026-11-16): how much each account used the
-- product in a week, by kind of work, and on how many days.
--
-- activity_summary() gains, for each of the last four weeks:
--   active_days_by_week   days with a saved markup or an event (0 to 7);
--   drawings_by_week      different markup sets the account saved markups in;
--   prints_by_week        drawing.printed events;
--   placements_by_week    sprinkler.placed events (Place heads runs).
-- The return type changes, so the function is dropped and made again. Still
-- counts and times only, and the same caller checks.

drop function public.activity_summary(text);

create function public.activity_summary(p_scope text)
returns table (
  user_id uuid,
  name text,
  email text,
  status text,
  company_id uuid,
  company_name text,
  last_active_at timestamptz,
  active_days_by_week integer[],
  drawings_by_week integer[],
  markups_total integer,
  markups_by_week integer[],
  exports_total integer,
  exports_by_week integer[],
  prints_by_week integer[],
  placements_by_week integer[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
  -- The start of this week (Monday 00:00) on New Zealand's clock, and the three before it.
  v_local timestamp := pg_catalog.date_trunc('week', pg_catalog.now() at time zone 'Pacific/Auckland');
  v_w0 timestamptz := v_local at time zone 'Pacific/Auckland';
  v_w1 timestamptz := (v_local - interval '7 days') at time zone 'Pacific/Auckland';
  v_w2 timestamptz := (v_local - interval '14 days') at time zone 'Pacific/Auckland';
  v_w3 timestamptz := (v_local - interval '21 days') at time zone 'Pacific/Auckland';
begin
  if p_scope is null or p_scope not in ('platform', 'company') then
    raise exception 'scope must be platform or company' using errcode = '22023';
  end if;
  if v_uid is null then
    return;
  end if;
  if p_scope = 'platform' then
    if not exists (
      select 1 from public.profiles a where a.id = v_uid and a.status = 'active' and a.is_platform_admin
    ) then
      return;
    end if;
  else
    select m.company_id into v_company
    from public.company_members m
    join public.profiles a on a.id = m.user_id
    where m.user_id = v_uid and m.role = 'admin' and a.status = 'active';
    if not found then
      return;
    end if;
  end if;

  return query
  select
    p.id,
    p.name,
    p.email,
    p.status,
    c.id,
    c.name,
    greatest(mk.last_at, ev.last_at, u.last_sign_in_at),
    array[coalesce(ad.w0, 0), coalesce(ad.w1, 0), coalesce(ad.w2, 0), coalesce(ad.w3, 0)]::integer[],
    array[coalesce(mk.d0, 0), coalesce(mk.d1, 0), coalesce(mk.d2, 0), coalesce(mk.d3, 0)]::integer[],
    coalesce(mk.total, 0)::integer,
    array[coalesce(mk.w0, 0), coalesce(mk.w1, 0), coalesce(mk.w2, 0), coalesce(mk.w3, 0)]::integer[],
    coalesce(ev.exports, 0)::integer,
    array[coalesce(ev.x0, 0), coalesce(ev.x1, 0), coalesce(ev.x2, 0), coalesce(ev.x3, 0)]::integer[],
    array[coalesce(ev.p0, 0), coalesce(ev.p1, 0), coalesce(ev.p2, 0), coalesce(ev.p3, 0)]::integer[],
    array[coalesce(ev.s0, 0), coalesce(ev.s1, 0), coalesce(ev.s2, 0), coalesce(ev.s3, 0)]::integer[]
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.company_members m on m.user_id = p.id
  left join public.companies c on c.id = m.company_id
  left join lateral (
    select count(*) as total,
           max(k.created_at) as last_at,
           count(*) filter (where k.created_at >= v_w0) as w0,
           count(*) filter (where k.created_at >= v_w1 and k.created_at < v_w0) as w1,
           count(*) filter (where k.created_at >= v_w2 and k.created_at < v_w1) as w2,
           count(*) filter (where k.created_at >= v_w3 and k.created_at < v_w2) as w3,
           count(distinct k.drawing_id) filter (where k.created_at >= v_w0) as d0,
           count(distinct k.drawing_id) filter (where k.created_at >= v_w1 and k.created_at < v_w0) as d1,
           count(distinct k.drawing_id) filter (where k.created_at >= v_w2 and k.created_at < v_w1) as d2,
           count(distinct k.drawing_id) filter (where k.created_at >= v_w3 and k.created_at < v_w2) as d3
    from public.markups k
    where k.author_id = p.id
  ) mk on true
  left join lateral (
    -- Last activity counts every event; each kind has its own weekly counts.
    select max(e.occurred_at) as last_at,
           count(*) filter (where e.name = 'markup.exported') as exports,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w0) as x0,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w1 and e.occurred_at < v_w0) as x1,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w2 and e.occurred_at < v_w1) as x2,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w3 and e.occurred_at < v_w2) as x3,
           count(*) filter (where e.name = 'drawing.printed' and e.occurred_at >= v_w0) as p0,
           count(*) filter (where e.name = 'drawing.printed' and e.occurred_at >= v_w1 and e.occurred_at < v_w0) as p1,
           count(*) filter (where e.name = 'drawing.printed' and e.occurred_at >= v_w2 and e.occurred_at < v_w1) as p2,
           count(*) filter (where e.name = 'drawing.printed' and e.occurred_at >= v_w3 and e.occurred_at < v_w2) as p3,
           count(*) filter (where e.name = 'sprinkler.placed' and e.occurred_at >= v_w0) as s0,
           count(*) filter (where e.name = 'sprinkler.placed' and e.occurred_at >= v_w1 and e.occurred_at < v_w0) as s1,
           count(*) filter (where e.name = 'sprinkler.placed' and e.occurred_at >= v_w2 and e.occurred_at < v_w1) as s2,
           count(*) filter (where e.name = 'sprinkler.placed' and e.occurred_at >= v_w3 and e.occurred_at < v_w2) as s3
    from public.activity_events e
    where e.user_id = p.id
  ) ev on true
  left join lateral (
    -- Days (New Zealand dates) on which the account saved a markup or did something that is recorded.
    select count(distinct d.at) filter (where d.at >= v_local::date) as w0,
           count(distinct d.at) filter (where d.at >= (v_local - interval '7 days')::date and d.at < v_local::date) as w1,
           count(distinct d.at) filter (where d.at >= (v_local - interval '14 days')::date and d.at < (v_local - interval '7 days')::date) as w2,
           count(distinct d.at) filter (where d.at < (v_local - interval '14 days')::date) as w3
    from (
      select (k.created_at at time zone 'Pacific/Auckland')::date as at
      from public.markups k
      where k.author_id = p.id and k.created_at >= v_w3
      union
      select (e.occurred_at at time zone 'Pacific/Auckland')::date
      from public.activity_events e
      where e.user_id = p.id and e.occurred_at >= v_w3
    ) d
  ) ad on true
  where p_scope = 'platform' or m.company_id = v_company
  order by c.name nulls last, p.email
  limit 2000;
end;
$$;

revoke execute on function public.activity_summary(text) from public, anon;
grant execute on function public.activity_summary(text) to authenticated;
