-- Story 3.8 review T1: only active users may update their profile.
--
-- profiles_update_self predates the Story 1.5 rule that every data policy ANDs
-- app.fn_is_active_user() (FR5). With theme writable (Story 3.8) a pending or
-- deactivated account could still change its theme and name through
-- PostgREST. profiles_select_self is unchanged: pending users must read their
-- own status.

drop policy profiles_update_self on public.profiles;

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select app.fn_is_active_user()))
  with check (id = (select auth.uid()) and (select app.fn_is_active_user()));
