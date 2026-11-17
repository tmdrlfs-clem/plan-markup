-- Story 10.14 (AC 3, NFR20, NFR36): the RLS matrix. Every role against every
-- table and view in public and app: what each one reads and writes of rows
-- that belong to someone else (or to nobody).
--
-- The roles:
--   anon      not signed in
--   pending   signed up, not activated; a member of Acme
--   solo      active, in no company
--   owner     active, admin of Acme; owns every row below
--   member    active, member of Acme
--   viewer    active, viewer of Acme
--   outsider  active, admin of another company
--   padmin    the platform admin (in no company)
--
-- Each cell is "r<rows read> u<rows updated> d<rows deleted> i<insert>":
-- a number of the fixture's rows, x when Postgres refuses (no grant, or a
-- policy's WITH CHECK), another SQLSTATE when the statement cannot work at
-- all, and i- where the insert is the owner's own (each
-- table's own test covers it). The insert is a copy of the owner's row with a
-- new key, still the owner's: a forged row. Writes are undone after each cell.
--
-- The catalog checks at the end fail when a table or view is added to public
-- or app without a line here, or when an API role gets TRUNCATE, TRIGGER or
-- REFERENCES, or anon may run a SECURITY DEFINER function.
begin;
create extension if not exists pgtap with schema extensions;
select plan(184);

-- ---------------------------------------------------------------------------
-- The people.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mx-pending@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mx-solo@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mx-owner@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mx-member@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'mx-viewer@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'mx-outsider@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'mx-padmin@rls.test');
update public.profiles set status = 'active' where email like 'mx-%@rls.test' and email <> 'mx-pending@rls.test';
update public.profiles set is_platform_admin = true where id = 'f1000000-0000-4000-8000-000000000007';

create temporary table persona (name text primary key, ord int, role text, uid uuid) on commit drop;
insert into persona values
  ('anon',     1, 'anon',          null),
  ('pending',  2, 'authenticated', 'f1000000-0000-4000-8000-000000000001'),
  ('solo',     3, 'authenticated', 'f1000000-0000-4000-8000-000000000002'),
  ('owner',    4, 'authenticated', 'f1000000-0000-4000-8000-000000000003'),
  ('member',   5, 'authenticated', 'f1000000-0000-4000-8000-000000000004'),
  ('viewer',   6, 'authenticated', 'f1000000-0000-4000-8000-000000000005'),
  ('outsider', 7, 'authenticated', 'f1000000-0000-4000-8000-000000000006'),
  ('padmin',   8, 'authenticated', 'f1000000-0000-4000-8000-000000000007');

select * from public.admin_create_company('f1000000-0000-4000-8000-000000000007', 'Matrix Acme rls', 'mx-owner@rls.test');
select * from public.admin_create_company('f1000000-0000-4000-8000-000000000007', 'Matrix Other rls', 'mx-outsider@rls.test');
insert into public.company_members (user_id, company_id, role)
select u, (select id from public.companies where name = 'Matrix Acme rls'), r
from (values
  ('f1000000-0000-4000-8000-000000000001'::uuid, 'member'),
  ('f1000000-0000-4000-8000-000000000004'::uuid, 'member'),
  ('f1000000-0000-4000-8000-000000000005'::uuid, 'viewer')) v (u, r);

-- ---------------------------------------------------------------------------
-- The owner's rows (written as the database owner, past RLS).
-- ---------------------------------------------------------------------------
create temporary table f on commit drop as
select (select id from public.companies where name = 'Matrix Acme rls') as co,
       'f1000000-0000-4000-8000-000000000003'::uuid as owner;

