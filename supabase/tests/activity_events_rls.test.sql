-- Story 8.4: RLS on public.activity_events (FR80): a user records their own
-- events (into their own markup set, or none), never as someone else and
-- never with a forged time; only the platform admin reads them; no updates
-- or deletes; never anon; no column can hold drawing content.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'events-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'events-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a3333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'events-admin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a4444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'events-off@rls.test');
update public.profiles set status = 'active'
where id in ('a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222',
             'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444');
update public.profiles set is_platform_admin = true where id = 'a3333333-3333-4333-8333-333333333333';
update public.profiles set status = 'deactivated' where id = 'a4444444-4444-4444-8444-444444444444';

insert into public.drawings (id, owner_id, title)
values
  ('ad000000-0000-4000-8000-00000000000a', 'a1111111-1111-4111-8111-111111111111', 'A set'),
  ('ad000000-0000-4000-8000-00000000000b', 'a2222222-2222-4222-8222-222222222222', 'B set');

select ok(not has_table_privilege('anon', 'public.activity_events', 'insert'), 'anon cannot insert events');
select ok(not has_table_privilege('anon', 'public.activity_events', 'select'), 'anon cannot read events');
select ok(not has_table_privilege('authenticated', 'public.activity_events', 'update'), 'no UPDATE for users');
select ok(not has_table_privilege('authenticated', 'public.activity_events', 'delete'), 'no DELETE for users');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'activity_events'
     and data_type in ('text', 'jsonb', 'json', 'character varying') and column_name not in ('name', 'kind')),
  0, 'no free text or JSON column (no room for drawing content)'
);

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ insert into public.activity_events (name, drawing_id, page_count, markup_count, kind, occurred_at)
     values ('markup.exported', 'ad000000-0000-4000-8000-00000000000a', 2, 5, 'editable', '2000-01-01') $$,
  'A records an export of their own markup set'
);
select lives_ok(
  $$ insert into public.activity_events (name, page_count, kind) values ('drawing.printed', 1, 'without_markups') $$,
  'A records a print without a markup set'
);
select throws_ok(
  $$ insert into public.activity_events (name, drawing_id, page_count, kind)
     values ('markup.exported', 'ad000000-0000-4000-8000-00000000000b', 1, 'editable') $$,
  '42501', null, 'not into another user markup set'
);
select throws_ok(
  $$ insert into public.activity_events (user_id, name, page_count, kind)
     values ('a2222222-2222-4222-8222-222222222222', 'drawing.printed', 1, 'with_markups') $$,
  '42501', null, 'not as another user'
);
select throws_ok(
  $$ insert into public.activity_events (name, page_count, kind) values ('drawing.opened', 1, 'editable') $$,
  '23514', null, 'only the known event names'
);
select throws_ok(
  $$ insert into public.activity_events (name, page_count, kind) values ('drawing.printed', 1, 'flattened') $$,
  '23514', null, 'the kind matches the event'
);
select throws_ok(
  $$ insert into public.activity_events (name, page_count, kind) values ('markup.exported', 0, 'editable') $$,
  '23514', null, 'at least one page'
);
select is((select count(*)::int from public.activity_events), 0, 'A cannot read events (not the platform admin)');

-- The deactivated user records nothing.
set local request.jwt.claims = '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ insert into public.activity_events (name, page_count, kind) values ('drawing.printed', 1, 'with_markups') $$,
  '42501', null, 'a deactivated user records nothing'
);

-- The platform admin reads every event, with the server time.
set local request.jwt.claims = '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.activity_events where user_id = 'a1111111-1111-4111-8111-111111111111'), 2, 'the platform admin reads another user events');
select ok(
  (select bool_and(occurred_at > now() - interval '1 hour') from public.activity_events where user_id = 'a1111111-1111-4111-8111-111111111111'),
  'the time is the server time, not the one sent'
);

reset role;
select is(
  (select count(*)::int from public.activity_events
   where drawing_id = 'ad000000-0000-4000-8000-00000000000a' and page_count = 2 and markup_count = 5),
  1, 'the export row keeps the markup set and counts'
);

select * from finish();
rollback;
