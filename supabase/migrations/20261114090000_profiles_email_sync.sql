-- Story 10.3: keep profiles.email in step with auth.users.email.
--
-- An email change is confirmed through Auth (both addresses, double_confirm_changes);
-- only then does auth.users.email change, and this trigger copies it. Users
-- never write profiles.email themselves (no column grant).

create or replace function app.fn_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email,
         updated_at = pg_catalog.now()
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

-- Only the trigger calls it.
revoke execute on function app.fn_sync_profile_email() from public, anon, authenticated;

create trigger trg_auth_users_sync_profile_email
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email and new.email is not null)
  execute function app.fn_sync_profile_email();