insert into public.drawings (id, owner_id, title)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 'Matrix.pdf');
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename)
values ('f2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', repeat('f', 64), 2, 'Matrix.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height)
values
  ('f2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595),
  ('f2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000002', 1, array[0, 0, 842, 595], 842, 595);
insert into public.calibrations (page_id, calibration)
values ('f2000000-0000-4000-8000-000000000003', '{"xFactor": 35.28, "yFactor": 35.28, "unit": "mm", "precision": "0", "source": "ratio", "ratio": 100}');
insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id)
values ('f2000000-0000-7000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000003',
        'zone', '{"points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}]}', '{}',
        '{"zone": {"name": "Zone 1", "use": "Office", "hazard": "ELH"}}', 'f1000000-0000-4000-8000-000000000003');
-- The layout's and the activity event's triggers take their author from the session: written as the owner.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into public.zone_layouts (id, drawing_id, zone_id, ruleset_id, rule_figure_version, status, inputs, result, created_by)
select 'f2000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-7000-8000-000000000005',
       'nzs4541', '1', 'placed', '{}', '{}', 'f1000000-0000-4000-8000-000000000003';
insert into public.signatures (user_id, storage_path, width, height)
values ('f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000003/signature.png', 300, 100);
insert into public.tool_sets (id, owner_id, name, position, company_id)
values
  ('f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000003', 'Matrix personal', 1, null),
  ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000003', 'Matrix company', 2, (select co from f));
insert into public.tools (id, tool_set_id, owner_id, name, markup)
values
  ('f2000000-0000-4000-8000-000000000009', 'f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000003', 'Personal tool', '{"type":"count"}'),
  ('f2000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-000000000003', 'Company tool', '{"type":"count"}');
insert into public.activity_events (id, user_id, name, page_count, markup_count, kind)
values ('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000003', 'drawing.printed', 1, 0, 'with_markups');
select set_config('request.jwt.claims', '', true);
insert into public.audit_log (id, actor_id, action, target_type, target_id)
values ('f2000000-0000-4000-8000-00000000000c', 'f1000000-0000-4000-8000-000000000007', 'company.created', 'company', (select co from f));
insert into public.company_invitations (id, company_id, email, role, token_hash, invited_by, expires_at)
select 'f2000000-0000-4000-8000-00000000000d', co, 'mx-invitee@rls.test', 'member', repeat('e', 64), owner, now() + interval '1 day' from f;
insert into public.use_hazard_map (company_id, map_version, use, hazard, is_default, verified)
select co, '1', 'Matrix use', 'OH2', true, true from f;
insert into app.rate_limits (bucket, key_hash, hits) values ('matrix', repeat('a', 64), 1);

-- ---------------------------------------------------------------------------
-- What is tried on each table: the owner's rows (a filter), a column an
-- update sets to itself, and the row an insert copies.
-- ---------------------------------------------------------------------------
create temporary table subject (name text primary key, ord int, rel text, filter text, upd text, tpl jsonb) on commit drop;
insert into subject (name, ord, rel, filter, upd) values
  ('profiles',                1, 'public.profiles',            $$id = 'f1000000-0000-4000-8000-000000000003'$$, 'name'),
  ('drawings',                2, 'public.drawings',            $$id = 'f2000000-0000-4000-8000-000000000001'$$, 'title'),
  ('drawing_files',           3, 'public.drawing_files',       $$id = 'f2000000-0000-4000-8000-000000000002'$$, 'filename'),
  ('pages',                   4, 'public.pages',               $$drawing_file_id = 'f2000000-0000-4000-8000-000000000002'$$, 'index'),
  ('calibrations',            5, 'public.calibrations',        $$page_id = 'f2000000-0000-4000-8000-000000000003'$$, 'calibration'),
  ('markups',                 6, 'public.markups',             $$id = 'f2000000-0000-7000-8000-000000000005'$$, 'style'),
  ('zones',                   7, 'public.zones',               $$id = 'f2000000-0000-7000-8000-000000000005'$$, 'version'),
  ('zone_layouts',            8, 'public.zone_layouts',        $$id = 'f2000000-0000-4000-8000-000000000006'$$, 'status'),
  ('signatures',              9, 'public.signatures',          $$user_id = 'f1000000-0000-4000-8000-000000000003'$$, 'width'),
  ('tool_sets personal',     10, 'public.tool_sets',           $$id = 'f2000000-0000-4000-8000-000000000007'$$, 'name'),
  ('tool_sets company',      11, 'public.tool_sets',           $$id = 'f2000000-0000-4000-8000-000000000008'$$, 'name'),
  ('tools personal',         12, 'public.tools',               $$id = 'f2000000-0000-4000-8000-000000000009'$$, 'name'),
  ('tools company',          13, 'public.tools',               $$id = 'f2000000-0000-4000-8000-00000000000a'$$, 'name'),
  ('activity_events',        14, 'public.activity_events',     $$id = 'f2000000-0000-4000-8000-00000000000b'$$, 'markup_count'),
  ('audit_log',              15, 'public.audit_log',           $$id = 'f2000000-0000-4000-8000-00000000000c'$$, 'detail'),
  ('companies',              16, 'public.companies',           $$name = 'Matrix Acme rls'$$, 'name'),
  ('company_members',        17, 'public.company_members',     $$company_id = (select co from f)$$, 'role'),
  ('company_invitations',    18, 'public.company_invitations', $$id = 'f2000000-0000-4000-8000-00000000000d'$$, 'revoked_at'),
  ('use_hazard_map platform',19, 'public.use_hazard_map',      $$company_id is null$$, 'hazard'),
  ('use_hazard_map company', 20, 'public.use_hazard_map',      $$company_id = (select co from f)$$, 'hazard'),
  ('rule_figures',           21, 'public.rule_figures',        $$ruleset_id = 'nzs4541' and version = '1'$$, 'source'),
  ('rate_limits',            22, 'app.rate_limits',            $$bucket = 'matrix'$$, 'hits'),
  ('use_hazard_map',         0,  'public.use_hazard_map',      null, null),
  ('tool_sets',              0,  'public.tool_sets',           null, null),
  ('tools',                  0,  'public.tools',               null, null);
grant select on f, persona, subject to anon, authenticated;

-- The insert copies one of the owner's rows with a new key (calibrations: the owner's other page).
do $$
declare
  s record;
  v jsonb;
