-- Story 7.2: the private tool-assets bucket (FR40, AR19): objects only under
-- the caller's own folder and one of their own sets, while active.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'assets-a@rls.test'),
  ('00000000-0000-0000-0000-000000000000', '92222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'assets-b@rls.test');
update public.profiles set status = 'active'
where id in ('91111111-1111-4111-8111-111111111111', '92222222-2222-4222-8222-222222222222');

insert into public.tool_sets (id, owner_id, name)
values
  ('9aaaaaaa-0000-4000-8000-000000000001', '91111111-1111-4111-8111-111111111111', 'A set'),
  ('9bbbbbbb-0000-4000-8000-000000000001', '92222222-2222-4222-8222-222222222222', 'B set');
insert into storage.objects (bucket_id, name, owner_id)
values ('tool-assets', '92222222-2222-4222-8222-222222222222/9bbbbbbb-0000-4000-8000-000000000001/t.png', '92222222-2222-4222-8222-222222222222');

select is((select public from storage.buckets where id = 'tool-assets'), false, 'the tool-assets bucket is private');
select is(
  (select allowed_mime_types from storage.buckets where id = 'tool-assets'),
  array['image/png', 'image/jpeg'],
  'the tool-assets bucket takes PNG and JPEG only'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*) from storage.objects where bucket_id = 'tool-assets'), 0::bigint, 'A sees none of the objects of B');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tool-assets', '91111111-1111-4111-8111-111111111111/9aaaaaaa-0000-4000-8000-000000000001/t.png', '91111111-1111-4111-8111-111111111111') $$,
  'A uploads under their own set'
);
select is((select count(*) from storage.objects where bucket_id = 'tool-assets'), 1::bigint, 'A sees their own object');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tool-assets', '91111111-1111-4111-8111-111111111111/9bbbbbbb-0000-4000-8000-000000000001/t.png', '91111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'A cannot upload under the set of B'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tool-assets', '92222222-2222-4222-8222-222222222222/9bbbbbbb-0000-4000-8000-000000000001/x.png', '91111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'A cannot upload into the folder of B'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('tool-assets', '91111111-1111-4111-8111-111111111111/not-a-set/t.png', '91111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'A cannot upload outside a set'
);
reset role;
select ok(
  not has_function_privilege('anon', 'app.fn_owns_tool_asset_path(text)', 'execute'),
  'anon cannot call the asset path check'
);

select * from finish();
rollback;
