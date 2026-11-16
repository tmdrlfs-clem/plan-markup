-- Story 10.6: company_invitations and the invitation functions.
-- Rows are counted by this test's own ids: a local database may hold rows from e2e runs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'inv-padmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'inv-cadmin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'inv-other-admin@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'Inv-Pending@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'inv-gone@rls.test'),
  ('00000000-0000-0000-0000-000000000000', 'a6666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'inv-stranger@rls.test');
update public.profiles set status = 'active', is_platform_admin = true where id = 'a1111111-1111-4111-8111-111111111111';
update public.profiles set status = 'active'
 where id in ('a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a6666666-6666-4666-8666-666666666666');
update public.profiles set status = 'deactivated' where id = 'a5555555-5555-4555-8555-555555555555';
select * from public.admin_create_company('a1111111-1111-4111-8111-111111111111', 'Invite Co rls', 'inv-cadmin@rls.test');
select * from public.admin_create_company('a1111111-1111-4111-8111-111111111111', 'Other Co rls', 'inv-other-admin@rls.test');

create temporary table t on commit drop as
select (select id from public.companies where name = 'Invite Co rls') as co,
       repeat('a', 64) as h1, repeat('b', 64) as h2, repeat('c', 64) as h3, repeat('d', 64) as h4, repeat('e', 64) as h5;
grant select on t to authenticated;

-- Privileges.
select ok(
  not has_function_privilege('authenticated', 'public.create_company_invitation(uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.revoke_company_invitation(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_company_invitation(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.accept_company_invitation(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.accept_company_invitation(text, uuid)', 'execute'),
  'users cannot call the invitation functions');
select ok(
  has_function_privilege('authenticated', 'public.list_company_members()', 'execute')
  and not has_function_privilege('anon', 'public.list_company_members()', 'execute'),
  'list_company_members is for signed-in users only');
select ok(
  not has_column_privilege('authenticated', 'public.company_invitations', 'token_hash', 'select')
  and has_column_privilege('authenticated', 'public.company_invitations', 'email', 'select')
  and not has_table_privilege('authenticated', 'public.company_invitations', 'insert')
  and not has_table_privilege('authenticated', 'public.company_invitations', 'update')
  and not has_table_privilege('authenticated', 'public.company_invitations', 'delete'),
  'users read invitations without the token hash and write nothing');

-- Who may invite, and whom.
select throws_ok(
  $$ select * from public.create_company_invitation('a6666666-6666-4666-8666-666666666666', 'new@rls.test', 'member', repeat('a', 64)) $$,
  'PT403', null, 'a user who is no company admin cannot invite');
select throws_ok(
  $$ select * from public.create_company_invitation('a1111111-1111-4111-8111-111111111111', 'new@rls.test', 'member', repeat('a', 64)) $$,
  'PT403', null, 'the platform admin is not a company admin');
select throws_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'new@rls.test', 'owner', repeat('a', 64)) $$,
  '22023', null, 'an unknown role is refused');
select throws_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'not-an-email', 'member', repeat('a', 64)) $$,
  '22023', null, 'a value that is no email is refused');
select throws_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'new@rls.test', 'member', 'short') $$,
  '22023', null, 'a bad token hash is refused');
select throws_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'INV-cadmin@rls.test', 'member', repeat('a', 64)) $$,
  'PT409', null, 'someone already in this company is refused');
select throws_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'inv-other-admin@rls.test', 'member', repeat('a', 64)) $$,
  'PT423', null, 'someone in another company is refused');

-- Invite; a second invitation to the same email replaces the first.
select results_eq(
  $$ select company_id, company_name, expires_at <= now() + interval '7 days' and expires_at > now() + interval '6 days 23 hours'
       from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', '  Inv-Pending@RLS.test ', 'member', (select h1 from t)) $$,
  $$ select co, 'Invite Co rls', true from t $$,
  'an invitation is created for the admin''s company, valid 7 days');
select results_eq(
  $$ select email, role, invited_by from public.company_invitations where token_hash = (select h1 from t) $$,
  $$ values ('inv-pending@rls.test', 'member', 'a2222222-2222-4222-8222-222222222222'::uuid) $$,
  'the email is stored lower-cased and trimmed');
select lives_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'inv-pending@rls.test', 'viewer', (select h2 from t)) $$,
  'inviting the same email again succeeds');
select results_eq(
  $$ select token_hash = (select h1 from t), revoked_at is not null from public.company_invitations
      where company_id = (select co from t) and email = 'inv-pending@rls.test' order by created_at, revoked_at nulls last $$,
  $$ values (true, true), (false, false) $$,
  'the earlier invitation is revoked, the new one is open');
select is(
  (select count(*)::int from public.audit_log where target_id = (select co from t) and action = 'company.member_invited'),
  2, 'each invitation is recorded');

-- What the link shows.
select results_eq(
  $$ select company_name, email, role, state, account_exists from public.get_company_invitation((select h2 from t)) $$,
  $$ values ('Invite Co rls', 'inv-pending@rls.test', 'viewer', 'open', true) $$,
  'an open invitation shows the company, email and role');
select results_eq(
  $$ select state from public.get_company_invitation((select h1 from t)) $$, $$ values ('revoked') $$,
  'a replaced invitation shows as revoked');
select is((select count(*)::int from public.get_company_invitation(repeat('f', 64))), 0, 'an unknown token shows nothing');

