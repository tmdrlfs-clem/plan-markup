-- Story 10.8: profiles.plan, companies.plan and public.admin_set_plan().
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'c1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'pl-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'pl-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'pl-solo@rls.test');
update public.profiles set status = 'active' where email like 'pl-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'c1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('c1111111-1111-4111-8111-111111111111', 'Plan Co rls', 'pl-boss@rls.test');
create temporary table t on commit drop as select (select id from public.companies where name = 'Plan Co rls') as co;
grant select on t to authenticated;

-- Defaults and privileges.
select is((select plan from public.profiles where id = 'c3333333-3333-4333-8333-333333333333'), 'trial', 'a new account is on the trial plan');
select is((select plan from public.companies where id = (select co from t)), 'trial', 'a new company is on the trial plan');
select ok(
  not has_function_privilege('authenticated', 'public.admin_set_plan(uuid, text, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_plan(uuid, text, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_set_plan(uuid, text, uuid, text)', 'execute'),
  'only service_role can call admin_set_plan');
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'plan', 'update')
  and not has_column_privilege('authenticated', 'public.companies', 'plan', 'update'),
  'users have no update privilege on either plan column');

-- Refusals.
select throws_ok(
  $$ select * from public.admin_set_plan('c2222222-2222-4222-8222-222222222222', 'company', (select co from t), 'standard') $$,
  'PT403', null, 'a company admin cannot set their company''s plan');
select throws_ok(
  $$ select * from public.admin_set_plan('c3333333-3333-4333-8333-333333333333', 'user', 'c3333333-3333-4333-8333-333333333333', 'standard') $$,
  'PT403', null, 'a user cannot set their own plan');
select throws_ok(
  $$ select * from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'user', 'c3333333-3333-4333-8333-333333333333', 'enterprise') $$,
  '22023', null, 'an unknown plan is refused');
select throws_ok(
  $$ select * from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'drawing', 'c3333333-3333-4333-8333-333333333333', 'pilot') $$,
  '22023', null, 'an unknown target type is refused');
select throws_ok(
  $$ select * from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'user', 'c9999999-9999-4999-8999-999999999999', 'pilot') $$,
  'PT404', null, 'an unknown user is refused');
select throws_ok(
  $$ select * from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'company', 'c3333333-3333-4333-8333-333333333333', 'pilot') $$,
  'PT404', null, 'a user id is not a company');
select throws_ok(
  $$ update public.profiles set plan = 'gold' where id = 'c3333333-3333-4333-8333-333333333333' $$,
  '23514', null, 'the column accepts only the three plans');

-- Set a user's plan.
select results_eq(
  $$ select previous_plan from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'user', 'c3333333-3333-4333-8333-333333333333', 'pilot') $$,
  $$ values ('trial') $$, 'setting a user''s plan returns the plan before it');
select is((select plan from public.profiles where id = 'c3333333-3333-4333-8333-333333333333'), 'pilot', 'the user''s plan is saved');
select results_eq(
  $$ select actor_id, action, target_type, detail from public.audit_log where target_id = 'c3333333-3333-4333-8333-333333333333' $$,
  $$ values ('c1111111-1111-4111-8111-111111111111'::uuid, 'user.plan_changed', 'user', '{"from":"trial","to":"pilot"}'::jsonb) $$,
  'the change is recorded');
select results_eq(
  $$ select previous_plan from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'user', 'c3333333-3333-4333-8333-333333333333', 'pilot') $$,
  $$ values ('pilot') $$, 'the same plan again reports it');
select is((select count(*)::int from public.audit_log where target_id = 'c3333333-3333-4333-8333-333333333333'), 1, 'and writes no second record');

-- Set a company's plan.
select lives_ok(
  $$ select * from public.admin_set_plan('c1111111-1111-4111-8111-111111111111', 'company', (select co from t), 'standard') $$,
  'a company''s plan is set');
select is((select plan from public.companies where id = (select co from t)), 'standard', 'the company''s plan is saved');
select results_eq(
  $$ select action, target_type, detail from public.audit_log where target_id = (select co from t) and action = 'company.plan_changed' $$,
  $$ values ('company.plan_changed', 'company', '{"from":"trial","to":"standard"}'::jsonb) $$,
  'the change is recorded');

-- As the users themselves: readable, never writable (NFR24).
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set plan = 'standard' where id = 'c3333333-3333-4333-8333-333333333333' $$,
  '42501', null, 'a user cannot write their own plan');
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ update public.companies set plan = 'pilot' where id = (select co from t) $$,
  '42501', null, 'a company admin cannot write the company''s plan');
select is((select plan from public.companies where id = (select co from t)), 'standard', 'but reads it');
reset role;

select * from finish();
rollback;
