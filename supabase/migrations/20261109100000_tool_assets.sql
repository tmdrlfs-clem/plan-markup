-- Story 7.2: the private `tool-assets` bucket (FR40, AR19).
--
-- A tool's image (PNG or JPEG, at most 8 MB) lives at
-- `<owner_id>/<tool_set_id>/<tool_id>.<ext>`. Only the owner, while active,
-- reads or writes it, and only under one of their own sets. The app serves it
-- by a signed URL of at most 10 minutes (NFR25).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tool-assets', 'tool-assets', false, 8388608, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether `p_name` is `<caller>/<one of the caller's sets>/…` (not `name`:
-- inside the query that would be the set's name column).
create or replace function app.fn_owns_tool_asset_path(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = (select auth.uid())::text
    and (select app.fn_is_active_user())
    and exists (
      select 1 from public.tool_sets s
      where s.id::text = (storage.foldername(p_name))[2]
        and s.owner_id = (select auth.uid())
    );
$$;

revoke execute on function app.fn_owns_tool_asset_path(text) from public, anon;
grant execute on function app.fn_owns_tool_asset_path(text) to authenticated;

create policy tool_assets_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'tool-assets' and app.fn_owns_tool_asset_path(name));

create policy tool_assets_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tool-assets' and app.fn_owns_tool_asset_path(name));

create policy tool_assets_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'tool-assets' and app.fn_owns_tool_asset_path(name))
  with check (bucket_id = 'tool-assets' and app.fn_owns_tool_asset_path(name));

create policy tool_assets_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'tool-assets' and (storage.foldername(name))[1] = (select auth.uid())::text and (select app.fn_is_active_user()));
