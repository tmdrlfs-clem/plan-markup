-- Story 9.8: RLS on public.zone_layouts (placement runs): the markup set's
-- owner saves and reads its runs; nobody else; never anon; never updated or
-- deleted by users; the author and time are the server's. Also the
-- sprinkler.placed activity event.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '9c111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'zl-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '9d222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'zl-b@rls.test');
update public.profiles set status = 'active'
where id in ('9c111111-1111-4111-8111-111111111111', '9d222222-2222-4222-8222-222222222222');

insert into public.drawings (id, owner_id, title) values
  ('ac000000-0000-4000-8000-000000000001', '9c111111-1111-4111-8111-111111111111', 'A.pdf'),
  ('bd000000-0000-4000-8000-000000000001', '9d222222-2222-4222-8222-222222222222', 'B.pdf');

create function pg_temp.layout(p_drawing uuid, p_by uuid default null)
returns void language sql as $$
  insert into public.zone_layouts (drawing_id, zone_id, ruleset_id, rule_figure_version, status, head_count, inputs, result, report, created_by)
  values (p_drawing, 'ac000000-0000-7000-8000-00000000000a', 'nzs4541', '1', 'placed', 4,
          '{"zoneId": "z"}', '{"ok": true, "heads": []}', '{"pass": true}', coalesce(p_by, auth.uid()));
$$;

select ok(not has_table_privilege('anon', 'public.zone_layouts', 'select'), 'anon cannot read layouts');
select ok(not has_table_privilege('anon', 'public.zone_layouts', 'insert'), 'anon cannot save layouts');
select ok(not has_table_privilege('authenticated', 'public.zone_layouts', 'update'), 'layouts are never updated');
select ok(not has_table_privilege('authenticated', 'public.zone_layouts', 'delete'), 'layouts are never deleted by users');

set local role authenticated;
set local request.jwt.claims = '{"sub":"9c111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok($$ select pg_temp.layout('ac000000-0000-4000-8000-000000000001') $$, 'A saves a run on A''s markup set');
select is(
  (select rule_figure_version || ':' || status || ':' || head_count from public.zone_layouts),
  '1:placed:4', 'A reads the run with its ruleset version');
select ok((select created_at > now() - interval '1 minute' from public.zone_layouts), 'the time is the server''s');
select throws_ok(
  $$ select pg_temp.layout('bd000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'A cannot save a run on B''s markup set');
select throws_ok(
  $$ select pg_temp.layout('ac000000-0000-4000-8000-000000000001', '9d222222-2222-4222-8222-222222222222') $$,
  '42501', null, 'A cannot save a run as B');
select throws_ok(
  $$ insert into public.zone_layouts (drawing_id, zone_id, ruleset_id, rule_figure_version, status, inputs, result)
     values ('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-7000-8000-00000000000a', 'nzs4541', '1', 'done', '{}', '{}') $$,
  '23514', null, 'only the known statuses');

set local request.jwt.claims = '{"sub":"9d222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*) from public.zone_layouts), 0::bigint, 'B sees none of A''s runs');

-- sprinkler.placed activity event
select lives_ok(
  $$ insert into public.activity_events (name, drawing_id, page_count, markup_count, kind)
     values ('sprinkler.placed', 'bd000000-0000-4000-8000-000000000001', 1, 12, 'all_zones') $$,
  'B records sprinkler.placed');
select throws_ok(
  $$ insert into public.activity_events (name, drawing_id, page_count, markup_count, kind)
     values ('sprinkler.placed', null, 1, 12, 'editable') $$,
  '23514', null, 'sprinkler.placed takes only its own kinds');

select * from finish();
rollback;
