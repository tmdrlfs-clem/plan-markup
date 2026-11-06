-- Story 7.1: RLS on public.tool_sets and public.tools (FR39): only the owner,
-- while active, can read or write their sets and tools; a tool goes only into
-- the caller's own set; never anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '81111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'tools-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '82222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'tools-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '83333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'tools-off@rls.test');
update public.profiles set status = 'active'
where id in ('81111111-1111-4111-8111-111111111111', '82222222-2222-4222-8222-222222222222', '83333333-3333-4333-8333-333333333333');

-- Fixtures as postgres: B's set with a tool; the deactivated user's set.
insert into public.tool_sets (id, owner_id, name, position)
values
  ('8bbbbbbb-0000-4000-8000-000000000001', '82222222-2222-4222-8222-222222222222', 'B tools', 1),
  ('8ccccccc-0000-4000-8000-000000000001', '83333333-3333-4333-8333-333333333333', 'Off tools', 1);
insert into public.tools (tool_set_id, owner_id, name, markup)
values ('8bbbbbbb-0000-4000-8000-000000000001', '82222222-2222-4222-8222-222222222222', 'Head', '{"type":"count"}');
update public.profiles set status = 'deactivated' where id = '83333333-3333-4333-8333-333333333333';

select ok(not has_table_privilege('anon', 'public.tool_sets', 'select'), 'anon has no SELECT on tool_sets');
select ok(not has_table_privilege('anon', 'public.tools', 'select'), 'anon has no SELECT on tools');
select throws_ok(
  $$ insert into public.tool_sets (owner_id, name) values ('82222222-2222-4222-8222-222222222222', '  ') $$,
  '23514', null, 'a set needs a name'
);
select throws_ok(
  $$ insert into public.tools (tool_set_id, owner_id, name, markup, asset_path)
     values ('8bbbbbbb-0000-4000-8000-000000000001', '82222222-2222-4222-8222-222222222222', 'X', '{}',
             '81111111-1111-4111-8111-111111111111/8bbbbbbb-0000-4000-8000-000000000001/x.png') $$,
  '23514', null, 'a tool asset is in its owner set folder'
);
select throws_ok(
  $$ insert into public.tools (tool_set_id, owner_id, name, markup)
     values ('8bbbbbbb-0000-4000-8000-000000000001', '82222222-2222-4222-8222-222222222222', 'X', '[]') $$,
  '23514', null, 'a tool markup is an object'
);

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.tool_sets), 0::bigint, 'A sees no other user sets');
select is((select count(*) from public.tools), 0::bigint, 'A sees no other user tools');
select lives_ok(
  $$ insert into public.tool_sets (id, name, position) values ('8aaaaaaa-0000-4000-8000-000000000001', 'Sprinkler', 1) $$,
  'A creates a set (owner defaults to A)'
);
select is(
  (select owner_id from public.tool_sets where id = '8aaaaaaa-0000-4000-8000-000000000001'),
  '81111111-1111-4111-8111-111111111111'::uuid,
  'the set is A own'
);
select lives_ok(
  $$ insert into public.tools (tool_set_id, name, markup) values ('8aaaaaaa-0000-4000-8000-000000000001', 'Pendant', '{"type":"count"}') $$,
  'A adds a tool to their set'
);
select throws_ok(
  $$ insert into public.tools (tool_set_id, name, markup) values ('8bbbbbbb-0000-4000-8000-000000000001', 'Sneak', '{"type":"count"}') $$,
  '42501', null, 'A cannot add a tool to the set of B'
);
select throws_ok(
  $$ insert into public.tool_sets (owner_id, name) values ('82222222-2222-4222-8222-222222222222', 'For B') $$,
  '42501', null, 'A cannot create a set for B'
);
select lives_ok(
  $$ update public.tool_sets set name = 'Sprinkler heads' where id = '8aaaaaaa-0000-4000-8000-000000000001' $$,
  'A renames their set'
);
update public.tool_sets set name = 'Taken' where id = '8bbbbbbb-0000-4000-8000-000000000001';
delete from public.tool_sets where id = '8bbbbbbb-0000-4000-8000-000000000001';
select throws_ok(
  $$ update public.tools set tool_set_id = '8bbbbbbb-0000-4000-8000-000000000001' where name = 'Pendant' $$,
  '42501', null, 'A cannot move a tool into the set of B'
);
select lives_ok(
  $$ delete from public.tool_sets where id = '8aaaaaaa-0000-4000-8000-000000000001' $$,
  'A deletes their set'
);
select is((select count(*) from public.tools), 0::bigint, 'deleting a set deletes its tools');

-- As the deactivated user.
set local request.jwt.claims = '{"sub":"83333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*) from public.tool_sets), 0::bigint, 'a deactivated user sees none of their sets');
select throws_ok(
  $$ insert into public.tool_sets (name) values ('New') $$,
  '42501', null, 'a deactivated user cannot create a set'
);

-- Back as postgres: the set and tool of B are untouched.
reset role;
select is((select name from public.tool_sets where id = '8bbbbbbb-0000-4000-8000-000000000001'), 'B tools', 'A could not rename or delete the set of B');
select is((select count(*) from public.tools where tool_set_id = '8bbbbbbb-0000-4000-8000-000000000001'), 1::bigint, 'the tool of B is still there');

select * from finish();
rollback;
