-- Story 6.2: markups saved through one ops RPC (FR49, FR55, AR6, AR10, A4).
--
-- markups      one row per markup of a markup set: the client's uuid v7 id, its
--              page (stable page id), type, and three jsonb fields (geometry,
--              style, props) plus its drawing order (z). version counts the
--              writes; field_versions holds, per field, the version and client
--              time of its last write ({"geometry": {"v": 3, "ts": 1730...}}).
--              deleted_at is the tombstone.
--
-- Users read their sets' markups under RLS (app.fn_effective_access); they
-- never write the table: public.apply_markup_ops (SECURITY DEFINER) is the only
-- writer, so versions, authorship and timestamps cannot be forged.

-- ---------------------------------------------------------------------------
-- app.fn_effective_access(drawing_id): the caller's access to a markup set:
-- 'owner', or null for none. Epic 8 adds shares as min(company role, grant)
-- (A6) returning 'edit' or 'view'.
-- ---------------------------------------------------------------------------
create or replace function app.fn_effective_access(p_drawing_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.fn_owns_drawing(p_drawing_id) then 'owner' end;
$$;

revoke execute on function app.fn_effective_access(uuid) from public, anon;
grant execute on function app.fn_effective_access(uuid) to authenticated;

create table public.markups (
  id uuid primary key,
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  type text not null,
  geometry jsonb not null,
  style jsonb not null,
  props jsonb not null default '{}'::jsonb,
  z double precision not null default 0,
  version integer not null default 1,
  field_versions jsonb not null default '{}'::jsonb,
  author_id uuid not null references auth.users (id) on delete cascade,
  updated_by uuid references auth.users (id) on delete set null,
  last_op_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint markups_type_check check (type ~ '^[a-z]{1,32}$'),
  constraint markups_geometry_check check (jsonb_typeof(geometry) = 'object' and pg_column_size(geometry) <= 4194304),
  constraint markups_style_check check (jsonb_typeof(style) = 'object' and pg_column_size(style) <= 2048),
  constraint markups_props_check check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 16777216),
  constraint markups_z_check check (z between -1e300 and 1e300),
  constraint markups_version_check check (version >= 1),
  constraint markups_field_versions_check check (jsonb_typeof(field_versions) = 'object')
);

create index markups_drawing_page_idx on public.markups (drawing_id, page_id);
create index markups_drawing_updated_idx on public.markups (drawing_id, updated_at);
create index markups_page_idx on public.markups (page_id);

comment on table public.markups is 'A markup of a markup set (Story 6.2). Written only by public.apply_markup_ops.';

alter table public.markups enable row level security;

create policy markups_select_access on public.markups
  for select to authenticated
  using (app.fn_effective_access(drawing_id) is not null);

revoke all on public.markups from anon, authenticated;
grant select on public.markups to authenticated;

