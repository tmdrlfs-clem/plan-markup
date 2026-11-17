-- Story 10.13 (FR79, A7, NFR34): the platform admin maintains the rule figures
-- and the platform default mapping through four audited functions.
-- Versions are read relative to what the database holds: a local database may
-- hold drafts from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'e1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'rf-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'e2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'rf-user@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'e3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'rf-off-admin@rls.test');
update public.profiles set status = 'active' where id in ('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222');
update public.profiles set is_platform_admin = true where id in ('e1111111-1111-4111-8111-111111111111', 'e3333333-3333-4333-8333-333333333333');

create temporary table t on commit drop as
select (select max(version::integer) from public.rule_figures where ruleset_id = 'nzs4541') as v0,
       (select max(map_version::integer) from public.use_hazard_map where company_id is null) as m0,
       (select count(*)::integer from public.rule_figures) as rows0,
       '{"ELH":{"Amax":20,"Smax":4.5,"Smin":1.8,"Wmax":2.25,"Wmin":0.05},
         "OH1":{"Amax":12,"Smax":4.0,"Smin":1.8,"Wmax":2.0,"Wmin":0.05},
         "OH2":{"Amax":12,"Smax":4.0,"Smin":1.8,"Wmax":2.0,"Wmin":0.05},
         "OH3":{"Amax":11.5,"Smax":4.0,"Smin":1.8,"Wmax":2.0,"Wmin":0.05}}'::jsonb as h;
grant select on t to authenticated;

create function pg_temp.audits(p_action text) returns integer language sql as $$
  select count(*)::integer from public.audit_log where action = p_action and actor_id = 'e1111111-1111-4111-8111-111111111111';
$$;

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.admin_create_rule_figures(uuid, text, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_verify_rule_figures(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_set_default_use_hazard_map(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_verify_default_use_hazard_map(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_create_rule_figures(uuid, text, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.fn_require_platform_admin(uuid)', 'execute'),
  'users cannot call the rule functions');
select ok(
  has_function_privilege('service_role', 'public.admin_create_rule_figures(uuid, text, jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_verify_rule_figures(uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.admin_set_default_use_hazard_map(uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.admin_verify_default_use_hazard_map(uuid, text)', 'execute'),
  'the server can');
select ok(
  not has_table_privilege('authenticated', 'public.rule_figures', 'insert')
  and not has_table_privilege('authenticated', 'public.rule_figures', 'update')
  and not has_table_privilege('authenticated', 'public.rule_figures', 'delete')
  and not has_table_privilege('authenticated', 'public.use_hazard_map', 'insert')
  and not has_table_privilege('authenticated', 'public.use_hazard_map', 'update')
  and not has_table_privilege('authenticated', 'public.use_hazard_map', 'delete'),
  'nobody writes either table directly');

-- Rule figures: refusals write and record nothing.
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e2222222-2222-4222-8222-222222222222', 'nzs4541', (select h from t), 'A correction') $$,
  'PT403', null, 'a user cannot add a version');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e3333333-3333-4333-8333-333333333333', 'nzs4541', (select h from t), 'A correction') $$,
  'PT403', null, 'an admin who is not active cannot');
select throws_ok(
  $$ select * from public.admin_create_rule_figures(null, 'nzs4541', (select h from t), 'A correction') $$,
  '22023', null, 'an actor is required');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'bs9251', (select h from t), 'A correction') $$,
  'PT404', null, 'the ruleset must exist');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select h - 'OH3' from t), 'A correction') $$,
  '22023', null, 'every hazard class is needed');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select h || '{"HH":{}}' from t), 'A correction') $$,
  '22023', null, 'and no other class');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{ELH,Amax}', '"21"') from t), 'A correction') $$,
  '22023', null, 'a figure is a number');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{ELH,Amax}', '0') from t), 'A correction') $$,
  '22023', null, 'above zero');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{ELH,Smax}', '51') from t), 'A correction') $$,
  '22023', null, 'and within its range');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{OH1,Smin}', '4.0') from t), 'A correction') $$,
  '22023', null, 'the minimum spacing is below the maximum');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{OH1,extra}', '1') from t), 'A correction') $$,
  '22023', null, 'no other figure');
select throws_ok(
  $$ select * from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select h from t), '   ') $$,
  '22023', null, 'the source is needed');
select is((select count(*)::integer from public.rule_figures), (select rows0 from t), 'no refusal added a version');
select is(pg_temp.audits('rules.figures_created'), 0, 'or recorded one');

-- A draft: the next version, unverified, with the tables carried over.
select results_eq(
  $$ select changed, version from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select h from t), '  Clause 5 correction  ') $$,
  $$ select true, (v0 + 1)::text from t $$,
  'the admin adds the next version');
select results_eq(
  $$ select f.verified, f.source, f.hazards = (select h from t), f.created_by, f.verified_at is null,
            f.tables = (select p.tables from public.rule_figures p where p.ruleset_id = 'nzs4541' and p.version = (select v0::text from t))
     from public.rule_figures f where f.ruleset_id = 'nzs4541' and f.version = (select (v0 + 1)::text from t) $$,
  $$ values (false, 'Clause 5 correction', true, 'e1111111-1111-4111-8111-111111111111'::uuid, true, true) $$,
  'it is a draft with the given figures, the trimmed source and the earlier tables');
