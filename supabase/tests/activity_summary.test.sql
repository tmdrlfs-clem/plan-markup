-- Story 10.9: public.activity_summary().
-- Rows are read by this test's own emails: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email, last_sign_in_at)
values
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'act-padmin@rls.test', null),
  ('00000000-0000-0000-0000-000000000000', 'd2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'act-boss@rls.test', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000000000', 'd3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'act-member@rls.test', null),
  ('00000000-0000-0000-0000-000000000000', 'd4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'act-solo@rls.test', null),
  ('00000000-0000-0000-0000-000000000000', 'd5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'act-other-boss@rls.test', null);
update public.profiles set status = 'active' where email like 'act-%@rls.test';
update public.profiles set is_platform_admin = true where id = 'd1111111-1111-4111-8111-111111111111';
select * from public.admin_create_company('d1111111-1111-4111-8111-111111111111', 'Activity Co rls', 'act-boss@rls.test');
select * from public.admin_create_company('d1111111-1111-4111-8111-111111111111', 'Activity Other rls', 'act-other-boss@rls.test');
insert into public.company_members (user_id, company_id, role)
select 'd3333333-3333-4333-8333-333333333333', id, 'member' from public.companies where name = 'Activity Co rls';

-- The member's markups: 2 this week, 1 last week, 1 three weeks ago, 1 older than four weeks.
insert into public.drawings (id, owner_id, title) values ('d3000000-0000-4000-8000-000000000001', 'd3333333-3333-4333-8333-333333333333', 'Secret title.pdf');
insert into public.drawing_files (id, drawing_id, sha256, page_count, filename)
values ('d3000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001', repeat('d', 64), 1, 'Secret client file.pdf');
insert into public.pages (id, drawing_file_id, index, crop_box, width, height)
values ('d3000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000002', 0, array[0, 0, 842, 595], 842, 595);

create temporary table w on commit drop as
select (date_trunc('week', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland') as w0;
grant select on w to authenticated;

insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, author_id, created_at)
select ('d3000000-0000-7000-8000-00000000000' || n)::uuid, 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003',
       'line', '{"points": []}', '{}', '{}', 'd3333333-3333-4333-8333-333333333333', at
from (values
  (1, (select w0 from w)),
  (2, (select w0 from w) + interval '1 second'),
  (3, (select w0 from w) - interval '1 second'),
  (4, (select w0 from w) - interval '20 days'),
  (5, (select w0 from w) - interval '60 days')
) v(n, at);

-- The member's events: 1 export this week, 2 exports two weeks ago, a print this week (not a PDF export)
-- and a Place heads run two weeks ago.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d3333333-3333-4333-8333-333333333333","role":"authenticated"}';
insert into public.activity_events (id, name, page_count, markup_count, kind) values
  ('d3e00000-0000-4000-8000-000000000001', 'markup.exported', 1, 1, 'editable'),
  ('d3e00000-0000-4000-8000-000000000002', 'markup.exported', 1, 1, 'flattened'),
  ('d3e00000-0000-4000-8000-000000000003', 'markup.exported', 1, 1, 'flattened'),
  ('d3e00000-0000-4000-8000-000000000004', 'drawing.printed', 1, 0, 'with_markups'),
  ('d3e00000-0000-4000-8000-000000000005', 'sprinkler.placed', 1, 12, 'all_zones');
reset role;
update public.activity_events set occurred_at = (select w0 from w) + interval '2 seconds' where id = 'd3e00000-0000-4000-8000-000000000001';
update public.activity_events set occurred_at = (select w0 from w) - interval '10 days'
 where id in ('d3e00000-0000-4000-8000-000000000002', 'd3e00000-0000-4000-8000-000000000003');
update public.activity_events set occurred_at = (select w0 from w) + interval '3 seconds' where id = 'd3e00000-0000-4000-8000-000000000004';
update public.activity_events set occurred_at = (select w0 from w) - interval '10 days' where id = 'd3e00000-0000-4000-8000-000000000005';

-- Privileges.
select ok(
  has_function_privilege('authenticated', 'public.activity_summary(text)', 'execute')
  and not has_function_privilege('anon', 'public.activity_summary(text)', 'execute'),
  'activity_summary is for signed-in users only');

-- The platform admin: everyone, with their company.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.activity_summary('platform') where email like 'act-%@rls.test'), 5,
  'the platform admin sees every account');
select results_eq(
  $$ select company_name, markups_total, markups_by_week, exports_total, exports_by_week
       from public.activity_summary('platform') where email = 'act-member@rls.test' $$,
  $$ values ('Activity Co rls', 5, array[2, 1, 0, 1], 3, array[1, 0, 2, 0]) $$,
  'markups are counted by author and week, exported PDFs by week, prints not at all');
select results_eq(
  $$ select active_days_by_week, drawings_by_week, prints_by_week, placements_by_week
       from public.activity_summary('platform') where email = 'act-member@rls.test' $$,
  $$ values (array[1, 1, 1, 1], array[1, 1, 0, 1], array[1, 0, 0, 0], array[0, 0, 1, 0]) $$,
  'days active, markup sets worked on, prints and Place heads runs are counted by week');
select is(
  (select last_active_at from public.activity_summary('platform') where email = 'act-member@rls.test'),
  (select w0 + interval '3 seconds' from w),
  'last active is the newest of markups, events (prints included) and sign-in');
select results_eq(
  $$ select company_name, markups_total, exports_total, markups_by_week, active_days_by_week, last_active_at is null
       from public.activity_summary('platform') where email = 'act-solo@rls.test' $$,
  $$ values (null::text, 0, 0, array[0, 0, 0, 0], array[0, 0, 0, 0], true) $$,
  'an account with no activity and no company has zeros and no last-active time');
select ok(
  (select last_active_at < now() - interval '39 days' from public.activity_summary('platform') where email = 'act-boss@rls.test'),
  'without markups or events, last active is the last sign-in');
select is(
  (select count(*)::int from public.activity_summary('company') where email like 'act-%@rls.test'), 0,
  'a platform admin who is no company admin gets nothing for the company scope');
select throws_ok($$ select * from public.activity_summary('everything') $$, '22023', null, 'an unknown scope is refused');
select ok(
  not exists (
    select 1 from public.activity_summary('platform') s
    where s::text like '%Secret%'
  ),
  'no drawing title or file name is in the result');

-- A company admin: their own company only.
set local request.jwt.claims = '{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select email, markups_total, exports_total from public.activity_summary('company') order by email $$,
  $$ values ('act-boss@rls.test', 0, 0), ('act-member@rls.test', 5, 3) $$,
  'a company admin sees the members of their own company');
select is((select count(*)::int from public.activity_summary('platform')), 0, 'and nothing for the platform scope');
set local request.jwt.claims = '{"sub":"d5555555-5555-4555-8555-555555555555","role":"authenticated"}';
select results_eq(
  $$ select email from public.activity_summary('company') $$, $$ values ('act-other-boss@rls.test') $$,
  'another company''s admin sees only their own company');

-- Everyone else: nothing.
set local request.jwt.claims = '{"sub":"d3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.activity_summary('company')) + (select count(*)::int from public.activity_summary('platform')),
  0, 'a plain member sees no activity');
set local request.jwt.claims = '{"sub":"d4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.activity_summary('company')) + (select count(*)::int from public.activity_summary('platform')),
  0, 'a user in no company sees no activity');
reset role;

-- A deactivated admin loses the view.
update public.profiles set status = 'deactivated' where id = 'd2222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.activity_summary('company')), 0, 'a deactivated company admin sees nothing');
reset role;
update public.profiles set status = 'deactivated' where id = 'd1111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.activity_summary('platform')), 0, 'a deactivated platform admin sees nothing');
reset role;

select * from finish();
rollback;
