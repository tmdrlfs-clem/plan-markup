-- Stories 6.5 / 6.6: public.list_markup_sets lists only the caller's sets,
-- newest change first, with their first file and live markup count.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a5111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'ls-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a5222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'ls-b@rls.test');
update public.profiles set status = 'active' where id in ('a5111111-1111-4111-8111-111111111111', 'a5222222-2222-4222-8222-222222222222');

insert into public.drawings (id, owner_id, title, updated_at) values
  ('a5000000-0000-4000-8000-000000000001', 'a5111111-1111-4111-8111-111111111111', 'Old.pdf', now() - interval '2 days'),
  ('a5000000-0000-4000-8000-000000000002', 'a5111111-1111-4111-8111-111111111111', 'New.pdf', now() - interval '3 days'),
  ('a5000000-0000-4000-8000-000000000003', 'a5222222-2222-4222-8222-222222222222', 'B.pdf', now());
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename) values
  ('a5000000-0000-4000-8000-000000000011', 'a5000000-0000-4000-8000-000000000001', repeat('1', 64), 3, 'Old.pdf'),
  ('a5000000-0000-4000-8000-000000000012', 'a5000000-0000-4000-8000-000000000002', repeat('2', 64), 7, 'New.pdf'),
  ('a5000000-0000-4000-8000-000000000013', 'a5000000-0000-4000-8000-000000000003', repeat('3', 64), 1, 'B.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height) values
  ('a5000000-0000-4000-8000-000000000021', 'a5000000-0000-4000-8000-000000000012', 0, array[0, 0, 10, 10], 10, 10);
-- New.pdf's set changed an hour ago through a markup (newer than Old.pdf's set); one deleted markup does not count.
insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id, updated_at, deleted_at) values
  ('a5000000-0000-7000-8000-000000000031', 'a5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000021', 'line', '{}', '{}', '{}', 'a5111111-1111-4111-8111-111111111111', now() - interval '1 hour', null),
  ('a5000000-0000-7000-8000-000000000032', 'a5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000021', 'line', '{}', '{}', '{}', 'a5111111-1111-4111-8111-111111111111', now() - interval '1 hour', now());

select ok(not has_function_privilege('anon', 'public.list_markup_sets()', 'execute'), 'anon cannot list markup sets');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.list_markup_sets()), 2::bigint, 'A lists only A''s sets');
select results_eq(
  $$ select filename, page_count, markup_count from public.list_markup_sets() $$,
  $$ values ('New.pdf', 7, 1), ('Old.pdf', 3, 0) $$,
  'newest change first (a markup counts), with the first file and live markups');
select ok((select last_modified > now() - interval '2 hours' from public.list_markup_sets() limit 1), 'last modified comes from the newest markup');

set local request.jwt.claims = '{"sub":"a5222222-2222-4222-8222-222222222222","role":"authenticated"}';
select results_eq($$ select filename from public.list_markup_sets() $$, $$ values ('B.pdf') $$, 'B lists only B''s set');

select * from finish();
rollback;
