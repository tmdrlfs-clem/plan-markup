-- Story 6.2: RLS on markups and public.apply_markup_ops (AR6, AR10, A4, NFR21,
-- NFR22): only the owner, while active, reads their markups; nobody writes the
-- table directly; the RPC applies field-level LWW, lets tombstones win, restores
-- on undo, ignores replays, refuses protected fields and other drawings' ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'mk-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '92222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'mk-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '93333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'mk-off@rls.test');
update public.profiles set status = 'active'
where id in ('91111111-1111-4111-8111-111111111111', '92222222-2222-4222-8222-222222222222');
update public.profiles set status = 'deactivated' where id = '93333333-3333-4333-8333-333333333333';

-- A's set (one page) and B's set (one page, one markup), as postgres.
insert into public.drawings (id, owner_id, title) values
  ('a1000000-0000-4000-8000-000000000001', '91111111-1111-4111-8111-111111111111', 'A.pdf'),
  ('b1000000-0000-4000-8000-000000000001', '92222222-2222-4222-8222-222222222222', 'B.pdf'),
  ('c1000000-0000-4000-8000-000000000001', '93333333-3333-4333-8333-333333333333', 'Off.pdf');
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename) values
  ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', repeat('a', 64), 1, 'A.pdf'),
  ('b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', repeat('b', 64), 1, 'B.pdf'),
  ('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', repeat('c', 64), 1, 'Off.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height) values
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595),
  ('b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595),
  ('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595);
insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id) values
  ('b1000000-0000-7000-8000-00000000000a', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003',
   'line', '{"points": []}', '{"color": "#ff0000"}', '{}', '92222222-2222-4222-8222-222222222222');

-- An op as jsonb: kind, markup id suffix, op id suffix, base version, client ms, fields.
create function pg_temp.op(p_kind text, p_markup text, p_op text, p_base int, p_ts bigint, p_fields jsonb, p_page text default 'a1000000-0000-4000-8000-000000000003')
returns jsonb language sql as $$
  select jsonb_build_object(
    'opId', '00000000-0000-7000-8000-' || lpad(p_op, 12, '0'),
    'markupId', 'a1000000-0000-7000-8000-' || lpad(p_markup, 12, '0'),
    'kind', p_kind, 'type', 'line', 'pageId', p_page,
    'baseVersion', p_base, 'clientTs', p_ts, 'fields', p_fields);
$$;
create function pg_temp.all_fields(p_color text, p_z float8 default 1)
returns jsonb language sql as $$
  select jsonb_build_object('geometry', '{"points": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]}'::jsonb,
                            'style', jsonb_build_object('color', p_color), 'props', '{"createdAt": "2026-11-07T00:00:00Z"}'::jsonb, 'z', p_z);
$$;

select ok(not has_table_privilege('anon', 'public.markups', 'select'), 'anon has no SELECT on public.markups');
select ok(not has_table_privilege('authenticated', 'public.markups', 'insert'), 'users cannot insert markups directly');
select ok(not has_table_privilege('authenticated', 'public.markups', 'update'), 'users cannot update markups directly');
select ok(not has_table_privilege('authenticated', 'public.markups', 'delete'), 'users cannot delete markups directly');
select ok(not has_function_privilege('anon', 'public.apply_markup_ops(uuid, jsonb)', 'execute'), 'anon cannot run apply_markup_ops');

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.markups), 0::bigint, 'user A sees none of B''s markups');
select is(app.fn_effective_access('a1000000-0000-4000-8000-000000000001'), 'owner', 'A owns A''s set');
select is(app.fn_effective_access('b1000000-0000-4000-8000-000000000001'), null, 'A has no access to B''s set');

-- Create.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '1', '1', 0, 1000, pg_temp.all_fields('#ff0000')))) -> 0 ->> 'status',
  'applied', 'a create is applied');
select results_eq(
  $$ select version, author_id, updated_by, deleted_at is null, style ->> 'color', z from public.markups where id = 'a1000000-0000-7000-8000-000000000001' $$,
  $$ values (1, '91111111-1111-4111-8111-111111111111'::uuid, '91111111-1111-4111-8111-111111111111'::uuid, true, '#ff0000', 1::float8) $$,
  'the create records version 1, its author and its fields');
select ok((select created_at is not null and updated_at is not null from public.markups where id = 'a1000000-0000-7000-8000-000000000001'), 'creation and modification times are recorded (FR55)');

-- A replay changes nothing.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '1', '1', 0, 1000, pg_temp.all_fields('#00ff00')))) -> 0 ->> 'version',
  '1', 'a replayed op id changes nothing');
select is((select style ->> 'color' from public.markups where id = 'a1000000-0000-7000-8000-000000000001'), '#ff0000', 'the replay left the style');

-- Field-level LWW: update style at base 1 (v2), then geometry at base 1 (v3, no conflict: other field).
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(
    pg_temp.op('update', '1', '2', 1, 2000, '{"style": {"color": "#0000ff"}}'),
    pg_temp.op('update', '1', '3', 1, 1500, '{"geometry": {"points": [{"x": 5, "y": 5}]}}'))) -> 1 ->> 'version',
  '3', 'two updates of different fields both apply');
