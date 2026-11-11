-- Story 10.3: profiles.email follows auth.users.email; users cannot write it
-- (or any protected column) themselves (NFR24).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111',
        'authenticated', 'authenticated', 'sync-old@rls.test');
update public.profiles set status = 'active' where id = '71111111-1111-4111-8111-111111111111';

-- Auth confirms an email change: the profile follows.
update auth.users set email = 'sync-new@rls.test' where id = '71111111-1111-4111-8111-111111111111';
select is(
  (select email from public.profiles where id = '71111111-1111-4111-8111-111111111111'),
  'sync-new@rls.test',
  'an auth email change is copied to the profile'
);
-- Other auth updates leave it alone.
update auth.users set raw_user_meta_data = '{"x":1}' where id = '71111111-1111-4111-8111-111111111111';
select is(
  (select email from public.profiles where id = '71111111-1111-4111-8111-111111111111'),
  'sync-new@rls.test',
  'other auth updates do not touch the profile email'
);
select ok(
  not has_function_privilege('authenticated', 'app.fn_sync_profile_email()', 'execute'),
  'authenticated cannot call the sync function'
);

-- As the user: the name is writable, protected columns are not.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';
select results_eq(
  $$ with u as (update public.profiles set name = 'New Name'
       where id = '71111111-1111-4111-8111-111111111111' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'the user changes their own name'
);
select throws_ok(
  $$ update public.profiles set email = 'mine@rls.test' where id = '71111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'the user cannot write profiles.email'
);
select throws_ok(
  $$ update public.profiles set status = 'pending' where id = '71111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'the user cannot write profiles.status'
);
select throws_ok(
  $$ update public.profiles set is_platform_admin = true where id = '71111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'the user cannot write profiles.is_platform_admin'
);
reset role;
select is(
  (select name from public.profiles where id = '71111111-1111-4111-8111-111111111111'),
  'New Name',
  'the name was saved'
);

select * from finish();
rollback;