begin
  for s in select * from subject where filter is not null loop
    execute format('select to_jsonb(t) from %s t where %s limit 1', s.rel, s.filter) into v;
    if v ? 'id' then
      v := v || jsonb_build_object('id', gen_random_uuid());
    end if;
    if s.name = 'calibrations' then
      v := v || '{"page_id": "f2000000-0000-4000-8000-000000000004"}';
    end if;
    update subject set tpl = v where name = s.name;
  end loop;
end;
$$;

-- One statement, undone: its row count, or x when Postgres refuses it.
create function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
declare
  n bigint;
begin
  begin
    execute p_sql into n;
    raise exception 'undo' using errcode = 'PT999';
  exception
    when sqlstate 'PT999' then return coalesce(n, 0)::text;
    when insufficient_privilege then return 'x';
    when others then return sqlstate;
  end;
end;
$$;

-- Every cell, as each role. SET ROLE inside: the session is the database owner's, so it may go back.
create temporary table actual (subject text, persona text, cell text) on commit drop;
grant insert on actual to anon, authenticated;
create function pg_temp.fill() returns void language plpgsql as $$
declare
  p record;
  s record;
  r text;
  u text;
  d text;
  i text;
begin
  for p in select * from persona order by ord loop
    perform set_config('request.jwt.claims',
      case when p.uid is null then '{"role":"anon"}' else json_build_object('sub', p.uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', p.role);
    for s in select * from subject where filter is not null order by ord loop
      r := pg_temp.attempt(format('select count(*) from %s where %s', s.rel, s.filter));
      u := pg_temp.attempt(format('with c as (update %s set %I = %I where %s returning 1) select count(*) from c', s.rel, s.upd, s.upd, s.filter));
      d := pg_temp.attempt(format('with c as (delete from %s where %s returning 1) select count(*) from c', s.rel, s.filter));
      i := case when p.name = 'owner' then '-' else pg_temp.attempt(format(
        'with c as (insert into %s select * from jsonb_populate_record(null::%s, %L::jsonb) returning 1) select count(*) from c', s.rel, s.rel, s.tpl)) end;
      insert into actual values (s.name, p.name, format('r%s u%s d%s i%s', r, u, d, i));
    end loop;
    reset role;
  end loop;
end;
$$;
select pg_temp.fill();

-- ---------------------------------------------------------------------------
-- The matrix. Columns: anon, pending, solo, owner, member, viewer, outsider, padmin.
-- ---------------------------------------------------------------------------
create temporary table expected (subject text, persona text, cell text) on commit drop;
create function pg_temp.row(p_subject text, variadic p_cells text[]) returns void language sql as $$
  insert into expected select p_subject, p.name, p_cells[p.ord] from persona p;
$$;

--               subject                    anon           pending        solo           owner          member         viewer         outsider       padmin
-- Own data: the owner only; the platform admin reads a profile.
select pg_temp.row('profiles',                'rx ux dx ix', 'r0 u0 dx ix', 'r0 u0 dx ix', 'r1 u1 dx i-', 'r0 u0 dx ix', 'r0 u0 dx ix', 'r0 u0 dx ix', 'r1 u0 dx ix');
select pg_temp.row('drawings',                'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
select pg_temp.row('drawing_files',           'rx ux dx ix', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r1 ux d1 i-', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r0 ux d0 ix');
select pg_temp.row('pages',                   'rx ux dx ix', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r2 ux d0 i-', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r0 ux d0 ix', 'r0 ux d0 ix');
select pg_temp.row('calibrations',            'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
-- Markups are written only through apply_markup_ops.
select pg_temp.row('markups',                 'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx i-', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix');
-- The zones view: select only; an insert cannot work at all (0A000: its columns are computed).
select pg_temp.row('zones',                   'rx ux dx i0A000', 'r0 ux dx i0A000', 'r0 ux dx i0A000', 'r1 ux dx i-', 'r0 ux dx i0A000', 'r0 ux dx i0A000', 'r0 ux dx i0A000', 'r0 ux dx i0A000');
-- Placement runs are append-only.
select pg_temp.row('zone_layouts',            'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx i-', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix');
select pg_temp.row('signatures',              'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
-- A company tool set (and its tools) is read by the company's active people; written by its owner only.
select pg_temp.row('tool_sets personal',      'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
select pg_temp.row('tool_sets company',       'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r1 u0 d0 ix', 'r1 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
select pg_temp.row('tools personal',          'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
select pg_temp.row('tools company',           'rx ux dx ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix', 'r1 u1 d1 i-', 'r1 u0 d0 ix', 'r1 u0 d0 ix', 'r0 u0 d0 ix', 'r0 u0 d0 ix');
-- Activity: written by its user, read by the platform admin only.
select pg_temp.row('activity_events',         'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx i-', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx ix');
select pg_temp.row('audit_log',               'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx i-', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx ix');
-- Companies: read by their active people and the platform admin; written only through functions.
select pg_temp.row('companies',               'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx i-', 'r1 ux dx ix', 'r1 ux dx ix', 'r0 ux dx ix', 'r1 ux dx ix');
select pg_temp.row('company_members',         'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r4 ux dx i-', 'r4 ux dx ix', 'r4 ux dx ix', 'r0 ux dx ix', 'r4 ux dx ix');
select pg_temp.row('company_invitations',     'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx i-', 'r0 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx ix');
-- 4541: the platform rows are read by every active user, a company's by its active people; written only through functions.
select pg_temp.row('use_hazard_map platform', 'rx ux dx ix', 'r0 ux dx ix', 'r8 ux dx ix', 'r8 ux dx i-', 'r8 ux dx ix', 'r8 ux dx ix', 'r8 ux dx ix', 'r8 ux dx ix');
select pg_temp.row('use_hazard_map company',  'rx ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix', 'r1 ux dx i-', 'r1 ux dx ix', 'r1 ux dx ix', 'r0 ux dx ix', 'r0 ux dx ix');
select pg_temp.row('rule_figures',            'rx ux dx ix', 'r0 ux dx ix', 'r1 ux dx ix', 'r1 ux dx i-', 'r1 ux dx ix', 'r1 ux dx ix', 'r1 ux dx ix', 'r1 ux dx ix');
-- Rate limits: the server's only.
select pg_temp.row('rate_limits',             'rx ux dx ix', 'rx ux dx ix', 'rx ux dx ix', 'rx ux dx i-', 'rx ux dx ix', 'rx ux dx ix', 'rx ux dx ix', 'rx ux dx ix');

-- One test per table and role (22 × 8 = 176).
select is(a.cell, e.cell, format('%s as %s', e.subject, e.persona))
from expected e
left join actual a using (subject, persona)
join subject s on s.name = e.subject
join persona p on p.name = e.persona
order by s.ord, p.ord;

-- ---------------------------------------------------------------------------
-- Completeness and the catalog.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'f')
     except select rel from subject $$,
  'every table and view in public and app has a line in the matrix');
select is((select count(*)::int from expected), (select count(*)::int from subject where filter is not null) * 8, 'every line covers every role');
select is_empty(
  $$ select table_schema || '.' || table_name || ' ' || grantee || ' ' || privilege_type
     from information_schema.role_table_grants
     where table_schema in ('public', 'app') and grantee in ('anon', 'authenticated')
       and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES') $$,
  'no API role may truncate, add triggers to or reference a table (TRUNCATE ignores RLS)');
select is_empty(
  $$ select table_schema || '.' || table_name || ' ' || privilege_type
     from information_schema.role_table_grants
     where table_schema in ('public', 'app') and grantee = 'anon' $$,
  'anon holds no privilege on any table');
select is_empty(
  $$ select n.nspname || '.' || p.proname
     from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon may run no SECURITY DEFINER function');
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'app') and c.relkind = 'v'
       and not coalesce((select bool_or(o = 'security_invoker=true') from unnest(c.reloptions) o), false) $$,
  'every view runs with the caller''s rights (security_invoker), so RLS applies');
select is(
  (select defaclacl::text from pg_catalog.pg_default_acl
    where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'),
  '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}',
  'a new table in public grants nothing to anon or authenticated until its migration says so');
select ok(true, 'the matrix ran as every role');

select * from finish();
rollback;