select results_eq(
  $$ select style ->> 'color', geometry -> 'points' -> 0 ->> 'x' from public.markups where id = 'a1000000-0000-7000-8000-000000000001' $$,
  $$ values ('#0000ff', '5') $$,
  'each update wrote its own field');
-- A stale write of style (base 1, earlier client time than the v2 write) keeps the newer style.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '4', 1, 1200, '{"style": {"color": "#999999"}}'))) -> 0 ->> 'version',
  '3', 'a stale write of a newer field changes nothing');
select is((select style ->> 'color' from public.markups where id = 'a1000000-0000-7000-8000-000000000001'), '#0000ff', 'the later write is kept (LWW)');
-- A stale base but a later client time wins.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '5', 1, 3000, '{"style": {"color": "#111111"}}'))) -> 0 ->> 'version',
  '4', 'a later write wins');
-- A client time in the future is clamped to now (it cannot win forever).
select is(
  (public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '6', 4, 99999999999999, '{"z": 2}'))) -> 0 ->> 'version'),
  '5', 'a future client time is accepted');
select ok((select (field_versions -> 'z' ->> 'ts')::bigint <= (extract(epoch from now()) * 1000)::bigint + 1 from public.markups where id = 'a1000000-0000-7000-8000-000000000001'), 'and clamped to the server''s now');

-- Tombstones win.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('delete', '1', '7', 5, 4000, '{}'))) -> 0 ->> 'status',
  'deleted', 'a delete writes a tombstone');
select is((select version from public.markups where id = 'a1000000-0000-7000-8000-000000000001' and deleted_at is not null), 6, 'the tombstone has its version');
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '8', 5, 99999999999999, '{"style": {"color": "#222222"}}'))) -> 0 ->> 'status',
  'deleted', 'an update after the delete loses to the tombstone');
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '1', '9', 5, 99999999999999, pg_temp.all_fields('#333333')))) -> 0 ->> 'status',
  'deleted', 'a create from a client that has not seen the delete loses too');
-- Undo of the delete: a create from a client that has seen it restores the markup.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '1', '10', 6, 5000, pg_temp.all_fields('#444444', 3)))) -> 0 ->> 'status',
  'applied', 'a create at the tombstone''s version restores it (undo)');
select results_eq(
  $$ select deleted_at is null, style ->> 'color', z, version from public.markups where id = 'a1000000-0000-7000-8000-000000000001' $$,
  $$ values (true, '#444444', 3::float8, 7) $$,
  'the restored markup has the create''s fields');

-- Unknown markups.
select is(
  public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '2', '11', 0, 1000, '{"z": 1}'))) -> 0 ->> 'status',
  'missing', 'an update of an unknown markup is missing');

-- Refused.
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '12', 7, 1000, '{"version": 100}'))) $$,
  '22023', null, 'a protected field cannot be set');
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '13', 7, 1000, '{"author_id": "92222222-2222-4222-8222-222222222222"}'))) $$,
  '22023', null, 'the author cannot be set');
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '3', '14', 0, 1000, '{"z": 1}'))) $$,
  '22023', null, 'a create sets every field');
select throws_ok(
  $$ select public.apply_markup_ops('b1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '4', '15', 0, 1000, pg_temp.all_fields('#ff0000'), 'b1000000-0000-4000-8000-000000000003'))) $$,
  '42501', null, 'A cannot write to B''s set (IDOR)');
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '5', '16', 0, 1000, pg_temp.all_fields('#ff0000'), 'b1000000-0000-4000-8000-000000000003'))) $$,
  '42501', null, 'A cannot put a markup on B''s page');
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(
       jsonb_build_object('opId', '00000000-0000-7000-8000-000000000017', 'markupId', 'b1000000-0000-7000-8000-00000000000a',
                          'kind', 'update', 'type', 'line', 'baseVersion', 1, 'clientTs', 99999999999999, 'fields', '{"z": 9}'::jsonb))) $$,
  '42501', null, 'A cannot change B''s markup through A''s set (IDOR)');
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '18', 7, 1000, '{"z": 1}') || '{"type": "rectangle"}'::jsonb)) $$,
  '22023', null, 'a markup''s type does not change');

-- Rate limit: a full window refuses the call.
reset role;
insert into app.rate_limits (bucket, key_hash, hits)
values ('markup_ops', encode(sha256(convert_to('91111111-1111-4111-8111-111111111111', 'UTF8')), 'hex'), 600)
on conflict (bucket, key_hash) do update set hits = 600, window_started_at = now();
set local role authenticated;
select throws_ok(
  $$ select public.apply_markup_ops('a1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('update', '1', '19', 7, 1000, '{"z": 1}'))) $$,
  'PT429', null, 'op writes are rate-limited per user');

-- A deactivated user can neither read nor write their own set.
set local request.jwt.claims = '{"sub":"93333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_markup_ops('c1000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.op('create', '6', '20', 0, 1000, pg_temp.all_fields('#ff0000'), 'c1000000-0000-4000-8000-000000000003'))) $$,
  '42501', null, 'a deactivated user cannot write');

-- B still sees B's own markup, not A's.
set local request.jwt.claims = '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*) from public.markups), 1::bigint, 'B sees only B''s markup');

select * from finish();
rollback;