-- Accept: bound to the email, single use.
select throws_ok(
  $$ select * from public.accept_company_invitation((select h2 from t), 'a6666666-6666-4666-8666-666666666666') $$,
  'PT403', null, 'another user cannot use the invitation');
select throws_ok(
  $$ select * from public.accept_company_invitation((select h1 from t), 'a4444444-4444-4444-8444-444444444444') $$,
  'PT410', null, 'a revoked invitation cannot be used');
select throws_ok(
  $$ select * from public.accept_company_invitation(repeat('f', 64), 'a4444444-4444-4444-8444-444444444444') $$,
  'PT404', null, 'an unknown token is refused');
select results_eq(
  $$ select company_id, company_name, role from public.accept_company_invitation((select h2 from t), 'a4444444-4444-4444-8444-444444444444') $$,
  $$ select co, 'Invite Co rls', 'viewer' from t $$,
  'the invited user joins');
select results_eq(
  $$ select m.role, p.status from public.company_members m join public.profiles p on p.id = m.user_id
      where m.user_id = 'a4444444-4444-4444-8444-444444444444' and m.company_id = (select co from t) $$,
  $$ values ('viewer', 'active') $$,
  'with the invited role, and the pending account is now active');
select results_eq(
  $$ select actor_id, detail ->> 'role' from public.audit_log where target_id = (select co from t) and action = 'company.member_joined' $$,
  $$ values ('a4444444-4444-4444-8444-444444444444'::uuid, 'viewer') $$,
  'the join is recorded');
select throws_ok(
  $$ select * from public.accept_company_invitation((select h2 from t), 'a4444444-4444-4444-8444-444444444444') $$,
  'PT410', null, 'the invitation cannot be used twice');
select results_eq(
  $$ select state from public.get_company_invitation((select h2 from t)) $$, $$ values ('accepted') $$,
  'and shows as accepted');

-- Deactivated, expired, and already in another company.
select lives_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'inv-gone@rls.test', 'member', (select h3 from t)) $$,
  'a deactivated account can be invited');
select throws_ok(
  $$ select * from public.accept_company_invitation((select h3 from t), 'a5555555-5555-4555-8555-555555555555') $$,
  'PT422', null, 'but cannot join while deactivated');
select lives_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'inv-stranger@rls.test', 'member', (select h4 from t)) $$,
  'a user in no company is invited');
update public.company_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
 where token_hash = (select h4 from t);
select results_eq(
  $$ select state from public.get_company_invitation((select h4 from t)) $$, $$ values ('expired') $$,
  'after 7 days the invitation shows as expired');
select throws_ok(
  $$ select * from public.accept_company_invitation((select h4 from t), 'a6666666-6666-4666-8666-666666666666') $$,
  'PT410', null, 'and cannot be used');
select throws_ok(
  $$ insert into public.company_invitations (company_id, email, role, token_hash, invited_by, expires_at)
     select co, 'long@rls.test', 'member', repeat('9', 64), 'a2222222-2222-4222-8222-222222222222', now() + interval '8 days' from t $$,
  '23514', null, 'an invitation cannot be valid for more than 7 days');
select lives_ok(
  $$ select * from public.create_company_invitation('a2222222-2222-4222-8222-222222222222', 'inv-stranger@rls.test', 'member', (select h5 from t)) $$,
  'an expired invitation is replaced by a new one');
insert into public.company_members (user_id, company_id, role)
select 'a6666666-6666-4666-8666-666666666666', id, 'member' from public.companies where name = 'Other Co rls';
select throws_ok(
  $$ select * from public.accept_company_invitation((select h5 from t), 'a6666666-6666-4666-8666-666666666666') $$,
  'PT423', null, 'a user who joined another company meanwhile cannot accept');

-- Revoke.
select throws_ok(
  $$ select public.revoke_company_invitation('a3333333-3333-4333-8333-333333333333', (select id from public.company_invitations where token_hash = (select h5 from t))) $$,
  'PT404', null, 'another company''s admin cannot revoke it');
select lives_ok(
  $$ select public.revoke_company_invitation('a2222222-2222-4222-8222-222222222222', (select id from public.company_invitations where token_hash = (select h5 from t))) $$,
  'the company admin revokes an open invitation');
select throws_ok(
  $$ select public.revoke_company_invitation('a2222222-2222-4222-8222-222222222222', (select id from public.company_invitations where token_hash = (select h5 from t))) $$,
  'PT409', null, 'a closed invitation cannot be revoked again');
select is(
  (select count(*)::int from public.audit_log where target_id = (select co from t) and action = 'company.invitation_revoked'),
  1, 'the revocation is recorded');

-- Who reads what.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select ok(
  (select count(*) from public.company_invitations where company_id = (select co from t)) = 5
  and (select count(*) from public.list_company_members()) = 2,
  'the company admin reads the company''s invitations and members');
set local request.jwt.claims = '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.company_invitations) + (select count(*)::int from public.list_company_members()),
  0, 'a viewer of the company reads no invitations and no member list');
set local request.jwt.claims = '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}';
select ok(
  (select count(*) from public.company_invitations where company_id = (select co from t)) = 0
  and (select count(*) from public.list_company_members() where email like 'inv-%') = 2
  and not exists (select 1 from public.list_company_members() where email = 'inv-cadmin@rls.test'),
  'another company''s admin reads only their own company');
reset role;

select * from finish();
rollback;
