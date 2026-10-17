-- RLS and privilege tests for public.profiles and app helpers (NFR20).
-- Self-contained: creates its own users inside the transaction (no seed dependency).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). The trigger creates the profiles.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'a@rls.test', '{"name":"User A"}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'b@rls.test', '{"name":"User B"}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'admin@rls.test', '{}');

-- Trigger: pending profile with the auth email and metadata name.
select results_eq(
  $$ select status, email, name, is_platform_admin from public.profiles
     where id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('pending'::text, 'a@rls.test'::text, 'User A'::text, false) $$,
  'new-user trigger creates a pending, non-admin profile with the auth email'
);
select is(
  (select name from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  '',
  'new-user trigger defaults name to empty string when metadata has none'
);

update public.profiles set status = 'active'
where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
update public.profiles set status = 'active', is_platform_admin = true
where id = '33333333-3333-4333-8333-333333333333';

-- ---------------------------------------------------------------------------
-- Static privileges
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'app.fn_is_platform_admin()', 'execute'),
  'anon has no EXECUTE on app.fn_is_platform_admin()'
);
select ok(
  has_function_privilege('authenticated', 'app.fn_is_platform_admin()', 'execute'),
  'authenticated has EXECUTE on app.fn_is_platform_admin()'
);
select ok(
  not has_function_privilege('authenticated', 'app.fn_handle_new_user()', 'execute')
  and not has_function_privilege('anon', 'app.fn_handle_new_user()', 'execute'),
  'nobody but the trigger can execute app.fn_handle_new_user()'
);
select ok(
  not has_schema_privilege('anon', 'app', 'usage'),
  'anon has no USAGE on schema app'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'email', 'update')
  and has_column_privilege('authenticated', 'public.profiles', 'name', 'update'),
  'authenticated can update name only'
);

-- ---------------------------------------------------------------------------
-- As user A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.profiles), 1::bigint, 'user A sees exactly one profile');
select is(
  (select id from public.profiles),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the one profile user A sees is their own'
);
select is(
  (select count(*) from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  0::bigint,
  'user A sees 0 rows of user B'
);

select results_eq(
  $$ with u as (update public.profiles set name = 'A renamed'
       where id = '11111111-1111-4111-8111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'user A updates exactly one row when renaming themselves'
);
select is(
  (select name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'A renamed',
  'user A''s new name is stored'
);

select throws_ok(
  $$ update public.profiles set status = 'deactivated' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'user A cannot update their own status'
);
select throws_ok(
  $$ update public.profiles set is_platform_admin = true where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'user A cannot make themselves platform admin'
);
select throws_ok(
  $$ update public.profiles set email = 'x@rls.test' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'user A cannot change their own email'
);

select results_eq(
  $$ with u as (update public.profiles set name = 'hijacked'
       where id = '22222222-2222-4222-8222-222222222222' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'user A''s update of user B''s name changes 0 rows'
);

select throws_ok(
  $$ insert into public.profiles (id, email) values ('44444444-4444-4444-8444-444444444444', 'x@rls.test') $$,
  '42501', null,
  'authenticated cannot insert profiles'
);
select throws_ok(
  $$ delete from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'authenticated cannot delete profiles'
);

select is(app.fn_is_platform_admin(), false, 'fn_is_platform_admin() is false for a normal user');

-- ---------------------------------------------------------------------------
-- As the platform admin
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(app.fn_is_platform_admin(), true, 'fn_is_platform_admin() is true for an active admin');
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a platform admin still sees only their own profile through RLS'
);

-- ---------------------------------------------------------------------------
-- As anon
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501', null,
  'anon reads nothing from profiles (no SELECT privilege)'
);
select throws_ok(
  $$ insert into public.profiles (id, email) values ('55555555-5555-4555-8555-555555555555', 'y@rls.test') $$,
  '42501', null,
  'anon cannot insert profiles'
);
select throws_ok(
  $$ select app.fn_is_platform_admin() $$,
  '42501', null,
  'anon cannot call app.fn_is_platform_admin()'
);

-- ---------------------------------------------------------------------------
-- Back as postgres: verify nothing leaked through
-- ---------------------------------------------------------------------------
reset role;

select is(
  (select name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'User B',
  'user B''s name is unchanged'
);
select results_eq(
  $$ select status, is_platform_admin, email from public.profiles
     where id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('active'::text, false, 'a@rls.test'::text) $$,
  'user A''s status, admin flag and email are unchanged'
);
update public.profiles set updated_at = '2000-01-01T00:00:00Z'
where id = '22222222-2222-4222-8222-222222222222';
select is(
  (select updated_at from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  now(),
  'updated_at trigger overwrites updated_at with now() on every update'
);

select * from finish();
rollback;
