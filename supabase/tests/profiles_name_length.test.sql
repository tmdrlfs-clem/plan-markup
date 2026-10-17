-- profiles.name is capped at 100 characters (Story 1.3 review fix).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values ('33333333-3333-4333-8333-333333333333', 'long@rls.test',
        jsonb_build_object('name', '  ' || repeat('n', 300) || '  '));

select is(
  (select char_length(name) from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  100,
  'sign-up metadata name is trimmed and truncated to 100 characters'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles set name = repeat('x', 101)
     where id = '33333333-3333-4333-8333-333333333333' $$,
  '23514',
  null,
  'a user cannot set a name longer than 100 characters'
);
select lives_ok(
  $$ update public.profiles set name = repeat('x', 100)
     where id = '33333333-3333-4333-8333-333333333333' $$,
  'a 100-character name is accepted'
);

select * from finish();
rollback;
