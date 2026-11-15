-- Rows are counted by this test's own actor: a local database may hold audit rows from e2e runs.
-- Story 10.4: audit_log, the platform admin's view of profiles, and
-- public.admin_set_user_status().
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '81111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'adm@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '82222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'pending@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '83333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'plain@rls.test');
update public.profiles set status = 'active', is_platform_admin = true where id = '81111111-1111-4111-8111-111111111111';
update public.profiles set status = 'active' where id = '83333333-3333-4333-8333-333333333333';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '83333333-3333-4333-8333-333333333333', now(), now());

-- Privileges.
select ok(not has_function_privilege('authenticated', 'public.admin_set_user_status(uuid, uuid, text)', 'execute'),
  'authenticated cannot call admin_set_user_status');
select ok(not has_function_privilege('anon', 'public.admin_set_user_status(uuid, uuid, text)', 'execute'),
  'anon cannot call admin_set_user_status');
select ok(has_function_privilege('service_role', 'public.admin_set_user_status(uuid, uuid, text)', 'execute'),
  'service_role can call admin_set_user_status');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert'), 'authenticated cannot insert into audit_log');

-- The actor is checked.
select throws_ok(
  $$ select * from public.admin_set_user_status('83333333-3333-4333-8333-333333333333', '82222222-2222-4222-8222-222222222222', 'active') $$,
  'PT403', null, 'an ordinary user is not accepted as the actor');
select throws_ok(
  $$ select * from public.admin_set_user_status('82222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'active') $$,
  'PT403', null, 'a pending user cannot activate themselves');
select throws_ok(
  $$ select * from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'deactivated') $$,
  'PT409', null, 'an admin cannot deactivate their own account');
select throws_ok(
  $$ select * from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '82222222-2222-4222-8222-222222222222', 'pending') $$,
  '22023', null, 'pending is not a status an admin can set');
select throws_ok(
  $$ select * from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '89999999-9999-4999-8999-999999999999', 'active') $$,
  'PT404', null, 'an unknown user is refused');
select is((select count(*)::int from public.audit_log where actor_id = '81111111-1111-4111-8111-111111111111'), 0, 'refused calls write nothing');

-- Activate.
select results_eq(
  $$ select previous_status, email from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '82222222-2222-4222-8222-222222222222', 'active') $$,
  $$ values ('pending', 'pending@rls.test') $$,
  'activation returns the previous status and the email');
select is((select status from public.profiles where id = '82222222-2222-4222-8222-222222222222'), 'active', 'the account is active');
select results_eq(
  $$ select actor_id, action, target_type, target_id, detail from public.audit_log where actor_id = '81111111-1111-4111-8111-111111111111' $$,
  $$ values ('81111111-1111-4111-8111-111111111111'::uuid, 'user.activated', 'user',
             '82222222-2222-4222-8222-222222222222'::uuid, '{"from":"pending","to":"active"}'::jsonb) $$,
  'the activation is recorded');

-- The same status again: nothing changes, nothing is recorded.
select results_eq(
  $$ select previous_status from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '82222222-2222-4222-8222-222222222222', 'active') $$,
  $$ values ('active') $$,
  'setting the same status reports it');
select is((select count(*)::int from public.audit_log where actor_id = '81111111-1111-4111-8111-111111111111'), 1, 'and writes no second record');

-- Deactivate: sessions end.
select lives_ok(
  $$ select * from public.admin_set_user_status('81111111-1111-4111-8111-111111111111', '83333333-3333-4333-8333-333333333333', 'deactivated') $$,
  'deactivation succeeds');
select is((select status from public.profiles where id = '83333333-3333-4333-8333-333333333333'), 'deactivated', 'the account is deactivated');
select is((select count(*)::int from auth.sessions where user_id = '83333333-3333-4333-8333-333333333333'), 0, 'its sessions are gone');
select is((select count(*)::int from public.audit_log where action = 'user.deactivated' and actor_id = '81111111-1111-4111-8111-111111111111'), 1, 'the deactivation is recorded');

-- Append-only, for every role.
select throws_ok($$ update public.audit_log set action = 'user.activated' $$, '42501', null, 'audit_log rows cannot be updated');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'audit_log rows cannot be deleted');

-- Who reads what.
set local role authenticated;
set local request.jwt.claims = '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  (select count(*) from public.profiles where id in ('82222222-2222-4222-8222-222222222222', '83333333-3333-4333-8333-333333333333')) = 2
  and (select count(*) from public.audit_log where actor_id = '81111111-1111-4111-8111-111111111111') = 2,
  'the platform admin reads other profiles and the audit log');
set local request.jwt.claims = '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.profiles), 1, 'an ordinary user still reads only their own profile');
select is((select count(*)::int from public.audit_log), 0, 'an ordinary user reads no audit rows');
reset role;

select * from finish();
rollback;