select results_eq(
  $$ select a.target_type, a.target_id = (select id from public.rule_figures where ruleset_id = 'nzs4541' and version = (select (v0 + 1)::text from t)),
            a.detail ->> 'version', a.detail ->> 'from_version', a.detail -> 'to' = (select h from t), a.detail ? 'from'
     from public.audit_log a where a.action = 'rules.figures_created' and a.actor_id = 'e1111111-1111-4111-8111-111111111111' $$,
  $$ select 'rule_figures', true, (v0 + 1)::text, v0::text, true, true from t $$,
  'the audit row holds the figures before and after');
select results_eq(
  $$ select changed, version from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select h from t), 'Said again') $$,
  $$ select false, (v0 + 1)::text from t $$,
  'the same figures again add nothing');
select is(pg_temp.audits('rules.figures_created'), 1, 'and record nothing');

-- A second draft replaces the first: only the newest version can be confirmed.
select results_eq(
  $$ select changed, version from public.admin_create_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select jsonb_set(h, '{ELH,Amax}', '20.5') from t), 'Clause 5, second reading') $$,
  $$ select true, (v0 + 2)::text from t $$,
  'a second edit adds another version');
select throws_ok(
  $$ select * from public.admin_verify_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select (v0 + 1)::text from t)) $$,
  'PT409', null, 'the replaced draft cannot be confirmed');
select throws_ok(
  $$ select * from public.admin_verify_rule_figures('e2222222-2222-4222-8222-222222222222', 'nzs4541', (select (v0 + 2)::text from t)) $$,
  'PT403', null, 'a user cannot confirm');
select throws_ok(
  $$ select * from public.admin_verify_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', '999999') $$,
  'PT404', null, 'the version must exist');
select results_eq(
  $$ select changed from public.admin_verify_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select (v0 + 2)::text from t)) $$,
  $$ values (true) $$,
  'the admin confirms the newest version');
select results_eq(
  $$ select f.verified, f.verified_by, f.verified_at is not null from public.rule_figures f
     where f.ruleset_id = 'nzs4541' and f.version = (select (v0 + 2)::text from t) $$,
  $$ values (true, 'e1111111-1111-4111-8111-111111111111'::uuid, true) $$,
  'it is verified, by whom and when');
select results_eq(
  $$ select changed from public.admin_verify_rule_figures('e1111111-1111-4111-8111-111111111111', 'nzs4541', (select (v0 + 2)::text from t)) $$,
  $$ values (false) $$,
  'confirming again changes nothing');
select is(pg_temp.audits('rules.figures_verified'), 1, 'one confirmation is recorded');
select results_eq(
  $$ select f.verified, f.hazards -> 'ELH' ->> 'Amax' from public.rule_figures f where f.ruleset_id = 'nzs4541' and f.version = '1' $$,
  $$ values (true, '21') $$,
  'version 1 stays as it was');

-- The platform default mapping.
select throws_ok(
  $$ select * from public.admin_set_default_use_hazard_map('e2222222-2222-4222-8222-222222222222', '[{"use":"Office","hazard":"OH1","is_default":true}]') $$,
  'PT403', null, 'a user cannot change the default mapping');
select throws_ok(
  $$ select * from public.admin_set_default_use_hazard_map('e1111111-1111-4111-8111-111111111111',
       '[{"use":"Office","hazard":"OH1","is_default":false},{"use":"Lab","hazard":"OH3","is_default":false}]') $$,
  '22023', null, 'one use is the default');
select throws_ok(
  $$ select * from public.admin_set_default_use_hazard_map('e1111111-1111-4111-8111-111111111111',
       '[{"use":"Office","hazard":"OH1","is_default":true},{"use":"office","hazard":"OH3","is_default":false}]') $$,
  '23505', null, 'each use once');
select throws_ok(
  $$ select * from public.admin_set_default_use_hazard_map('e1111111-1111-4111-8111-111111111111', '[{"use":"Office","hazard":"HH","is_default":true}]') $$,
  '23514', null, 'only the known hazard classes');
select is(pg_temp.audits('rules.use_hazard_map_changed'), 0, 'no refusal is recorded');
select results_eq(
  $$ select changed, map_version::integer > (select m0 from t) from public.admin_set_default_use_hazard_map('e1111111-1111-4111-8111-111111111111',
       '[{"use":"Office","hazard":"ELH","is_default":false},{"use":"Laboratory","hazard":"OH3","is_default":true}]') $$,
  $$ values (true, true) $$,
  'the admin replaces the default mapping with a later version');
select results_eq(
  $$ select m.use, m.hazard, m.is_default, m.verified from public.use_hazard_map m where m.company_id is null order by m.use $$,
  $$ values ('Laboratory', 'OH3', true, false), ('Office', 'ELH', false, false) $$,
  'the new mapping is a draft');
select throws_ok(
  $$ select * from public.admin_verify_default_use_hazard_map('e1111111-1111-4111-8111-111111111111', (select m0::text from t)) $$,
  'PT409', null, 'a mapping that has changed since is not confirmed');
select results_eq(
  $$ select changed from public.admin_verify_default_use_hazard_map('e1111111-1111-4111-8111-111111111111',
       (select max(map_version) from public.use_hazard_map where company_id is null)) $$,
  $$ values (true) $$,
  'the admin confirms the mapping in place');
select results_eq(
  $$ select bool_and(m.verified), pg_temp.audits('rules.use_hazard_map_changed'), pg_temp.audits('rules.use_hazard_map_verified')
     from public.use_hazard_map m where m.company_id is null $$,
  $$ values (true, 1, 1) $$,
  'it is verified, and both changes are recorded');

select * from finish();
rollback;
