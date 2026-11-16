-- Story 10.5: companies, company_members, the membership helpers and
-- public.admin_create_company().
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'co-adm@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '92222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'Co-First@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '93333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'co-second@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '94444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'co-pending@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '95555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'co-outsider@rls.test');
update public.profiles set status = 'active', is_platform_admin = true where id = '91111111-1111-4111-8111-111111111111';
update public.profiles set status = 'active'
 where id in ('92222222-2222-4222-8222-222222222222', '93333333-3333-4333-8333-333333333333', '95555555-5555-4555-8555-555555555555');

-- Privileges.
select ok(not has_function_privilege('authenticated', 'public.admin_create_company(uuid, text, text)', 'execute'),
  'authenticated cannot call admin_create_company');
select ok(not has_function_privilege('anon', 'public.admin_create_company(uuid, text, text)', 'execute'),
  'anon cannot call admin_create_company');
select ok(has_function_privilege('service_role', 'public.admin_create_company(uuid, text, text)', 'execute'),
  'service_role can call admin_create_company');
select ok(
  not has_table_privilege('authenticated', 'public.companies', 'insert')
  and not has_table_privilege('authenticated', 'public.companies', 'update')
  and not has_table_privilege('authenticated', 'public.company_members', 'insert')
  and not has_table_privilege('authenticated', 'public.company_members', 'update')
  and not has_table_privilege('authenticated', 'public.company_members', 'delete'),
  'authenticated cannot write companies or company_members');

-- Refusals.
select throws_ok(
  $$ select * from public.admin_create_company('92222222-2222-4222-8222-222222222222', 'Acme Fire', 'co-first@rls.test') $$,
  'PT403', null, 'an ordinary user is not accepted as the actor');
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', '   ', 'co-first@rls.test') $$,
  '22023', null, 'a blank name is refused');
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', repeat('x', 101), 'co-first@rls.test') $$,
  '22023', null, 'a name over 100 characters is refused');
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', 'Acme Fire', 'nobody@rls.test') $$,
  'PT404', null, 'an unknown email is refused');
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', 'Acme Fire', 'co-pending@rls.test') $$,
  'PT422', null, 'a pending account cannot be the first admin');
select is((select count(*)::int from public.companies where name = 'Acme Fire'), 0, 'refused calls create nothing');

-- Create: name trimmed, email matched whatever its case.
select results_eq(
  $$ select admin_user_id from public.admin_create_company('91111111-1111-4111-8111-111111111111', '  Acme Fire ', ' CO-FIRST@rls.test') $$,
  $$ values ('92222222-2222-4222-8222-222222222222'::uuid) $$,
  'the company is created with its first admin');
select is((select count(*)::int from public.companies where name = 'Acme Fire'), 1, 'the name is stored trimmed');
select results_eq(
  $$ select m.role from public.company_members m join public.companies c on c.id = m.company_id
      where c.name = 'Acme Fire' and m.user_id = '92222222-2222-4222-8222-222222222222' $$,
  $$ values ('admin') $$,
  'the user is its admin');
select results_eq(
  $$ select a.actor_id, a.action, a.target_type, a.target_id = c.id, a.detail
       from public.audit_log a join public.companies c on c.name = 'Acme Fire'
      where a.action = 'company.created' and a.actor_id = '91111111-1111-4111-8111-111111111111' $$,
  $$ values ('91111111-1111-4111-8111-111111111111'::uuid, 'company.created', 'company', true,
             '{"name":"Acme Fire","admin_user_id":"92222222-2222-4222-8222-222222222222"}'::jsonb) $$,
  'the creation is recorded');

-- One company per user; one company per name.
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', 'Other Co', 'co-first@rls.test') $$,
  'PT409', null, 'a user already in a company cannot be the admin of another');
select throws_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', 'ACME fire', 'co-second@rls.test') $$,
  '23505', null, 'a name already taken (whatever its case) is refused');
select throws_ok(
  $$ insert into public.company_members (user_id, company_id, role)
     select '92222222-2222-4222-8222-222222222222', id, 'member' from public.companies where name = 'Acme Fire' $$,
  '23505', null, 'the primary key allows one membership per user (FR9)');
select throws_ok(
  $$ insert into public.company_members (user_id, company_id, role)
     select '93333333-3333-4333-8333-333333333333', id, 'owner' from public.companies where name = 'Acme Fire' $$,
  '23514', null, 'only admin, member and viewer are roles');

select lives_ok(
  $$ select * from public.admin_create_company('91111111-1111-4111-8111-111111111111', 'Beta Sprinklers', 'co-second@rls.test') $$,
  'a second company is created');
insert into public.company_members (user_id, company_id, role)
select '94444444-4444-4444-8444-444444444444', id, 'member' from public.companies where name = 'Acme Fire';

-- Who reads what.
set local role authenticated;
set local request.jwt.claims = '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}';
select results_eq($$ select name from public.companies $$, $$ values ('Acme Fire') $$, 'a member reads their own company only');
select is((select count(*)::int from public.company_members), 2, 'and its members only');
select ok(
  (select app.fn_is_company_member(id) and app.fn_is_company_admin(id) from public.companies where name = 'Acme Fire'),
  'the helpers are true for the company admin');
select throws_ok(
  $$ update public.company_members set role = 'viewer' where user_id = '92222222-2222-4222-8222-222222222222' $$,
  '42501', null, 'a company admin cannot write memberships directly');

set local request.jwt.claims = '{"sub":"94444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.companies), 0, 'a pending member reads no company');
select is((select count(*)::int from public.company_members), 0, 'and no members');

set local request.jwt.claims = '{"sub":"95555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select count(*)::int from public.companies) + (select count(*)::int from public.company_members), 0,
  'a user in no company reads nothing');

set local request.jwt.claims = '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(
  (select count(*) from public.companies where name in ('Acme Fire', 'Beta Sprinklers')) = 2
  and (select count(*) from public.company_members m join public.companies c on c.id = m.company_id
        where c.name in ('Acme Fire', 'Beta Sprinklers')) = 3,
  'the platform admin reads every company and member');
reset role;

-- A non-admin member: member yes, admin no. Checked as that user.
update public.profiles set status = 'active' where id = '94444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claims = '{"sub":"94444444-4444-4444-8444-444444444444","role":"authenticated"}';
select ok(
  (select app.fn_is_company_member(id) and not app.fn_is_company_admin(id) from public.companies where name = 'Acme Fire'),
  'an active plain member is a member but not an admin');
reset role;

-- Deleting the account removes the membership; the company stays.
delete from auth.users where id = '94444444-4444-4444-8444-444444444444';
select is((select count(*)::int from public.company_members where user_id = '94444444-4444-4444-8444-444444444444'), 0,
  'a deleted account leaves no membership');
select is((select count(*)::int from public.companies where name = 'Acme Fire'), 1, 'and the company stays');

select * from finish();
rollback;
