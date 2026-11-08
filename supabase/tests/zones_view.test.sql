-- Story 9.2: public.zones shows zone markups under the caller's markups RLS
-- (effective access); zones are written through apply_markup_ops only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '9a111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'zn-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '9b222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'zn-b@rls.test');
update public.profiles set status = 'active'
where id in ('9a111111-1111-4111-8111-111111111111', '9b222222-2222-4222-8222-222222222222');

insert into public.drawings (id, owner_id, title) values
  ('a9000000-0000-4000-8000-000000000001', '9a111111-1111-4111-8111-111111111111', 'A.pdf'),
  ('b9000000-0000-4000-8000-000000000001', '9b222222-2222-4222-8222-222222222222', 'B.pdf');
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename) values
  ('a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', repeat('d', 64), 1, 'A.pdf'),
  ('b9000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000001', repeat('e', 64), 1, 'B.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height) values
  ('a9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595),
  ('b9000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595);
insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id) values
  ('b9000000-0000-7000-8000-00000000000a', 'b9000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000003',
   'zone', '{"points": [{"x": 0, "y": 0}, {"x": 9, "y": 0}, {"x": 9, "y": 9}]}', '{"color": "#7a68b3"}',
   '{"zone": {"name": "Zone 1", "use": "Office"}}', '9b222222-2222-4222-8222-222222222222');

-- A zone op as jsonb: kind, op id suffix, base version, client ms, fields.
create function pg_temp.zop(p_kind text, p_op text, p_base int, p_ts bigint, p_fields jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'opId', '00000000-0000-7000-8000-' || lpad(p_op, 12, '0'),
    'markupId', 'a9000000-0000-7000-8000-000000000001',
    'kind', p_kind, 'type', 'zone', 'pageId', 'a9000000-0000-4000-8000-000000000003',
    'baseVersion', p_base, 'clientTs', p_ts, 'fields', p_fields);
$$;

select ok(not has_table_privilege('anon', 'public.zones', 'select'), 'anon has no SELECT on public.zones');
select ok(not has_table_privilege('authenticated', 'public.zones', 'insert'), 'zones are not inserted directly');
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.zones'::regclass),
  'the view runs with the caller''s rights (markups RLS applies)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.zones), 0::bigint, 'A sees none of B''s zones');

select is(
  public.apply_markup_ops('a9000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.zop('create', '91', 0, 1000, jsonb_build_object(
    'geometry', '{"points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 100, "y": 80}, {"x": 0, "y": 80}], "holes": [[{"x": 10, "y": 10}, {"x": 12, "y": 10}, {"x": 12, "y": 12}]]}'::jsonb,
    'style', '{"color": "#7a68b3", "width": 1, "fontSize": 10}'::jsonb,
    'props', '{"createdAt": "2026-11-12T00:00:00Z", "zone": {"name": "Zone 1", "use": "Office", "holeTags": ["column"]}}'::jsonb,
    'z', 1)))) -> 0 ->> 'status',
  'applied', 'a zone is created through apply_markup_ops');

select results_eq(
  $$ select name, use, jsonb_array_length(polygon), jsonb_array_length(holes), hole_tags ->> 0, options from public.zones $$,
  $$ values ('Zone 1', 'Office', 4, 1, 'column', '{}'::jsonb) $$,
  'A reads the zone''s polygon, holes, tags, use and options');

select is(
  public.apply_markup_ops('a9000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.zop('update', '92', 1, 2000,
    '{"props": {"createdAt": "2026-11-12T00:00:00Z", "zone": {"name": "Open office", "use": "Storage", "holeTags": ["shaft"]}}}'::jsonb))) -> 0 ->> 'status',
  'applied', 'a zone is changed through apply_markup_ops');
select results_eq(
  $$ select name, use, hole_tags ->> 0 from public.zones $$,
  $$ values ('Open office', 'Storage', 'shaft') $$,
  'the view shows the change');

select is(
  public.apply_markup_ops('a9000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.zop('delete', '93', 2, 3000, '{}'::jsonb))) -> 0 ->> 'status',
  'deleted', 'a zone is deleted through apply_markup_ops');
select is((select count(*) from public.zones), 0::bigint, 'a deleted zone leaves the view');

select * from finish();
rollback;
