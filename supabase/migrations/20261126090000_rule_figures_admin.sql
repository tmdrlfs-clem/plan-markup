-- Story 10.13 (FR79 admin editing, A7, NFR34): the platform admin maintains
-- the rule figures and the platform default use → hazard mapping.
--
-- Rule figures. A version is never changed or removed: an edit adds the next
-- version as a draft (verified false). A draft is used by nobody. The newest
-- version becomes the one in use when the admin confirms it (verified true);
-- the earlier versions stay for the layouts placed with them.
--
-- admin_create_rule_figures   add the next version of a ruleset as a draft.
-- admin_verify_rule_figures   confirm the newest version: from then on new
--                             placements and checks use it.
--
-- The platform default mapping (use_hazard_map, company_id null). It holds one
-- version at a time (a zone keeps its own use and hazard class, Story 10.12):
--
-- admin_set_default_use_hazard_map     replace it as a whole; the new version
--                                      is a draft again (verified false).
-- admin_verify_default_use_hazard_map  mark the version in place as verified.
--
-- All four are called by the server with the service client (EXECUTE is
-- service_role only); each checks its actor itself (NFR22) and writes
-- audit_log in the same transaction.
--   PT403 the actor is not an active platform admin
--   PT404 no such ruleset or version
--   PT409 the version is not the newest one (figures) or not the one in place (mapping)
--   22023 the figures, the source or the uses are not as described below
--   23514 a use name or hazard class is not allowed     23505 a use is named twice
--
-- Until now the platform admin could write both tables directly (through RLS),
-- which no audit row recorded. From here nobody writes them directly.

alter table public.rule_figures add column id uuid not null default gen_random_uuid();
alter table public.rule_figures add constraint rule_figures_id_key unique (id);
alter table public.rule_figures add column created_by uuid;
alter table public.rule_figures add column verified_at timestamptz;
alter table public.rule_figures add column verified_by uuid;
update public.rule_figures set verified_at = created_at where verified;

comment on table public.rule_figures is 'NZS 4541 rule figures per ruleset version (Story 9.1). Read: active users. Written only by admin_create_rule_figures() and admin_verify_rule_figures() (Story 10.13): versions are never changed or removed; the newest verified one is in use.';
comment on column public.rule_figures.created_by is 'The platform admin who added the version (null: seeded). No foreign key: the record outlives the account.';

drop policy rule_figures_write_admin on public.rule_figures;
revoke insert, update, delete on public.rule_figures from authenticated;

drop policy use_hazard_map_write_admin on public.use_hazard_map;
revoke insert, update, delete on public.use_hazard_map from authenticated;

comment on table public.use_hazard_map is 'Use → hazard class (Story 9.1). company_id null = platform default (read: active users; written by admin_set_default_use_hazard_map(), Story 10.13). A company''s rows (Story 10.12): read by its members, written by set_company_use_hazard_map().';

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'user.plan_changed',
    'company.created', 'company.plan_changed',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed',
    'company.tool_set_published', 'company.tool_set_withdrawn',
    'company.use_hazard_map_changed', 'company.use_hazard_map_reset',
    'support.markup_sets_viewed',
    'rules.figures_created', 'rules.figures_verified',
    'rules.use_hazard_map_changed', 'rules.use_hazard_map_verified'
  ));

-- A rule figures row is the target of its own audit rows (rule_figures.id).
-- The platform default mapping has no row of its own: its audit rows carry the
-- nil uuid as their target.
alter table public.audit_log drop constraint audit_log_target_type_check;
alter table public.audit_log add constraint audit_log_target_type_check
  check (target_type in ('user', 'company', 'rule_figures', 'use_hazard_map'));

-- ---------------------------------------------------------------------------
-- app.fn_require_platform_admin(): PT403 unless the actor is an active
-- platform admin.
-- ---------------------------------------------------------------------------
create function app.fn_require_platform_admin(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.status = 'active' and a.is_platform_admin
  ) then
    raise exception 'not a platform admin' using errcode = 'PT403';
  end if;
end;
$$;

