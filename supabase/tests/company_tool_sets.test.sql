-- Story 10.11 (FR44): company tool sets. A published set, its tools and their
-- images are read by the company's active members and by nobody else; only
-- its owner writes them; only public.set_tool_set_published() publishes.
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'c1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'ct-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'ct-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'ct-member@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'ct-viewer@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'ct-other-boss@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c6666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'ct-nobody@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'c7777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'ct-off@rls.test');
update public.profiles set status = 'active' where email like 'ct-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'c1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('c1111111-1111-4111-8111-111111111111', 'Tools Co rls', 'ct-boss@rls.test');
select * from public.admin_create_company('c1111111-1111-4111-8111-111111111111', 'Tools Other rls', 'ct-other-boss@rls.test');
insert into public.company_members (user_id, company_id, role)
select u, (select id from public.companies where name = 'Tools Co rls'), r
from (values
  ('c3333333-3333-4333-8333-333333333333'::uuid, 'member'),
  ('c4444444-4444-4444-8444-444444444444'::uuid, 'viewer'),
  ('c7777777-7777-4777-8777-777777777777'::uuid, 'member')) v(u, r);
update public.profiles set status = 'deactivated' where id = 'c7777777-7777-4777-8777-777777777777';

create temporary table t on commit drop as
select (select id from public.companies where name = 'Tools Co rls') as co,
       (select id from public.companies where name = 'Tools Other rls') as other;
grant select on t to authenticated;

-- The boss owns two sets (one with a tool and its image); the member owns one.
insert into public.tool_sets (id, owner_id, name, position)
values
  ('caaaaaaa-0000-4000-8000-000000000001', 'c2222222-2222-4222-8222-222222222222', 'Company symbols', 1),
  ('caaaaaaa-0000-4000-8000-000000000002', 'c2222222-2222-4222-8222-222222222222', 'Boss private', 2),
  ('cbbbbbbb-0000-4000-8000-000000000001', 'c3333333-3333-4333-8333-333333333333', 'Member own', 1);
insert into public.tools (id, tool_set_id, owner_id, name, markup)
values
  ('caaaaaaa-1111-4000-8000-000000000001', 'caaaaaaa-0000-4000-8000-000000000001', 'c2222222-2222-4222-8222-222222222222', 'Pendant', '{"type":"count"}'),
  ('caaaaaaa-1111-4000-8000-000000000002', 'caaaaaaa-0000-4000-8000-000000000002', 'c2222222-2222-4222-8222-222222222222', 'Secret', '{"type":"count"}');
insert into storage.objects (bucket_id, name, owner_id)
values
  ('tool-assets', 'c2222222-2222-4222-8222-222222222222/caaaaaaa-0000-4000-8000-000000000001/t.png', 'c2222222-2222-4222-8222-222222222222'),
  ('tool-assets', 'c2222222-2222-4222-8222-222222222222/caaaaaaa-0000-4000-8000-000000000002/s.png', 'c2222222-2222-4222-8222-222222222222');

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.set_tool_set_published(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.set_tool_set_published(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'app.fn_reads_company_tool_asset_path(text)', 'execute'),
  'users cannot call the publish function');
select ok(has_function_privilege('service_role', 'public.set_tool_set_published(uuid, uuid, boolean)', 'execute'), 'the server can');
select ok(
  not has_column_privilege('authenticated', 'public.tool_sets', 'company_id', 'update')
  and not has_column_privilege('authenticated', 'public.tool_sets', 'company_id', 'insert'),
  'users cannot write company_id');
select ok(
  has_column_privilege('authenticated', 'public.tool_sets', 'name', 'update')
  and has_column_privilege('authenticated', 'public.tool_sets', 'position', 'update')
  and has_column_privilege('authenticated', 'public.tool_sets', 'name', 'insert'),
  'users still write a set name and position');

-- Refusals: nothing is published and nothing is recorded.
select throws_ok(
  $$ select * from public.set_tool_set_published('c3333333-3333-4333-8333-333333333333', 'cbbbbbbb-0000-4000-8000-000000000001', true) $$,
  'PT403', null, 'a member cannot publish');
