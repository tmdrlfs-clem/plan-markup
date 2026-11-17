-- Story 10.12 (FR72): a company's own use → hazard mapping.
--
-- A company's rows in use_hazard_map replace the platform default for its
-- members' new zones (a zone already drawn carries its own use and hazard).
--
-- set_company_use_hazard_map   replace the actor's company mapping with the
--                              given uses, or (null) remove it so the platform
--                              default applies again. One audited transaction.
--                              Called by the server with the service client
--                              (EXECUTE is service_role only); it checks its
--                              actor itself (NFR22).
--   PT403 the actor is not an active admin of a company
--   22023 the uses are not 1 to 50 objects with exactly one default
--   23514 a use name or hazard class is not allowed     23505 a use is named twice
--
-- A zone keeps the hazard class its use gave it when the use was chosen
-- (props.zone.hazard, written by the client through apply_markup_ops), so a
-- change of the mapping leaves the zones already drawn as classed. The zones
-- view names it (null on a zone drawn before this: it follows the mapping).
--
-- Until now every active user read every row (there were no company rows).
-- From here a company's rows are read by its members only, and the platform
-- admin's write policy covers the platform rows only.

delete from public.use_hazard_map m
where m.company_id is not null and not exists (select 1 from public.companies c where c.id = m.company_id);

alter table public.use_hazard_map
  add constraint fk_use_hazard_map_company foreign key (company_id) references public.companies (id) on delete cascade;

comment on table public.use_hazard_map is 'Use → hazard class (Story 9.1). company_id null = platform default (read: active users; write: platform admin). A company''s rows (Story 10.12): read by its members, written by set_company_use_hazard_map().';

drop policy use_hazard_map_select_active on public.use_hazard_map;
create policy use_hazard_map_select_platform_or_company on public.use_hazard_map
  for select to authenticated
  using (
    (company_id is null and (select app.fn_is_active_user()))
    or (company_id is not null and app.fn_is_company_member(company_id))
  );

drop policy use_hazard_map_write_admin on public.use_hazard_map;
create policy use_hazard_map_write_admin on public.use_hazard_map
  for all to authenticated
  using (company_id is null and (select app.fn_is_platform_admin()))
  with check (company_id is null and (select app.fn_is_platform_admin()));

create or replace view public.zones
with (security_invoker = true, security_barrier = true) as
select
  m.id,
  m.drawing_id,
  m.page_id,
  m.geometry -> 'points' as polygon,
  coalesce(m.geometry -> 'holes', '[]'::jsonb) as holes,
  coalesce(m.props -> 'zone' -> 'holeTags', '[]'::jsonb) as hole_tags,
  m.props -> 'zone' ->> 'name' as name,
  m.props -> 'zone' ->> 'use' as use,
  coalesce(m.props -> 'zone' -> 'options', '{}'::jsonb) as options,
  m.version,
  m.created_at,
  m.updated_at,
  m.props -> 'zone' ->> 'hazard' as hazard
from public.markups m
where m.type = 'zone' and m.deleted_at is null;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'user.plan_changed',
    'company.created', 'company.plan_changed',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed',
    'company.tool_set_published', 'company.tool_set_withdrawn',
    'company.use_hazard_map_changed', 'company.use_hazard_map_reset',
    'support.markup_sets_viewed'
  ));

-- A company's mapping as one value: {"default": use, "uses": {use: hazard, …}}; null when it has none.
create function app.fn_company_use_hazard_map(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 0 then null else pg_catalog.jsonb_build_object(
    'default', (pg_catalog.array_agg(m.use) filter (where m.is_default))[1],
    'uses', pg_catalog.jsonb_object_agg(m.use, m.hazard)
  ) end
  from public.use_hazard_map m
  where m.company_id = p_company_id;
$$;

revoke execute on function app.fn_company_use_hazard_map(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.set_company_use_hazard_map(). p_uses is a JSON array of
-- {"use": text, "hazard": text, "is_default": boolean}, or null to go back to
-- the platform default. Returns whether anything changed and the mapping's
-- version (null after a reset): each change takes the next number, never one
-- the company has used before.
-- ---------------------------------------------------------------------------
create function public.set_company_use_hazard_map(p_actor_id uuid, p_uses jsonb)
returns table (changed boolean, map_version text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_version text;
begin
  if p_actor_id is null then
    raise exception 'actor is required' using errcode = '22023';
  end if;

  -- The company row is locked: two changes to one mapping run one after the other.
  select c.id into v_company_id
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.user_id = p_actor_id and m.role = 'admin' and p.status = 'active'
  for update of c;
  if not found then
    raise exception 'not a company admin' using errcode = 'PT403';
  end if;

  v_before := app.fn_company_use_hazard_map(v_company_id);

  if p_uses is null or pg_catalog.jsonb_typeof(p_uses) = 'null' then
    changed := v_before is not null;
    map_version := null;
    if changed then
      delete from public.use_hazard_map m where m.company_id = v_company_id;
      insert into public.audit_log (actor_id, action, target_type, target_id, detail)
      values (p_actor_id, 'company.use_hazard_map_reset', 'company', v_company_id, pg_catalog.jsonb_build_object('from', v_before));
    end if;
    return next;
    return;
  end if;

  if pg_catalog.jsonb_typeof(p_uses) <> 'array' or pg_catalog.jsonb_array_length(p_uses) not between 1 and 50 then
    raise exception 'uses must be an array of 1 to 50' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_uses) e
    where pg_catalog.jsonb_typeof(e) <> 'object'
       or pg_catalog.jsonb_typeof(e -> 'use') is distinct from 'string'
       or pg_catalog.jsonb_typeof(e -> 'hazard') is distinct from 'string'
       or pg_catalog.jsonb_typeof(e -> 'is_default') is distinct from 'boolean'
  ) then
    raise exception 'each use needs use, hazard and is_default' using errcode = '22023';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_uses) e where (e ->> 'is_default')::boolean) <> 1 then
    raise exception 'exactly one use is the default' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'default', (pg_catalog.array_agg(e ->> 'use') filter (where (e ->> 'is_default')::boolean))[1],
    'uses', pg_catalog.jsonb_object_agg(e ->> 'use', e ->> 'hazard')
  ) into v_after
  from pg_catalog.jsonb_array_elements(p_uses) e;

  if v_before is not null and v_before = v_after then
    changed := false;
    select m.map_version into map_version from public.use_hazard_map m where m.company_id = v_company_id limit 1;
    return next;
    return;
  end if;

  select (count(*) + 1)::text into v_version
  from public.audit_log a
  where a.action = 'company.use_hazard_map_changed' and a.target_id = v_company_id;

  delete from public.use_hazard_map m where m.company_id = v_company_id;
  -- The table's own checks refuse a bad name (23514), hazard (23514) or a use named twice (23505).
  insert into public.use_hazard_map (company_id, map_version, use, hazard, is_default, verified)
  select v_company_id, v_version, e ->> 'use', e ->> 'hazard', (e ->> 'is_default')::boolean, true
  from pg_catalog.jsonb_array_elements(p_uses) e;

  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'company.use_hazard_map_changed', 'company', v_company_id,
          pg_catalog.jsonb_build_object('version', v_version, 'from', v_before, 'to', v_after));

  changed := true;
  map_version := v_version;
  return next;
end;
$$;

revoke execute on function public.set_company_use_hazard_map(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_company_use_hazard_map(uuid, jsonb) to service_role;