revoke execute on function app.fn_require_platform_admin(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.fn_check_rule_hazards(): 22023 unless p_hazards is exactly
-- {"ELH": f, "OH1": f, "OH2": f, "OH3": f}, each f exactly
-- {"Amax", "Smax", "Smin", "Wmax", "Wmin"} as numbers: areas in (0, 100] m²,
-- distances in (0, 50] m, Smin below Smax and Wmin below Wmax (the same rules
-- as ruleSetSchema in src/core/sprinkler/rules/rules.ts).
-- ---------------------------------------------------------------------------
create function app.fn_check_rule_hazards(p_hazards jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_class text;
  v_f jsonb;
  v_key text;
begin
  if p_hazards is null or pg_catalog.jsonb_typeof(p_hazards) <> 'object'
     or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_hazards) k)
        is distinct from array['ELH', 'OH1', 'OH2', 'OH3'] then
    raise exception 'hazards must name ELH, OH1, OH2 and OH3' using errcode = '22023';
  end if;
  foreach v_class in array array['ELH', 'OH1', 'OH2', 'OH3'] loop
    v_f := p_hazards -> v_class;
    if pg_catalog.jsonb_typeof(v_f) <> 'object'
       or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_f) k)
          is distinct from array['Amax', 'Smax', 'Smin', 'Wmax', 'Wmin'] then
      raise exception 'each hazard class needs Amax, Smax, Smin, Wmax and Wmin' using errcode = '22023';
    end if;
    foreach v_key in array array['Amax', 'Smax', 'Smin', 'Wmax', 'Wmin'] loop
      if pg_catalog.jsonb_typeof(v_f -> v_key) <> 'number'
         or (v_f ->> v_key)::numeric <= 0
         or (v_f ->> v_key)::numeric > (case v_key when 'Amax' then 100 else 50 end) then
        raise exception 'a figure is not a number in its range' using errcode = '22023';
      end if;
    end loop;
    if (v_f ->> 'Smin')::numeric >= (v_f ->> 'Smax')::numeric or (v_f ->> 'Wmin')::numeric >= (v_f ->> 'Wmax')::numeric then
      raise exception 'a minimum must be below its maximum' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke execute on function app.fn_check_rule_hazards(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.admin_create_rule_figures(). Adds the next version of p_ruleset_id
-- as a draft: p_hazards as checked above, p_source (1 to 500 characters: where
-- the figures come from, why they changed), the extra tables of the newest
-- version carried over as they are. When p_hazards equals the newest version's
-- figures nothing is written. Returns whether a version was added and the
-- newest version's number.
-- ---------------------------------------------------------------------------
create function public.admin_create_rule_figures(p_actor_id uuid, p_ruleset_id text, p_hazards jsonb, p_source text)
returns table (changed boolean, version text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_latest public.rule_figures%rowtype;
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_version text;
  v_id uuid;
begin
  perform app.fn_require_platform_admin(p_actor_id);

  -- One change to a ruleset at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rule_figures:' || coalesce(p_ruleset_id, ''), 0));
  select f.* into v_latest
  from public.rule_figures f
  where f.ruleset_id = p_ruleset_id
  order by f.version::integer desc
  limit 1;
  if not found then
    raise exception 'no such ruleset' using errcode = 'PT404';
  end if;

  perform app.fn_check_rule_hazards(p_hazards);
  if pg_catalog.length(v_source) not between 1 and 500 then
    raise exception 'the source is 1 to 500 characters' using errcode = '22023';
  end if;

  if v_latest.hazards = p_hazards then
    changed := false;
    version := v_latest.version;
    return next;
    return;
  end if;

  v_version := (v_latest.version::integer + 1)::text;
  insert into public.rule_figures (ruleset_id, version, verified, source, hazards, tables, created_by)
  values (p_ruleset_id, v_version, false, v_source, p_hazards, v_latest.tables, p_actor_id)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'rules.figures_created', 'rule_figures', v_id,
          pg_catalog.jsonb_build_object('ruleset', p_ruleset_id, 'version', v_version, 'from_version', v_latest.version,
                                        'from', v_latest.hazards, 'to', p_hazards, 'source', v_source));

  changed := true;
  version := v_version;
  return next;
end;
$$;

revoke execute on function public.admin_create_rule_figures(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_create_rule_figures(uuid, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.admin_verify_rule_figures(). Confirms p_version of p_ruleset_id,
-- which must be the newest version: an older draft was replaced by a later
-- edit and stays a draft for good. Returns false when it already was verified.
-- ---------------------------------------------------------------------------
create function public.admin_verify_rule_figures(p_actor_id uuid, p_ruleset_id text, p_version text)
returns table (changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.rule_figures%rowtype;
  v_replaces text;
begin
  perform app.fn_require_platform_admin(p_actor_id);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rule_figures:' || coalesce(p_ruleset_id, ''), 0));
  select f.* into v_row
  from public.rule_figures f
  where f.ruleset_id = p_ruleset_id and f.version = p_version;
  if not found then
    raise exception 'no such version' using errcode = 'PT404';
  end if;
  if exists (
    select 1 from public.rule_figures f
    where f.ruleset_id = p_ruleset_id and f.version::integer > v_row.version::integer
  ) then
    raise exception 'a newer version exists' using errcode = 'PT409';
  end if;

  changed := not v_row.verified;
  if changed then
    select f.version into v_replaces
    from public.rule_figures f
    where f.ruleset_id = p_ruleset_id and f.verified
    order by f.version::integer desc
    limit 1;

    update public.rule_figures f
    set verified = true, verified_at = pg_catalog.now(), verified_by = p_actor_id
    where f.id = v_row.id;

    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (p_actor_id, 'rules.figures_verified', 'rule_figures', v_row.id,
            pg_catalog.jsonb_build_object('ruleset', p_ruleset_id, 'version', p_version, 'replaces', v_replaces));
  end if;
  return next;
end;
$$;

revoke execute on function public.admin_verify_rule_figures(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_verify_rule_figures(uuid, text, text) to service_role;

-- The platform default mapping as one value: {"default": use, "uses": {use: hazard, …}}; null when there is none.
create function app.fn_default_use_hazard_map()
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
  where m.company_id is null;
$$;

revoke execute on function app.fn_default_use_hazard_map() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.admin_set_default_use_hazard_map(). p_uses is a JSON array of 1 to 50
-- {"use": text, "hazard": text, "is_default": boolean}, exactly one of them
-- the default. Replaces the platform default mapping as a whole; the new
-- version (the next number) is a draft. Saving the mapping as it is writes
-- nothing. Companies with a mapping of their own are not touched.
-- ---------------------------------------------------------------------------
create function public.admin_set_default_use_hazard_map(p_actor_id uuid, p_uses jsonb)
returns table (changed boolean, map_version text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_current text;
  v_version text;
begin
  perform app.fn_require_platform_admin(p_actor_id);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('use_hazard_map:platform', 0));

  if p_uses is null or pg_catalog.jsonb_typeof(p_uses) <> 'array' or pg_catalog.jsonb_array_length(p_uses) not between 1 and 50 then
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

  v_before := app.fn_default_use_hazard_map();
  select max(m.map_version::integer)::text into v_current from public.use_hazard_map m where m.company_id is null;

  select pg_catalog.jsonb_build_object(
    'default', (pg_catalog.array_agg(e ->> 'use') filter (where (e ->> 'is_default')::boolean))[1],
    'uses', pg_catalog.jsonb_object_agg(e ->> 'use', e ->> 'hazard')
  ) into v_after
  from pg_catalog.jsonb_array_elements(p_uses) e;

  if v_before is not null and v_before = v_after then
    changed := false;
    map_version := v_current;
    return next;
    return;
  end if;

  -- Never a number used before: the audit rows count the changes since the seed (version 1).
  select greatest(coalesce(v_current::integer, 0), count(*)::integer + 1) + 1 into v_version
  from public.audit_log a
  where a.action = 'rules.use_hazard_map_changed';

  delete from public.use_hazard_map m where m.company_id is null;
  -- The table's own checks refuse a bad name (23514), hazard (23514) or a use named twice (23505).
  insert into public.use_hazard_map (company_id, map_version, use, hazard, is_default, verified)
  select null, v_version, e ->> 'use', e ->> 'hazard', (e ->> 'is_default')::boolean, false
  from pg_catalog.jsonb_array_elements(p_uses) e;

  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'rules.use_hazard_map_changed', 'use_hazard_map', '00000000-0000-0000-0000-000000000000',
          pg_catalog.jsonb_build_object('version', v_version, 'from_version', v_current, 'from', v_before, 'to', v_after));

  changed := true;
  map_version := v_version;
  return next;
end;
$$;

revoke execute on function public.admin_set_default_use_hazard_map(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_default_use_hazard_map(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- public.admin_verify_default_use_hazard_map(). Marks the platform default
-- mapping as verified. p_version is the version the admin looked at: when the
-- mapping has changed since, nothing is marked (PT409). Returns false when it
-- already was verified.
-- ---------------------------------------------------------------------------
create function public.admin_verify_default_use_hazard_map(p_actor_id uuid, p_version text)
returns table (changed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  perform app.fn_require_platform_admin(p_actor_id);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('use_hazard_map:platform', 0));
  select max(m.map_version::integer)::text into v_current from public.use_hazard_map m where m.company_id is null;
  if v_current is null then
    raise exception 'no platform default mapping' using errcode = 'PT404';
  end if;
  if p_version is distinct from v_current then
    raise exception 'the mapping has changed' using errcode = 'PT409';
  end if;

  changed := exists (select 1 from public.use_hazard_map m where m.company_id is null and not m.verified);
  if changed then
    update public.use_hazard_map m set verified = true where m.company_id is null;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (p_actor_id, 'rules.use_hazard_map_verified', 'use_hazard_map', '00000000-0000-0000-0000-000000000000',
            pg_catalog.jsonb_build_object('version', v_current, 'mapping', app.fn_default_use_hazard_map()));
  end if;
  return next;
end;
$$;

revoke execute on function public.admin_verify_default_use_hazard_map(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_verify_default_use_hazard_map(uuid, text) to service_role;
