-- Story 10.7: public.set_company_member_role() and public.remove_company_member().
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'mc-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'mc-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'mc-member@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'mc-viewer@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'mc-other-boss@rls.test');
update public.profiles set status = 'active' where email like 'mc-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'b1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('b1111111-1111-4111-8111-111111111111', 'Member Co rls', 'mc-boss@rls.test');
select * from public.admin_create_company('b1111111-1111-4111-8111-111111111111', 'Member Other rls', 'mc-other-boss@rls.test');
insert into public.company_members (user_id, company_id, role)
select u, (select id from public.companies where name = 'Member Co rls'), r
from (values ('b3333333-3333-4333-8333-333333333333'::uuid, 'member'), ('b4444444-4444-4444-8444-444444444444'::uuid, 'viewer')) v(u, r);
insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('b3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b3333333-3333-4333-8333-333333333333', now(), now()),
  ('b4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b4444444-4444-4444-8444-444444444444', now(), now()),
  ('b2aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222', now(), now());
-- The viewer owns a markup set.
insert into public.drawings (id, owner_id, title)
values ('b4dddddd-dddd-4ddd-8ddd-dddddddddddd', 'b4444444-4444-4444-8444-444444444444', 'Kept after removal');

create temporary table t on commit drop as select (select id from public.companies where name = 'Member Co rls') as co;

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.set_company_member_role(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.remove_company_member(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.remove_company_member(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.fn_company_admin_guard(uuid, uuid)', 'execute'),
  'users cannot call the member functions');
select ok(
  has_function_privilege('service_role', 'public.set_company_member_role(uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.remove_company_member(uuid, uuid)', 'execute'),
  'service_role can');

-- Who may change whom.
select throws_ok(
  $$ select * from public.set_company_member_role('b3333333-3333-4333-8333-333333333333', 'b4444444-4444-4444-8444-444444444444', 'member') $$,
  'PT403', null, 'a plain member cannot change roles');
select throws_ok(
  $$ select * from public.set_company_member_role('b1111111-1111-4111-8111-111111111111', 'b4444444-4444-4444-8444-444444444444', 'member') $$,
  'PT403', null, 'the platform admin is not a company admin');
select throws_ok(
  $$ select * from public.set_company_member_role('b5555555-5555-4555-8555-555555555555', 'b4444444-4444-4444-8444-444444444444', 'member') $$,
  'PT404', null, 'another company''s admin cannot change this company''s member');
select throws_ok(
  $$ select public.remove_company_member('b5555555-5555-4555-8555-555555555555', 'b4444444-4444-4444-8444-444444444444') $$,
  'PT404', null, 'nor remove them');
select throws_ok(
  $$ select * from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b4444444-4444-4444-8444-444444444444', 'owner') $$,
  '22023', null, 'an unknown role is refused');

-- The last admin stays.
select throws_ok(
  $$ select * from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222', 'member') $$,
  'PT409', null, 'the only admin cannot demote themselves');
select throws_ok(
  $$ select public.remove_company_member('b2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222') $$,
  'PT409', null, 'nor remove themselves');
select is(
  (select count(*)::int from public.audit_log where target_id = (select co from t) and action like 'company.member_r%'),
  0, 'refused calls write nothing');
select is((select count(*)::int from auth.sessions where user_id = 'b2222222-2222-4222-8222-222222222222'), 1, 'and end no session');

-- Change a role: applied, sessions ended, recorded.
select results_eq(
  $$ select previous_role from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b4444444-4444-4444-8444-444444444444', 'member') $$,
  $$ values ('viewer') $$, 'the role change returns the role before it');
select is((select role from public.company_members where user_id = 'b4444444-4444-4444-8444-444444444444'), 'member', 'the role is changed');
select is((select count(*)::int from auth.sessions where user_id = 'b4444444-4444-4444-8444-444444444444'), 0, 'the member''s sessions are ended');
select results_eq(
  $$ select actor_id, detail from public.audit_log where target_id = (select co from t) and action = 'company.member_role_changed' $$,
  $$ values ('b2222222-2222-4222-8222-222222222222'::uuid,
             '{"user_id":"b4444444-4444-4444-8444-444444444444","from":"viewer","to":"member"}'::jsonb) $$,
  'the change is recorded');
select results_eq(
  $$ select previous_role from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b4444444-4444-4444-8444-444444444444', 'member') $$,
  $$ values ('member') $$, 'the same role again reports it');
select is(
  (select count(*)::int from public.audit_log where target_id = (select co from t) and action = 'company.member_role_changed'),
  1, 'and writes no second record');

-- A second admin: now the first may step down, but a deactivated admin does not count.
select lives_ok(
  $$ select * from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333', 'admin') $$,
  'a member is made admin');
update public.profiles set status = 'deactivated' where id = 'b3333333-3333-4333-8333-333333333333';
select throws_ok(
  $$ select * from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222', 'viewer') $$,
  'PT409', null, 'a deactivated admin does not count as the remaining admin');
update public.profiles set status = 'active' where id = 'b3333333-3333-4333-8333-333333333333';
select lives_ok(
  $$ select * from public.set_company_member_role('b3333333-3333-4333-8333-333333333333', 'b2222222-2222-4222-8222-222222222222', 'viewer') $$,
  'with another active admin, the first admin is demoted');
select throws_ok(
  $$ select * from public.set_company_member_role('b2222222-2222-4222-8222-222222222222', 'b4444444-4444-4444-8444-444444444444', 'viewer') $$,
  'PT403', null, 'a demoted admin can no longer change roles');

-- Remove: membership gone, sessions ended, the account and its markup sets stay.
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('b4bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b4444444-4444-4444-8444-444444444444', now(), now());
select lives_ok(
  $$ select public.remove_company_member('b3333333-3333-4333-8333-333333333333', 'b4444444-4444-4444-8444-444444444444') $$,
  'a member is removed');
select is((select count(*)::int from public.company_members where user_id = 'b4444444-4444-4444-8444-444444444444'), 0, 'the membership is gone');
select is((select count(*)::int from auth.sessions where user_id = 'b4444444-4444-4444-8444-444444444444'), 0, 'the sessions are ended');
select is((select status from public.profiles where id = 'b4444444-4444-4444-8444-444444444444'), 'active', 'the account stays active (individual use)');
select results_eq(
  $$ select actor_id, detail from public.audit_log where target_id = (select co from t) and action = 'company.member_removed' $$,
  $$ values ('b3333333-3333-4333-8333-333333333333'::uuid, '{"user_id":"b4444444-4444-4444-8444-444444444444","role":"member"}'::jsonb) $$,
  'the removal is recorded');
select throws_ok(
  $$ select public.remove_company_member('b3333333-3333-4333-8333-333333333333', 'b4444444-4444-4444-8444-444444444444') $$,
  'PT404', null, 'someone already removed is not a member');

-- The removed member's own markup set is untouched (FR8).
select is(
  (select count(*)::int from public.drawings where id = 'b4dddddd-dddd-4ddd-8ddd-dddddddddddd' and owner_id = 'b4444444-4444-4444-8444-444444444444'),
  1, 'the removed member keeps their own markup set');

select * from finish();
rollback;
