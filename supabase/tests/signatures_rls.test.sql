-- Story 5.13: RLS on public.signatures and the private signatures bucket
-- (FR83, AR19): only the owner, while active, can read or write their row
-- and their objects; nobody else, and never anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'sig-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '72222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'sig-b@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '73333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'sig-off@rls.test');
update public.profiles set status = 'active'
where id in ('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222', '73333333-3333-4333-8333-333333333333');

-- Fixtures as postgres: B's signature row and object; the deactivated user's too.
insert into public.signatures (user_id, storage_path, width, height)
values
  ('72222222-2222-4222-8222-222222222222', '72222222-2222-4222-8222-222222222222/b.png', 300, 100),
  ('73333333-3333-4333-8333-333333333333', '73333333-3333-4333-8333-333333333333/c.png', 300, 100);
insert into storage.objects (bucket_id, name, owner_id)
values
  ('signatures', '72222222-2222-4222-8222-222222222222/b.png', '72222222-2222-4222-8222-222222222222'),
  ('signatures', '73333333-3333-4333-8333-333333333333/c.png', '73333333-3333-4333-8333-333333333333');
update public.profiles set status = 'deactivated' where id = '73333333-3333-4333-8333-333333333333';

select is(
  (select public from storage.buckets where id = 'signatures'),
  false,
  'the signatures bucket is private'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'signatures'),
  array['image/png'],
  'the signatures bucket takes PNG only'
);
select throws_ok(
  $$ insert into public.signatures (user_id, storage_path, width, height)
     values ('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222/x.png', 10, 10) $$,
  '23514', null,
  'a row''s object must be in its owner''s folder'
);
select ok(
  not has_table_privilege('anon', 'public.signatures', 'select'),
  'anon has no SELECT on public.signatures'
);

-- As user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from public.signatures), 0::bigint, 'user A sees no signature rows of others');
select is(
  (select count(*) from storage.objects where bucket_id = 'signatures'),
  0::bigint,
  'user A sees none of user B''s signature objects'
);
select results_eq(
  $$ with u as (update public.signatures set width = 1 where user_id = '72222222-2222-4222-8222-222222222222' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'user A cannot change user B''s row'
);
select results_eq(
  $$ with d as (delete from public.signatures where user_id = '72222222-2222-4222-8222-222222222222' returning 1)
     select count(*)::int from d $$,
  $$ values (0) $$,
  'user A cannot delete user B''s row'
);
select results_eq(
  $$ with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'signatures' and name like '72222222%' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'user A cannot change user B''s object (storage refuses direct deletes for everyone)'
);
select throws_ok(
  $$ insert into public.signatures (user_id, storage_path, width, height)
     values ('72222222-2222-4222-8222-222222222222', '72222222-2222-4222-8222-222222222222/y.png', 10, 10) $$,
  '42501', null,
  'user A cannot add a row for user B'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('signatures', '72222222-2222-4222-8222-222222222222/evil.png', '71111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'user A cannot put an object in user B''s folder'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('signatures', '71111111-1111-4111-8111-111111111111/a.png', '71111111-1111-4111-8111-111111111111') $$,
  'user A can put an object in their own folder'
);
select lives_ok(
  $$ insert into public.signatures (user_id, storage_path, width, height)
     values ('71111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111/a.png', 300, 100) $$,
  'user A can add their own row'
);
select is((select count(*) from public.signatures), 1::bigint, 'user A sees exactly their own row');
select is(
  (select count(*) from storage.objects where bucket_id = 'signatures'),
  1::bigint,
  'user A sees exactly their own object'
);

-- As user B: their own row and object, not A's.
set local request.jwt.claims = '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}';
select results_eq(
  $$ select user_id::text from public.signatures $$,
  $$ values ('72222222-2222-4222-8222-222222222222') $$,
  'user B sees only their own row'
);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'signatures' $$,
  $$ values ('72222222-2222-4222-8222-222222222222/b.png') $$,
  'user B sees only their own object'
);

-- A deactivated user: not even their own.
set local request.jwt.claims = '{"sub":"73333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*) from public.signatures), 0::bigint, 'a deactivated user cannot read their own row');
select is(
  (select count(*) from storage.objects where bucket_id = 'signatures'),
  0::bigint,
  'a deactivated user cannot read their own object'
);

select * from finish();
rollback;
