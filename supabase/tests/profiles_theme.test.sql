-- profiles.theme (Story 3.8): default, allowed values, and that a user can
-- change only their own theme (column grant + profiles_update_self).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '61111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'theme-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '62222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'theme-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '63333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'theme-pending@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '64444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'theme-off@rls.test');
update public.profiles set status = 'deactivated' where id = '64444444-4444-4444-8444-444444444444';
update public.profiles set status = 'active'
where id in ('61111111-1111-4111-8111-111111111111', '62222222-2222-4222-8222-222222222222');

select col_not_null('public', 'profiles', 'theme', 'theme is not null');
select col_default_is('public', 'profiles', 'theme', 'blueprint', 'theme defaults to blueprint');
select is(
  (select theme from public.profiles where id = '61111111-1111-4111-8111-111111111111'),
  'blueprint',
  'a new user''s profile has the blueprint theme'
);
select throws_ok(
  $$ update public.profiles set theme = 'neon' where id = '61111111-1111-4111-8111-111111111111' $$,
  '23514', null,
  'the check constraint rejects an unknown theme'
);
select throws_ok(
  $$ update public.profiles set theme = null where id = '61111111-1111-4111-8111-111111111111' $$,
  '23502', null,
  'theme cannot be null'
);

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"61111111-1111-4111-8111-111111111111","role":"authenticated"}';

select results_eq(
  $$ with u as (update public.profiles set theme = 'daylight'
       where id = '61111111-1111-4111-8111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'user A changes their own theme'
);
select results_eq(
  $$ with u as (update public.profiles set theme = 'contrast'
       where id = '62222222-2222-4222-8222-222222222222' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'user A''s update of user B''s theme changes 0 rows'
);
select throws_ok(
  $$ update public.profiles set theme = 'contrast', status = 'active'
     where id = '61111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'a theme update cannot carry another column (status)'
);
select is(
  (select theme from public.profiles where id = '61111111-1111-4111-8111-111111111111'),
  'daylight',
  'user A reads their new theme'
);

-- Review T1: pending and deactivated users update nothing, not even their own row.
set local request.jwt.claims = '{"sub":"63333333-3333-4333-8333-333333333333","role":"authenticated"}';
select results_eq(
  $$ with u as (update public.profiles set theme = 'contrast'
       where id = '63333333-3333-4333-8333-333333333333' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'a pending user cannot change their own theme'
);
set local request.jwt.claims = '{"sub":"64444444-4444-4444-8444-444444444444","role":"authenticated"}';
select results_eq(
  $$ with u as (update public.profiles set name = 'still here', theme = 'contrast'
       where id = '64444444-4444-4444-8444-444444444444' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'a deactivated user cannot change their own theme or name'
);

-- As anon.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ update public.profiles set theme = 'contrast' where id = '62222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  'anon cannot change any theme'
);

reset role;
select is(
  (select theme from public.profiles where id = '62222222-2222-4222-8222-222222222222'),
  'blueprint',
  'user B''s theme is unchanged'
);
select results_eq(
  $$ select theme, name from public.profiles where id in ('63333333-3333-4333-8333-333333333333', '64444444-4444-4444-8444-444444444444') order by id $$,
  $$ values ('blueprint'::text, ''::text), ('blueprint'::text, ''::text) $$,
  'the pending and deactivated profiles are unchanged'
);

select * from finish();
rollback;