select throws_ok(
  $$ select * from public.set_tool_set_published('c6666666-6666-4666-8666-666666666666', 'caaaaaaa-0000-4000-8000-000000000001', true) $$,
  'PT403', null, 'someone in no company cannot publish');
select throws_ok(
  $$ select * from public.set_tool_set_published('c5555555-5555-4555-8555-555555555555', 'caaaaaaa-0000-4000-8000-000000000001', true) $$,
  'PT404', null, 'an admin cannot publish the set of someone else');
select throws_ok(
  $$ select * from public.set_tool_set_published('c2222222-2222-4222-8222-222222222222', null, true) $$,
  '22023', null, 'a tool set is required');
select is(
  (select count(*) from public.audit_log where action like 'company.tool_set_%' and target_id in (select co from t union select other from t)),
  0::bigint, 'refusals record nothing');

-- Before publishing: the member sees their own set only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*) from public.tool_sets where id::text like 'caaaaaaa-%'), 0::bigint, 'a member sees no unpublished set of the admin');
reset role;

-- Publish.
select is(
  (select changed from public.set_tool_set_published('c2222222-2222-4222-8222-222222222222', 'caaaaaaa-0000-4000-8000-000000000001', true)),
  true, 'the admin publishes their set');
select is(
  (select company_id from public.tool_sets where id = 'caaaaaaa-0000-4000-8000-000000000001'),
  (select co from t), 'the set names the company');
select is(
  (select changed from public.set_tool_set_published('c2222222-2222-4222-8222-222222222222', 'caaaaaaa-0000-4000-8000-000000000001', true)),
  false, 'publishing again changes nothing');
select is(
  (select array_agg(detail ->> 'name') from public.audit_log
    where action = 'company.tool_set_published' and target_id = (select co from t) and actor_id = 'c2222222-2222-4222-8222-222222222222'),
  array['Company symbols'], 'one publication is recorded, with the set name');

-- A member uses the set: reads it, its tools and their images; writes nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select array_agg(name order by name) from public.tool_sets),
  array['Company symbols', 'Member own'], 'a member sees the published set and their own, not the unpublished one');
select is((select array_agg(name) from public.tools), array['Pendant'], 'a member sees the tools of the published set only');
select is(
  (select array_agg(name) from storage.objects where bucket_id = 'tool-assets'),
  array['c2222222-2222-4222-8222-222222222222/caaaaaaa-0000-4000-8000-000000000001/t.png'],
  'a member reads the images of the published set only');
update public.tool_sets set name = 'Renamed by member' where id = 'caaaaaaa-0000-4000-8000-000000000001';
delete from public.tool_sets where id = 'caaaaaaa-0000-4000-8000-000000000001';
update public.tools set name = 'Renamed by member' where id = 'caaaaaaa-1111-4000-8000-000000000001';
delete from public.tools where id = 'caaaaaaa-1111-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.tools (tool_set_id, name, markup) values ('caaaaaaa-0000-4000-8000-000000000001', 'Sneak', '{"type":"count"}') $$,
  '42501', null, 'a member cannot add a tool to the company set');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tool-assets', 'c2222222-2222-4222-8222-222222222222/caaaaaaa-0000-4000-8000-000000000001/x.png', 'c3333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'a member cannot upload into the company set');
select throws_ok(
  $$ update public.tool_sets set company_id = (select co from t) where id = 'cbbbbbbb-0000-4000-8000-000000000001' $$,
  '42501', null, 'a member cannot publish by writing company_id');
select throws_ok(
  $$ insert into public.tool_sets (name, company_id) values ('Sneak', (select co from t)) $$,
  '42501', null, 'a member cannot create a published set');

-- A viewer reads it too.
set local request.jwt.claims = '{"sub":"c4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select array_agg(name) from public.tool_sets), array['Company symbols'], 'a viewer sees the published set');

