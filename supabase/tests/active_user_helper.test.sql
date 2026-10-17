-- app.fn_is_active_user() (FR5): true only for a caller whose profile is active.
-- Self-contained: creates its own users inside the transaction (no seed dependency).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Fixtures (as postgres). The trigger creates pending profiles.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '61111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'active@helper.test', '{}'),
  ('00000000-0000-0000-0000-000000000000', '62222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'pending@helper.test', '{}'),
  ('00000000-0000-0000-0000-000000000000', '63333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'deactivated@helper.test', '{}'),
  ('00000000-0000-0000-0000-000000000000', '64444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'noprofile@helper.test', '{}');

update public.profiles set status = 'active' where id = '61111111-1111-4111-8111-111111111111';
update public.profiles set status = 'deactivated' where id = '63333333-3333-4333-8333-333333333333';
delete from public.profiles where id = '64444444-4444-4444-8444-444444444444';

select ok(
  not has_function_privilege('anon', 'app.fn_is_active_user()', 'execute'),
  'anon has no EXECUTE on app.fn_is_active_user()'
);

set local role authenticated;

set local request.jwt.claims = '{"sub":"61111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(app.fn_is_active_user(), true, 'fn_is_active_user() is true for an active user');

set local request.jwt.claims = '{"sub":"62222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(app.fn_is_active_user(), false, 'fn_is_active_user() is false for a pending user');

set local request.jwt.claims = '{"sub":"63333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(app.fn_is_active_user(), false, 'fn_is_active_user() is false for a deactivated user');

set local request.jwt.claims = '{"sub":"64444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(app.fn_is_active_user(), false, 'fn_is_active_user() is false for a user with no profile');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select app.fn_is_active_user() $$,
  '42501', null,
  'anon cannot call app.fn_is_active_user()'
);

reset role;
select * from finish();
rollback;
