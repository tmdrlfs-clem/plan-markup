-- Review fix for Story 1.3: cap profiles.name at 100 characters.
-- Without it a user could store an unbounded name through
-- PATCH /rest/v1/profiles or through sign-up metadata.

update public.profiles set name = left(name, 100) where char_length(name) > 100;

alter table public.profiles
  add constraint profiles_name_length check (char_length(name) <= 100);

-- Sign-up metadata is user-controlled: trim and truncate it instead of
-- failing the sign-up on the constraint.
create or replace function app.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 100)
  );
  return new;
end;
$$;

revoke execute on function app.fn_handle_new_user() from public, anon, authenticated;