-- Non-members read nothing: another company's admin, someone in no company,
-- the platform admin, a deactivated member.
set local request.jwt.claims = '{"sub":"c5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*) from public.tool_sets) + (select count(*) from public.tools)
    + (select count(*) from storage.objects where bucket_id = 'tool-assets'),
  0::bigint, 'an admin of another company reads nothing of it');
set local request.jwt.claims = '{"sub":"c6666666-6666-4666-8666-666666666666","role":"authenticated"}';
select is(
  (select count(*) from public.tool_sets) + (select count(*) from public.tools)
    + (select count(*) from storage.objects where bucket_id = 'tool-assets'),
  0::bigint, 'someone in no company reads nothing of it');
set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*) from public.tool_sets where id::text like 'caaaaaaa-%') + (select count(*) from public.tools where id::text like 'caaaaaaa-%'),
  0::bigint, 'the platform admin reads nothing of it');
set local request.jwt.claims = '{"sub":"c7777777-7777-4777-8777-777777777777","role":"authenticated"}';
select is(
  (select count(*) from public.tool_sets) + (select count(*) from public.tools),
  0::bigint, 'a deactivated member reads nothing');

-- The owner still writes their published set.
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ update public.tool_sets set name = 'Company symbols v2' where id = 'caaaaaaa-0000-4000-8000-000000000001' $$,
  'the owner renames the published set');
select lives_ok(
  $$ insert into public.tools (tool_set_id, name, markup) values ('caaaaaaa-0000-4000-8000-000000000001', 'Upright', '{"type":"count"}') $$,
  'the owner adds a tool to the published set');
select throws_ok(
  $$ update public.tool_sets set company_id = (select other from t) where id = 'caaaaaaa-0000-4000-8000-000000000001' $$,
  '42501', null, 'the owner cannot write company_id either');
reset role;

select is(
  (select name from public.tool_sets where id = 'caaaaaaa-0000-4000-8000-000000000001'),
  'Company symbols v2', 'the member could not rename or delete the company set');
select is(
  (select count(*) from public.tools where tool_set_id = 'caaaaaaa-0000-4000-8000-000000000001'),
  2::bigint, 'the member could not rename or delete its tools');

-- Withdraw.
select is(
  (select changed from public.set_tool_set_published('c2222222-2222-4222-8222-222222222222', 'caaaaaaa-0000-4000-8000-000000000001', false)),
  true, 'the admin withdraws the set');
select is(
  (select count(*) from public.audit_log where action = 'company.tool_set_withdrawn' and target_id = (select co from t)),
  1::bigint, 'the withdrawal is recorded');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select array_agg(name) from public.tool_sets), array['Member own'], 'a member no longer sees the withdrawn set');
reset role;

-- A set is withdrawn when its owner stops being an admin of the company.
insert into public.company_members (user_id, company_id, role)
values ('c6666666-6666-4666-8666-666666666666', (select co from t), 'admin');
insert into public.tool_sets (id, owner_id, name)
values ('cccccccc-0000-4000-8000-000000000001', 'c6666666-6666-4666-8666-666666666666', 'Second admin set');
select public.set_tool_set_published('c6666666-6666-4666-8666-666666666666', 'cccccccc-0000-4000-8000-000000000001', true);
select public.set_tool_set_published('c2222222-2222-4222-8222-222222222222', 'caaaaaaa-0000-4000-8000-000000000001', true);
select public.set_company_member_role('c2222222-2222-4222-8222-222222222222', 'c6666666-6666-4666-8666-666666666666', 'member');
select is(
  (select company_id from public.tool_sets where id = 'cccccccc-0000-4000-8000-000000000001'),
  null, 'a demoted admin''s set is withdrawn');
select public.set_company_member_role('c2222222-2222-4222-8222-222222222222', 'c6666666-6666-4666-8666-666666666666', 'admin');
select public.remove_company_member('c6666666-6666-4666-8666-666666666666', 'c2222222-2222-4222-8222-222222222222');
select is(
  (select company_id from public.tool_sets where id = 'caaaaaaa-0000-4000-8000-000000000001'),
  null, 'a removed admin''s set is withdrawn, and stays theirs');

select * from finish();
rollback;
