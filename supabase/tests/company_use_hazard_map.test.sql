-- Story 10.12 (FR72): a company's own use → hazard mapping. Written only by
-- public.set_company_use_hazard_map(), audited; read by the company's members.
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'um-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'd2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'um-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'd3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'um-member@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'd5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'um-other-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'd6666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'um-nobody@rls.test');
update public.profiles set status = 'active' where email like 'um-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'd1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('d1111111-1111-4111-8111-111111111111', 'Map Co rls', 'um-boss@rls.test');
select * from public.admin_create_company('d1111111-1111-4111-8111-111111111111', 'Map Other rls', 'um-other-boss@rls.test');
insert into public.company_members (user_id, company_id, role)
values ('d3333333-3333-4333-8333-333333333333', (select id from public.companies where name = 'Map Co rls'), 'member');

create temporary table t on commit drop as
select (select id from public.companies where name = 'Map Co rls') as co,
       (select id from public.companies where name = 'Map Other rls') as other;
grant select on t to authenticated;

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.set_company_use_hazard_map(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.set_company_use_hazard_map(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'app.fn_company_use_hazard_map(uuid)', 'execute'),
  'users cannot call the mapping functions');
select ok(has_function_privilege('service_role', 'public.set_company_use_hazard_map(uuid, jsonb)', 'execute'), 'the server can');

-- Refusals: nothing is written and nothing is recorded.
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d3333333-3333-4333-8333-333333333333', '[{"use":"Office","hazard":"OH1","is_default":true}]') $$,
  'PT403', null, 'a member cannot change the mapping');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d6666666-6666-4666-8666-666666666666', '[{"use":"Office","hazard":"OH1","is_default":true}]') $$,
  'PT403', null, 'someone in no company cannot');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d1111111-1111-4111-8111-111111111111', '[{"use":"Office","hazard":"OH1","is_default":true}]') $$,
  'PT403', null, 'the platform admin cannot (they are in no company)');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', '[]') $$,
  '22023', null, 'a mapping needs a use');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', '{"use":"Office"}') $$,
  '22023', null, 'the uses are an array');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH1","is_default":false},{"use":"Lab","hazard":"OH3","is_default":false}]') $$,
  '22023', null, 'one use is the default');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH1","is_default":true},{"use":"Lab","hazard":"OH3","is_default":true}]') $$,
  '22023', null, 'only one use is the default');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', '[{"use":"Office","hazard":"OH1"}]') $$,
  '22023', null, 'each use says whether it is the default');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', '[{"use":"Office","hazard":"HH","is_default":true}]') $$,
  '23514', null, 'the hazard class is one of the four');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', '[{"use":"<b>","hazard":"OH1","is_default":true}]') $$,
  '23514', null, 'a use name follows the name rule');
select throws_ok(
  $$ select * from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH1","is_default":true},{"use":"OFFICE","hazard":"OH2","is_default":false}]') $$,
  '23505', null, 'a use is named once, whatever its case');
select is(
  (select count(*) from public.use_hazard_map where company_id in (select co from t union select other from t))
    + (select count(*) from public.audit_log where action like 'company.use_hazard_map_%' and target_id in (select co from t union select other from t)),
  0::bigint, 'refusals write and record nothing');

-- The first save.
select results_eq(
  $$ select changed, map_version from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH1","is_default":false},{"use":"Lab","hazard":"OH3","is_default":true}]') $$,
  $$ values (true, '1') $$, 'the admin saves the company mapping as version 1');
select results_eq(
  $$ select use, hazard, is_default, verified, map_version from public.use_hazard_map where company_id = (select co from t) order by use $$,
  $$ values ('Lab', 'OH3', true, true, '1'), ('Office', 'OH1', false, true, '1') $$, 'the rows are the mapping');
select is((select count(*)::int from public.use_hazard_map where company_id is null), 8, 'the platform default is untouched');
select results_eq(
  $$ select changed, map_version from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Lab","hazard":"OH3","is_default":true},{"use":"Office","hazard":"OH1","is_default":false}]') $$,
  $$ values (false, '1') $$, 'saving the same mapping again changes nothing');
select is(
  (select detail from public.audit_log where action = 'company.use_hazard_map_changed' and target_id = (select co from t)),
  '{"version":"1","from":null,"to":{"default":"Lab","uses":{"Lab":"OH3","Office":"OH1"}}}'::jsonb,
  'one change is recorded: what it was and what it is');

-- Who reads it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.use_hazard_map where company_id = (select co from t)), 2, 'a member reads their company mapping');
select is((select count(*)::int from public.use_hazard_map where company_id is null), 8, 'and the platform default');
update public.use_hazard_map set hazard = 'ELH' where company_id = (select co from t);
delete from public.use_hazard_map where company_id = (select co from t);
select throws_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard) values ((select co from t), '1', 'Sneak', 'ELH') $$,
  '42501', null, 'a member cannot add a row');
set local request.jwt.claims = '{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard) values ((select co from t), '1', 'Sneak', 'ELH') $$,
  '42501', null, 'the admin cannot write rows directly either');
set local request.jwt.claims = '{"sub":"d5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*)::int from public.use_hazard_map where company_id is not null), 0, 'another company reads none of it');
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
update public.use_hazard_map set hazard = 'ELH' where company_id = (select co from t);
select is(
  (select count(*)::int from public.use_hazard_map where company_id is not null), 0, 'the platform admin reads none of it');
reset role;
select is(
  (select count(*)::int from public.use_hazard_map where company_id = (select co from t) and hazard in ('OH1', 'OH3')), 2,
  'nobody changed the rows directly');

-- A change, then back to the platform default; a later mapping never reuses a version.
select results_eq(
  $$ select changed, map_version from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH2","is_default":true}]') $$,
  $$ values (true, '2') $$, 'a change is version 2');
select results_eq(
  $$ select changed, map_version from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222', null) $$,
  $$ values (true, null::text) $$, 'the admin goes back to the platform default');
select is(
  (select detail from public.audit_log where action = 'company.use_hazard_map_reset' and target_id = (select co from t)),
  '{"from":{"default":"Office","uses":{"Office":"OH2"}}}'::jsonb,
  'the reset is recorded with what was removed');
select results_eq(
  $$ select changed, map_version from public.set_company_use_hazard_map('d2222222-2222-4222-8222-222222222222',
       '[{"use":"Office","hazard":"OH1","is_default":true}]') $$,
  $$ values (true, '3') $$, 'the next mapping is version 3');

select * from finish();
rollback;
