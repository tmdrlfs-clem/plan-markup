-- Story 5.13: the user's signature (FR83, AR19).
--
-- One signature per user: a PNG in the private `signatures` bucket under
-- `<user_id>/…`, and a row in public.signatures naming it. Only its owner, and
-- only while active (FR5), can read, add, change or delete either; the app
-- serves the image by a signed URL of at most 10 minutes. No SECURITY DEFINER
-- function is needed (NFR22 does not apply).

create table public.signatures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  storage_path text not null,
  width integer not null,
  height integer not null,
  updated_at timestamptz not null default now(),
  constraint signatures_path_owner check (storage_path like user_id::text || '/%' and length(storage_path) <= 200),
  constraint signatures_width_check check (width between 1 and 2000),
  constraint signatures_height_check check (height between 1 and 2000)
);

comment on table public.signatures is 'A user''s signature image (Story 5.13): its object in the private signatures bucket. Owner only.';

alter table public.signatures enable row level security;

create policy signatures_select_own on public.signatures
  for select to authenticated
  using (user_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy signatures_insert_own on public.signatures
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy signatures_update_own on public.signatures
  for update to authenticated
  using (user_id = (select auth.uid()) and (select app.fn_is_active_user()))
  with check (user_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy signatures_delete_own on public.signatures
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select app.fn_is_active_user()));

revoke all on public.signatures from anon;
grant select, insert, update, delete on public.signatures to authenticated;

-- The private bucket: PNG only, at most 512 KB an object.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 524288, array['image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Objects: only the owner's folder (`<user_id>/…`), only while active.
create policy signatures_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()));

create policy signatures_objects_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()));

create policy signatures_objects_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()))
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()));

create policy signatures_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()));
