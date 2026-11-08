-- Story 9.1: RLS on public.rule_figures and public.use_hazard_map (FR79):
-- active signed-in users read them; only the platform admin writes; never
-- anon; the seed is there; a company has one default use and each use once.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'rules-user@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b2222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'rules-admin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'b3333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'rules-pending@rls.test');
update public.profiles set status = 'active'
where id in ('b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222');
update public.profiles set is_platform_admin = true where id = 'b2222222-2222-4222-8222-222222222222';

select ok(not has_table_privilege('anon', 'public.rule_figures', 'select'), 'anon cannot read rule figures');
select ok(not has_table_privilege('anon', 'public.use_hazard_map', 'select'), 'anon cannot read the mapping');
select is((select count(*)::int from public.use_hazard_map where company_id is null), 8, 'the draft mapping is seeded');
select throws_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard) values (null, '1', 'OFFICE', 'OH1') $$,
  '23505', null, 'each use once per company (case-insensitive)'
);
select throws_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard, is_default) values (null, '1', 'Lab', 'OH1', true) $$,
  '23505', null, 'one default use per company'
);
select throws_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard) values (null, '1', 'Lab', 'HH') $$,
  '23514', null, 'only the known hazard classes'
);

-- An active user reads, never writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select verified from public.rule_figures where ruleset_id = 'nzs4541' and version = '1'), true, 'a user reads nzs4541 v1');
select is((select hazard from public.use_hazard_map where company_id is null and use = 'Kitchen'), 'OH1', 'a user reads the mapping');
select throws_ok(
  $$ insert into public.rule_figures (ruleset_id, version, verified, source, hazards)
     values ('nzs4541', '2', true, 'x', '{"ELH":{},"OH1":{},"OH2":{},"OH3":{}}') $$,
  '42501', null, 'a user cannot add a ruleset'
);
update public.use_hazard_map set hazard = 'OH3' where use = 'Office';
select is((select hazard from public.use_hazard_map where company_id is null and use = 'Office'), 'ELH', 'a user cannot change the mapping');

-- A pending user reads nothing.
set local request.jwt.claims = '{"sub":"b3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.rule_figures), 0, 'a pending user reads no rule figures');

-- The platform admin writes.
set local request.jwt.claims = '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ insert into public.use_hazard_map (company_id, map_version, use, hazard) values (null, '1', 'Laboratory', 'OH1') $$,
  'the platform admin adds a use'
);
select lives_ok(
  $$ update public.use_hazard_map set hazard = 'OH2' where company_id is null and use = 'Plant' $$,
  'the platform admin changes a use'
);
select is((select hazard from public.use_hazard_map where company_id is null and use = 'Plant'), 'OH2', 'the change is kept');

select * from finish();
rollback;
