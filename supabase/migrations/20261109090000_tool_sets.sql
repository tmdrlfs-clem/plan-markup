-- Story 7.1: personal tool sets (FR39, UX-DR19).
--
-- tool_sets  a user's named group of tools, in their own order (position).
-- tools      a reusable markup template in a set: the markup's geometry,
--            style and props (`markup`), optionally typed as a device
--            (`device`: group, label, description; Story 7.2), and an image in
--            the private `tool-assets` bucket at `<owner_id>/<tool_set_id>/…`
--            (`asset_path`; Story 7.2).
--
-- Owner-only, for active users only (FR5). A tool's owner is its set's owner.
-- No SECURITY DEFINER function is needed (NFR22 does not apply).

create table public.tool_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_sets_name_check check (length(btrim(name)) between 1 and 100 and name = btrim(name)),
  constraint tool_sets_position_check check (position = position and position between -1e15 and 1e15)
);

create index tool_sets_owner_idx on public.tool_sets (owner_id, position);

comment on table public.tool_sets is 'A user''s tool set (Story 7.1). Owner only.';

create table public.tools (
  id uuid primary key default gen_random_uuid(),
  tool_set_id uuid not null references public.tool_sets (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  markup jsonb not null,
  device jsonb,
  asset_path text,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tools_name_check check (length(btrim(name)) between 1 and 100 and name = btrim(name)),
  constraint tools_markup_check check (jsonb_typeof(markup) = 'object' and pg_column_size(markup) <= 262144),
  constraint tools_device_check check (device is null or (jsonb_typeof(device) = 'object' and pg_column_size(device) <= 4096)),
  constraint tools_asset_path_check check (
    asset_path is null
    or (asset_path like owner_id::text || '/' || tool_set_id::text || '/%' and length(asset_path) <= 300)
  ),
  constraint tools_position_check check (position = position and position between -1e15 and 1e15)
);

create index tools_set_idx on public.tools (tool_set_id, position);
create index tools_owner_idx on public.tools (owner_id);

comment on table public.tools is 'A tool in a tool set (Story 7.1; content from Story 7.2). Owner only; the set''s owner.';

alter table public.tool_sets enable row level security;
alter table public.tools enable row level security;

create policy tool_sets_select_own on public.tool_sets
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy tool_sets_insert_own on public.tool_sets
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy tool_sets_update_own on public.tool_sets
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()))
  with check (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy tool_sets_delete_own on public.tool_sets
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

-- A tool belongs to one of the caller's own sets.
create policy tools_select_own on public.tools
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy tools_insert_own on public.tools
  for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and (select app.fn_is_active_user())
    and exists (select 1 from public.tool_sets s where s.id = tool_set_id and s.owner_id = (select auth.uid()))
  );

create policy tools_update_own on public.tools
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()))
  with check (
    owner_id = (select auth.uid()) and (select app.fn_is_active_user())
    and exists (select 1 from public.tool_sets s where s.id = tool_set_id and s.owner_id = (select auth.uid()))
  );

create policy tools_delete_own on public.tools
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

revoke all on public.tool_sets from anon;
revoke all on public.tools from anon;
grant select, insert, update, delete on public.tool_sets to authenticated;
grant select, insert, update, delete on public.tools to authenticated;