-- ---------------------------------------------------------------------------
-- public.apply_markup_ops(drawing_id, ops): applies a batch of markup ops in
-- order and returns one result per op.
--
--   op = { "opId": uuid, "markupId": uuid, "kind": "create"|"update"|"delete",
--          "type": text, "pageId": uuid (create), "fields": { geometry?, style?,
--          props?, z? }, "baseVersion": int, "clientTs": ms }
--   result = { "opId", "markupId", "status": "applied"|"deleted"|"missing", "version" }
--
-- Rules (A4):
--   - field-level last-write-wins: each field of the op is written unless another
--     write changed it after the op's baseVersion at a later client time
--     (client times are clamped to the server's now);
--   - tombstones win: an update, or a create from a client that has not seen the
--     delete (baseVersion < the tombstone's version), is ignored ('deleted');
--     a create with baseVersion >= that version restores the markup (undo);
--   - an opId already applied to the markup changes nothing;
--   - an update or delete of an unknown markup is 'missing'.
-- Refused (the whole batch): no edit access (42501), a markup id of another
-- drawing (42501), a page of another drawing (42501), a malformed op or a
-- protected field (22023), too many calls (PT429).
--
-- SECURITY DEFINER: users have SELECT only; this re-checks the caller (NFR22).
-- ---------------------------------------------------------------------------
create or replace function public.apply_markup_ops(p_drawing_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array['geometry', 'style', 'props', 'z'];
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid uuid := (select auth.uid());
  v_access text;
  v_allowed boolean;
  v_now timestamptz := pg_catalog.now();
  v_now_ms bigint := (extract(epoch from pg_catalog.now()) * 1000)::bigint;
  v_results jsonb := '[]'::jsonb;
  v_op jsonb;
  v_fields jsonb;
  v_key text;
  v_kind text;
  v_markup uuid;
  v_op_id uuid;
  v_page uuid;
  v_base integer;
  v_ts bigint;
  v_row public.markups%rowtype;
  v_found boolean;
  v_version integer;
  v_fv jsonb;
  v_write jsonb;
  v_status text;
begin
  if v_uid is null or not app.fn_is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_access := app.fn_effective_access(p_drawing_id);
  if v_access is null or v_access not in ('owner', 'edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) not between 1 and 10000 then
    raise exception 'invalid ops' using errcode = '22023';
  end if;

  select r.allowed into v_allowed
  from public.consume_rate_limit('markup_ops', encode(pg_catalog.sha256(convert_to(v_uid::text, 'UTF8')), 'hex'), 600, 60) r;
  if not v_allowed then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;

  for v_op in select e from jsonb_array_elements(p_ops) e loop
    -- Shape.
    if jsonb_typeof(v_op) is distinct from 'object'
       or coalesce(v_op ->> 'opId', '') !~ c_uuid
       or coalesce(v_op ->> 'markupId', '') !~ c_uuid
       or coalesce(v_op ->> 'kind', '') not in ('create', 'update', 'delete')
       or jsonb_typeof(v_op -> 'baseVersion') is distinct from 'number'
       or jsonb_typeof(v_op -> 'clientTs') is distinct from 'number' then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    v_kind := v_op ->> 'kind';
    v_op_id := (v_op ->> 'opId')::uuid;
    v_markup := (v_op ->> 'markupId')::uuid;
    v_base := (v_op ->> 'baseVersion')::numeric::integer;
    v_ts := least((v_op ->> 'clientTs')::numeric::bigint, v_now_ms);
    if v_base < 0 then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    v_fields := coalesce(v_op -> 'fields', '{}'::jsonb);
    if jsonb_typeof(v_fields) is distinct from 'object' then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_fields) loop
      if not v_key = any (c_fields) then
        raise exception 'protected or unknown field' using errcode = '22023';
      end if;
    end loop;
    if (v_fields ? 'geometry' and jsonb_typeof(v_fields -> 'geometry') <> 'object')
       or (v_fields ? 'style' and jsonb_typeof(v_fields -> 'style') <> 'object')
       or (v_fields ? 'props' and jsonb_typeof(v_fields -> 'props') <> 'object')
       or (v_fields ? 'z' and jsonb_typeof(v_fields -> 'z') <> 'number') then
      raise exception 'invalid field' using errcode = '22023';
    end if;
    if v_kind = 'create' and not (v_fields ?& c_fields) then
      raise exception 'a create sets every field' using errcode = '22023';
    end if;
    if v_kind = 'update' and v_fields = '{}'::jsonb then
      raise exception 'an update sets a field' using errcode = '22023';
    end if;

    select * into v_row from public.markups m where m.id = v_markup for update;
    v_found := found;
    if v_found and v_row.drawing_id <> p_drawing_id then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_found and v_row.type is distinct from coalesce(v_op ->> 'type', v_row.type) then
      raise exception 'a markup''s type does not change' using errcode = '22023';
    end if;

    v_status := 'applied';
    if v_found and v_row.last_op_id = v_op_id then
      -- A replay: nothing changes.
      v_status := case when v_row.deleted_at is null then 'applied' else 'deleted' end;
      v_version := v_row.version;

    elsif v_kind = 'create' and not v_found then
      if coalesce(v_op ->> 'type', '') !~ '^[a-z]{1,32}$' or coalesce(v_op ->> 'pageId', '') !~ c_uuid then
        raise exception 'invalid create' using errcode = '22023';
      end if;
      v_page := (v_op ->> 'pageId')::uuid;
      if not exists (
        select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id
        where p.id = v_page and f.drawing_id = p_drawing_id
      ) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      v_write := jsonb_build_object('v', 1, 'ts', v_ts);
      insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, z, version, field_versions,
                                  author_id, updated_by, last_op_id, created_at, updated_at)
      values (v_markup, p_drawing_id, v_page, v_op ->> 'type', v_fields -> 'geometry', v_fields -> 'style',
              v_fields -> 'props', (v_fields ->> 'z')::double precision, 1,
              jsonb_build_object('geometry', v_write, 'style', v_write, 'props', v_write, 'z', v_write),
              v_uid, v_uid, v_op_id, v_now, v_now);
      v_version := 1;

    elsif not v_found then
      v_status := 'missing';
      v_version := 0;

    elsif v_row.deleted_at is not null and not (v_kind = 'create' and v_base >= v_row.version) then
      -- The tombstone wins (a delete again is already done).
      v_status := 'deleted';
      v_version := v_row.version;

    elsif v_kind = 'delete' then
      v_version := v_row.version + 1;
      update public.markups m
      set deleted_at = v_now, version = v_version,
          field_versions = m.field_versions || jsonb_build_object('deleted', jsonb_build_object('v', v_version, 'ts', v_ts)),
          updated_by = v_uid, last_op_id = v_op_id, updated_at = v_now
      where m.id = v_markup;
      v_status := 'deleted';

    else
      -- An update, a create replayed on a live markup, or a restore (a create
      -- after a tombstone the client has seen). Restores write every field.
      v_version := v_row.version + 1;
      v_fv := v_row.field_versions;
      v_write := jsonb_build_object('v', v_version, 'ts', v_ts);
      for v_key in select jsonb_object_keys(v_fields) loop
        if v_row.deleted_at is null
           and coalesce((v_fv -> v_key ->> 'v')::integer, 0) > v_base
           and coalesce((v_fv -> v_key ->> 'ts')::bigint, 0) > v_ts then
          -- A later write by someone else since the op's base: it is kept.
          v_fields := v_fields - v_key;
        else
          v_fv := v_fv || jsonb_build_object(v_key, v_write);
        end if;
      end loop;
      if v_fields = '{}'::jsonb then
        v_version := v_row.version;
        update public.markups m set last_op_id = v_op_id where m.id = v_markup;
      else
        update public.markups m
        set geometry = coalesce(v_fields -> 'geometry', m.geometry),
            style = coalesce(v_fields -> 'style', m.style),
            props = coalesce(v_fields -> 'props', m.props),
            z = coalesce((v_fields ->> 'z')::double precision, m.z),
            deleted_at = null,
            version = v_version, field_versions = v_fv,
            updated_by = v_uid, last_op_id = v_op_id, updated_at = v_now
        where m.id = v_markup;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'opId', v_op_id, 'markupId', v_markup, 'status', v_status, 'version', v_version));
  end loop;

  return v_results;
end;
$$;

revoke execute on function public.apply_markup_ops(uuid, jsonb) from public, anon;
grant execute on function public.apply_markup_ops(uuid, jsonb) to authenticated;
