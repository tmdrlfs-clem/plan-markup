-- Story 10.9 (FR14, FR16): activity for the platform admin and for company admins.
--
-- activity_summary(p_scope)   one row per account: when it was last active,
--                             how many markups it saved (counted from
--                             markups.created_at by author) and how many PDFs
--                             it exported (activity_events), in total and for
--                             each of the last four weeks.
--
-- Counts and times only: no drawing title, file name or markup content is
-- read. Weeks start on Monday, New Zealand time.
--
-- The caller is checked inside (auth.uid(), NFR22):
--   'platform'  an active platform admin gets every account;
--   'company'   an active company admin gets the members of their own company;
--   anyone else gets no rows.

create index markups_author_created_idx on public.markups (author_id, created_at);
create index activity_events_user_occurred_idx on public.activity_events (user_id, occurred_at desc);

create function public.activity_summary(p_scope text)
returns table (
  user_id uuid,
  name text,
  email text,
  status text,
  company_id uuid,
  company_name text,
  last_active_at timestamptz,
  markups_total integer,
  markups_by_week integer[],
  exports_total integer,
  exports_by_week integer[]
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
    coalesce(mk.total, 0)::integer,
    array[coalesce(mk.w0, 0), coalesce(mk.w1, 0), coalesce(mk.w2, 0), coalesce(mk.w3, 0)]::integer[],
    coalesce(ev.total, 0)::integer,
    array[coalesce(ev.w0, 0), coalesce(ev.w1, 0), coalesce(ev.w2, 0), coalesce(ev.w3, 0)]::integer[]
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
           count(*) filter (where k.created_at >= v_w3 and k.created_at < v_w2) as w3
    from public.markups k
    where k.author_id = p.id
  ) mk on true
  left join lateral (
    -- Last activity counts every event; the totals count exported PDFs only.
    select count(*) filter (where e.name = 'markup.exported') as total,
           max(e.occurred_at) as last_at,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w0) as w0,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w1 and e.occurred_at < v_w0) as w1,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w2 and e.occurred_at < v_w1) as w2,
           count(*) filter (where e.name = 'markup.exported' and e.occurred_at >= v_w3 and e.occurred_at < v_w2) as w3
    from public.activity_events e
    where e.user_id = p.id
  ) ev on true
  where p_scope = 'platform' or m.company_id = v_company
  order by c.name nulls last, p.email
  limit 2000;
end;
$$;

revoke execute on function public.activity_summary(text) from public, anon;
grant execute on function public.activity_summary(text) to authenticated;
