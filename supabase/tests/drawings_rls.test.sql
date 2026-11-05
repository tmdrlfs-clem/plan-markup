-- Story 6.1: RLS on drawings, drawing_files, pages and calibrations, and
-- public.ensure_drawing_file (AR5, AR6): only the owner, while active, reads
-- or writes their markup sets; nobody else, and never anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '81111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'dwg-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '82222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'dwg-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '83333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'dwg-off@rls.test');
update public.profiles set status = 'active'
where id in ('81111111-1111-4111-8111-111111111111', '82222222-2222-4222-8222-222222222222');
update public.profiles set status = 'deactivated' where id = '83333333-3333-4333-8333-333333333333';

-- Fixtures as postgres: B's markup set of one page with a calibration.
insert into public.drawings (id, owner_id, title)
values ('b0000000-0000-4000-8000-000000000001', '82222222-2222-4222-8222-222222222222', 'B.pdf');
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename)
values ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', repeat('b', 64), 1, 'B.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height)
values ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595);
insert into public.calibrations (page_id, calibration)
values ('b0000000-0000-4000-8000-000000000003', '{"xFactor": 26.46, "yFactor": 26.46, "unit": "mm"}');

select throws_ok(
  $$ insert into public.drawing_files (drawing_id, sha256, page_count, filename)
     values ('b0000000-0000-4000-8000-000000000001', 'ABC', 1, 'x.pdf') $$,
  '23514', null,
  'a file''s sha256 is 64 lowercase hex digits'
);
select throws_ok(
  $$ insert into public.drawing_files (drawing_id, sha256, page_count, filename)
     values ('b0000000-0000-4000-8000-000000000001', repeat('b', 64), 1, 'again.pdf') $$,
  '23505', null,
  'a set holds a file''s hash once'
);
select ok(not has_table_privilege('anon', 'public.drawings', 'select'), 'anon has no SELECT on public.drawings');
select ok(not has_table_privilege('anon', 'public.calibrations', 'select'), 'anon has no SELECT on public.calibrations');
select ok(not has_function_privilege('anon', 'public.ensure_drawing_file(text, text, jsonb)', 'execute'), 'anon cannot run ensure_drawing_file');
select ok(not has_table_privilege('authenticated', 'public.drawing_files', 'update'), 'a file''s identity cannot be changed');

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.drawings), 0::bigint, 'user A sees none of B''s drawings');
select is((select count(*) from public.drawing_files), 0::bigint, 'user A sees none of B''s files');
select is((select count(*) from public.pages), 0::bigint, 'user A sees none of B''s pages');
select is((select count(*) from public.calibrations), 0::bigint, 'user A sees none of B''s calibrations');
select throws_ok(
  $$ insert into public.drawing_files (drawing_id, sha256, page_count, filename)
     values ('b0000000-0000-4000-8000-000000000001', repeat('a', 64), 1, 'x.pdf') $$,
  '42501', null,
  'user A cannot add a file to B''s drawing'
);
select throws_ok(
  $$ insert into public.calibrations (page_id, calibration) values ('b0000000-0000-4000-8000-000000000003', '{}') $$,
  '42501', null,
  'user A cannot calibrate B''s page'
);
update public.calibrations set calibration = '{}' where page_id = 'b0000000-0000-4000-8000-000000000003';
delete from public.drawings where id = 'b0000000-0000-4000-8000-000000000001';

-- ensure_drawing_file: B's hash makes A's own set (it never returns B's).
select is(
  (select count(*) from public.ensure_drawing_file(repeat('b', 64), 'Mine.pdf',
     '[{"rotation": 90, "cropBox": [0, 0, 842, 595], "width": 842, "height": 595},
       {"rotation": 0, "cropBox": [0, 0, 595, 842], "width": 595, "height": 842}]')),
  1::bigint,
  'user A''s first edit of a file makes a set'
);
select is((select count(*) from public.drawings), 1::bigint, 'user A has one drawing');
select is((select title from public.drawings), 'Mine.pdf', 'titled by the filename');
select is((select array_agg(rotation order by index) from public.pages), array[90, 0], 'its pages in order');
select isnt(
  (select file_id from public.ensure_drawing_file(repeat('b', 64), 'Mine.pdf', '[{"cropBox": [0, 0, 1, 1], "width": 1, "height": 1}]')),
  'b0000000-0000-4000-8000-000000000002'::uuid,
  'it never returns another user''s file'
);
select is((select count(*) from public.drawing_files), 1::bigint, 'the second call returns the same file');
select is(
  (select cardinality(page_ids) from public.ensure_drawing_file(repeat('b', 64), 'Mine.pdf', '[{"cropBox": [0, 0, 1, 1], "width": 1, "height": 1}]')),
  2,
  'with its page ids'
);
select throws_ok(
  $$ select * from public.ensure_drawing_file('nope', 'x.pdf', '[{"cropBox": [0, 0, 1, 1], "width": 1, "height": 1}]') $$,
  '22023', null,
  'a bad hash is refused'
);

-- As postgres: B's rows are untouched.
reset role;
select is(
  (select calibration ->> 'unit' from public.calibrations where page_id = 'b0000000-0000-4000-8000-000000000003'),
  'mm',
  'user A''s update of B''s calibration changed nothing'
);
select is((select count(*) from public.drawings where id = 'b0000000-0000-4000-8000-000000000001'), 1::bigint, 'user A''s delete of B''s drawing removed nothing');

-- A deactivated user sees and makes nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"83333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select * from public.ensure_drawing_file(repeat('c', 64), 'x.pdf', '[{"cropBox": [0, 0, 1, 1], "width": 1, "height": 1}]') $$,
  '42501', null,
  'a deactivated user cannot make a set'
);
select throws_ok(
  $$ insert into public.drawings (owner_id, title) values ('83333333-3333-4333-8333-333333333333', 'x') $$,
  '42501', null,
  'a deactivated user cannot insert a drawing'
);

select * from finish();
rollback;
