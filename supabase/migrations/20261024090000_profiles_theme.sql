-- Story 3.8: the user's appearance theme (FR69, UX-DR3) on their profile.
--
-- Only the workspace follows it (sign-in and PendingActivation stay Blueprint,
-- admin and marketing Daylight). A user may change their own theme and nothing
-- else new: the existing self-update policy (profiles_update_self) limits the
-- rows, the column grant below limits the columns (name and theme only). No
-- SECURITY DEFINER function is needed (NFR22 does not apply).

alter table public.profiles
  add column theme text not null default 'blueprint';

alter table public.profiles
  add constraint profiles_theme_check check (theme in ('blueprint', 'daylight', 'contrast'));

comment on column public.profiles.theme is 'Workspace theme: blueprint (default), daylight or contrast. Writable by the user for their own row.';

grant update (theme) on public.profiles to authenticated;
