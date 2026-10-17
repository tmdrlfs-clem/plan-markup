-- LOCAL DEV AND CI ONLY. Never run against a hosted project.
-- `supabase db reset` and `supabase start` run this file after the migrations.
--
-- Accounts (password for all: password123):
--   admin@plan-markup.test    active, platform admin
--   user@plan-markup.test     active
--   pending@plan-markup.test  pending (PendingActivation screen, Story 1.5)
--
-- Fixed UUIDs use version nibble 4 and variant 8 so Zod v4 uuid() accepts them.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'admin@plan-markup.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Dev Admin"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'user@plan-markup.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Dev User"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000c',
   'authenticated', 'authenticated', 'pending@plan-markup.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Dev Pending"}', now(), now(),
   '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  u.id, u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-00000000000c'
);

-- Profiles were created by app.fn_handle_new_user (status pending).
update public.profiles
set status = 'active', is_platform_admin = true
where id = '00000000-0000-4000-8000-00000000000a';

update public.profiles
set status = 'active'
where id = '00000000-0000-4000-8000-00000000000b';
