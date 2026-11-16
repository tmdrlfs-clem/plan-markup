-- Story 10.10: public.admin_lookup_markup_sets().
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'e1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'sup-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'e2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'sup-user@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'e3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'sup-empty@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'e4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'sup-boss@rls.test');
update public.profiles set status = 'active' where email like 'sup-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'e1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('e1111111-1111-4111-8111-111111111111', 'Support Co rls', 'sup-boss@rls.test');

-- The user's sets: one with two file versions and three markups (one deleted), one with no file yet.
insert into public.drawings (id, owner_id, title, created_at, updated_at) values
  ('e2000000-0000-4000-8000-000000000001', 'e2222222-2222-4222-8222-222222222222', 'L3 RCP.pdf', now() - interval '3 days', now() - interval '3 days'),
  ('e2000000-0000-4000-8000-000000000002', 'e2222222-2222-4222-8222-222222222222', 'Untitled set', now() - interval '9 days', now() - interval '9 days'),
  ('e4000000-0000-4000-8000-000000000001', 'e4444444-4444-4444-8444-444444444444', 'Someone else.pdf', now(), now());
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename, created_at) values
  ('e2000000-0000-4000-8000-0000000000f1', 'e2000000-0000-4000-8000-000000000001', repeat('1', 64), 4, 'L3 RCP Rev A.pdf', now() - interval '3 days'),
  ('e2000000-0000-4000-8000-0000000000f2', 'e2000000-0000-4000-8000-000000000001', repeat('2', 64), 6, 'L3 RCP Rev B.pdf', now() - interval '2 days');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height)
values ('e2000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-0000000000f2', 0, array[0, 0, 842, 595], 842, 595);
insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id, updated_at, deleted_at)
select ('e2000000-0000-7000-8000-00000000000' || n)::uuid, 'e2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-0000000000a1',
       'text', '{"points": []}', '{}', '{"text": "Secret note"}', 'e2222222-2222-4222-8222-222222222222', at, gone
from (values (1, now() - interval '1 day', null::timestamptz), (2, now() - interval '2 days', null), (3, now() - interval '1 hour', now() - interval '1 hour')) v(n, at, gone);

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.admin_lookup_markup_sets(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_lookup_markup_sets(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_lookup_markup_sets(uuid, uuid)', 'execute'),
  'only service_role can call admin_lookup_markup_sets');

-- Refusals write nothing.
select throws_ok(
  $$ select * from public.admin_lookup_markup_sets('e4444444-4444-4444-8444-444444444444', 'e2222222-2222-4222-8222-222222222222') $$,
  'PT403', null, 'a company admin cannot look up markup sets');
select throws_ok(
  $$ select * from public.admin_lookup_markup_sets('e2222222-2222-4222-8222-222222222222', 'e2222222-2222-4222-8222-222222222222') $$,
  'PT403', null, 'a user cannot use the lookup on themselves');
select throws_ok(
  $$ select * from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e9999999-9999-4999-8999-999999999999') $$,
  'PT404', null, 'an unknown account is refused');
select is(
  (select count(*)::int from public.audit_log where action = 'support.markup_sets_viewed'
     and (actor_id = 'e1111111-1111-4111-8111-111111111111' or target_id = 'e2222222-2222-4222-8222-222222222222')),
  0, 'refused lookups are not recorded as lookups');

-- The lookup: file name, pages and counts; the newest saved set first.
select results_eq(
  $$ select filename, page_count, file_count, markup_count
       from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222') $$,
  $$ values ('L3 RCP Rev B.pdf', 6, 2, 2), ('Untitled set', null::integer, 0, 0) $$,
  'each set shows its newest file name and page count, its file versions and its live markups');
select ok(
  (select last_saved_at > now() - interval '2 hours' and created_at < now() - interval '2 days'
     from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222')
    where filename = 'L3 RCP Rev B.pdf'),
  'last saved is the newest change to the set or its markups');
select ok(
  not exists (
    select 1 from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222') s
    where s::text like '%Secret%' or s::text like '%points%' or s::text like '%Someone else%'
  ),
  'no markup content, and nobody else''s set, is in the result');

-- Each lookup is recorded.
select is(
  (select count(*)::int from public.audit_log where action = 'support.markup_sets_viewed'
     and actor_id = 'e1111111-1111-4111-8111-111111111111' and target_id = 'e2222222-2222-4222-8222-222222222222'),
  3, 'the three lookups above are each recorded');
select results_eq(
  $$ select distinct target_type, detail from public.audit_log where action = 'support.markup_sets_viewed'
      and actor_id = 'e1111111-1111-4111-8111-111111111111' and target_id = 'e2222222-2222-4222-8222-222222222222' $$,
  $$ values ('user', '{"sets": 2}'::jsonb) $$,
  'with the account and how many sets were listed');

-- An account with no sets: no rows, still recorded.
select is(
  (select count(*)::int from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e3333333-3333-4333-8333-333333333333')),
  0, 'an account with no markup sets lists nothing');
select is(
  (select detail from public.audit_log where action = 'support.markup_sets_viewed' and target_id = 'e3333333-3333-4333-8333-333333333333'),
  '{"sets": 0}'::jsonb, 'and the lookup is recorded all the same');

-- A deactivated admin cannot look up.
update public.profiles set status = 'deactivated' where id = 'e1111111-1111-4111-8111-111111111111';
select throws_ok(
  $$ select * from public.admin_lookup_markup_sets('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222') $$,
  'PT403', null, 'a deactivated platform admin is refused');

-- The owner's own access is unchanged: RLS still hides the set from the platform admin's own client.
update public.profiles set status = 'active' where id = 'e1111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.drawings where owner_id = 'e2222222-2222-4222-8222-222222222222')
  + (select count(*)::int from public.markups where drawing_id = 'e2000000-0000-4000-8000-000000000001'),
  0, 'the platform admin still cannot read the drawings or markups themselves');
reset role;

select * from finish();
rollback;
