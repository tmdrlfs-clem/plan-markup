-- Story 1.3: profiles table, app helper schema and RLS baseline.
--
-- Rules for every later migration:
--   * every table in public/app has RLS enabled and at least one policy
--     (enforced by scripts/check-rls.mjs and supabase/tests/rls_coverage.test.sql);
--   * every function sets search_path = '' and fully qualifies names;
--   * every SECURITY DEFINER function revokes EXECUTE from public and anon.

-- ---------------------------------------------------------------------------
-- Helper schema for RLS functions
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
-- Policies call app.fn_* as the caller, so authenticated needs USAGE.
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  name text not null default '',
  email text not null,
  status text not null default 'pending',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_profiles_user foreign key (id) references auth.users (id) on delete cascade,
  constraint profiles_status_check check (status in ('pending', 'active', 'deactivated'))
);

comment on table public.profiles is 'One row per auth user. Created by app.fn_handle_new_user, removed by the FK cascade.';
comment on column public.profiles.is_platform_admin is 'Server-controlled. Never writable by authenticated users.';

alter table public.profiles enable row level security;

-- Column-level privileges: RLS restricts rows, not columns.
-- Supabase grants ALL on new public tables to anon and authenticated by default; take it back.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert or delete policy: rows are created by the trigger below and
-- removed by the FK cascade. Platform-admin writes use the service client.

-- ---------------------------------------------------------------------------
-- app.fn_is_platform_admin(): true only for an active platform admin.
-- SECURITY DEFINER so later policies can call it without RLS recursion.
-- ---------------------------------------------------------------------------
create function app.fn_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.is_platform_admin
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
    ),
    false
  );
$$;

revoke execute on function app.fn_is_platform_admin() from public, anon;
grant execute on function app.fn_is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- app.fn_handle_new_user(): creates a pending profile for every new auth user.
-- ---------------------------------------------------------------------------
create function app.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

-- Only the trigger calls it.
revoke execute on function app.fn_handle_new_user() from public, anon, authenticated;

create trigger trg_auth_users_new_profile
  after insert on auth.users
  for each row execute function app.fn_handle_new_user();

-- ---------------------------------------------------------------------------
-- app.fn_set_updated_at(): keeps updated_at current. Not SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create function app.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke execute on function app.fn_set_updated_at() from public, anon, authenticated;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function app.fn_set_updated_at();
