-- Story 6.1: the markup set of an exact PDF (A1, A2, AR5, AR6).
--
-- drawings        a markup set, owned by the user who made it.
-- drawing_files   a PDF the set belongs to, identified by the SHA-256 of its
--                 bytes (A1); the pdf.js fingerprint is a hint only; parent_file_id
--                 links in-app page edits (A2, later stories); storage_path stays
--                 null unless storing PDFs is on (FR53; no PDF bytes are sent).
-- pages           a stable page_id per page of a file (markups and calibrations
--                 bind to it, never to the index).
-- calibrations    one per page_id (Epic 4's calibration, validated by the app's
--                 Zod schema).
--
-- Owner-only, for active users only (FR5). The rows are made on the first edit
-- of an unknown file by app.ensure_drawing_file (SECURITY INVOKER: RLS applies),
-- in one transaction; opening a file makes none.

create table public.drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  storage_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawings_title_check check (length(title) between 1 and 255)
);

create index drawings_owner_idx on public.drawings (owner_id);

create table public.drawing_files (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  sha256 text not null,
  fingerprint text,
  page_count integer not null,
  filename text not null,
  parent_file_id uuid references public.drawing_files (id) on delete set null,
  storage_path text,
  created_at timestamptz not null default now(),
  constraint drawing_files_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint drawing_files_fingerprint_check check (fingerprint is null or length(fingerprint) between 1 and 64),
  constraint drawing_files_page_count_check check (page_count between 1 and 10000),
  constraint drawing_files_filename_check check (length(filename) between 1 and 255),
  constraint drawing_files_storage_path_check check (storage_path is null or length(storage_path) <= 300),
  constraint drawing_files_sha256_unique unique (drawing_id, sha256)
);

create index drawing_files_sha256_idx on public.drawing_files (sha256);
create index drawing_files_parent_idx on public.drawing_files (parent_file_id);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  drawing_file_id uuid not null references public.drawing_files (id) on delete cascade,
  index integer not null,
  rotation integer not null default 0,
  crop_box double precision[] not null,
  width double precision not null,
  height double precision not null,
  constraint pages_index_check check (index between 0 and 9999),
  constraint pages_rotation_check check (rotation in (0, 90, 180, 270)),
  constraint pages_crop_box_check check (array_length(crop_box, 1) = 4 and array_position(crop_box, null) is null),
  constraint pages_size_check check (width > 0 and height > 0 and width <= 1e6 and height <= 1e6),
  constraint pages_index_unique unique (drawing_file_id, index)
);

create table public.calibrations (
  page_id uuid primary key references public.pages (id) on delete cascade,
  calibration jsonb not null,
  updated_at timestamptz not null default now(),
  constraint calibrations_object_check check (jsonb_typeof(calibration) = 'object' and pg_column_size(calibration) <= 2048)
);

comment on table public.drawings is 'A markup set (Story 6.1). Owner only.';
comment on table public.drawing_files is 'A PDF of a markup set, by the SHA-256 of its bytes (A1). No bytes are stored unless FR53 is on.';
comment on table public.pages is 'A stable page id per page of a drawing file (A2).';
comment on table public.calibrations is 'A page''s calibration (Epic 4), by page id.';

-- ---------------------------------------------------------------------------
-- app.fn_owns_drawing(drawing_id): the caller owns the drawing and is active.
-- SECURITY DEFINER so the policies on files, pages and calibrations do not
-- recurse through the drawings policy; it reads only the caller's own row.
-- ---------------------------------------------------------------------------
create or replace function app.fn_owns_drawing(p_drawing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.fn_is_active_user() and exists (
    select 1 from public.drawings d
    where d.id = p_drawing_id and d.owner_id = (select auth.uid())
  );
$$;

revoke execute on function app.fn_owns_drawing(uuid) from public, anon;
grant execute on function app.fn_owns_drawing(uuid) to authenticated;

alter table public.drawings enable row level security;
alter table public.drawing_files enable row level security;
alter table public.pages enable row level security;
alter table public.calibrations enable row level security;

create policy drawings_select_own on public.drawings
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));
create policy drawings_insert_own on public.drawings
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));
create policy drawings_update_own on public.drawings
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()))
  with check (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));
create policy drawings_delete_own on public.drawings
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select app.fn_is_active_user()));

create policy drawing_files_select_own on public.drawing_files
  for select to authenticated using (app.fn_owns_drawing(drawing_id));
create policy drawing_files_insert_own on public.drawing_files
  for insert to authenticated with check (app.fn_owns_drawing(drawing_id));
create policy drawing_files_delete_own on public.drawing_files
  for delete to authenticated using (app.fn_owns_drawing(drawing_id));

create policy pages_select_own on public.pages
  for select to authenticated
  using (exists (select 1 from public.drawing_files f where f.id = drawing_file_id and app.fn_owns_drawing(f.drawing_id)));
create policy pages_insert_own on public.pages
  for insert to authenticated
  with check (exists (select 1 from public.drawing_files f where f.id = drawing_file_id and app.fn_owns_drawing(f.drawing_id)));

create policy calibrations_select_own on public.calibrations
  for select to authenticated
  using (exists (select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id where p.id = page_id and app.fn_owns_drawing(f.drawing_id)));
create policy calibrations_insert_own on public.calibrations
  for insert to authenticated
  with check (exists (select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id where p.id = page_id and app.fn_owns_drawing(f.drawing_id)));
create policy calibrations_update_own on public.calibrations
  for update to authenticated
  using (exists (select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id where p.id = page_id and app.fn_owns_drawing(f.drawing_id)))
  with check (exists (select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id where p.id = page_id and app.fn_owns_drawing(f.drawing_id)));
create policy calibrations_delete_own on public.calibrations
  for delete to authenticated
  using (exists (select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id where p.id = page_id and app.fn_owns_drawing(f.drawing_id)));

revoke all on public.drawings, public.drawing_files, public.pages, public.calibrations from anon, authenticated;
grant select, insert, update, delete on public.drawings to authenticated;
-- A file's identity and its pages never change once made (A1, A2: an edit is a new file).
grant select, insert, delete on public.drawing_files, public.pages to authenticated;
grant select, insert, update, delete on public.calibrations to authenticated;

-- ---------------------------------------------------------------------------
-- public.ensure_drawing_file: the caller's markup set for a file, made on the
-- first edit of an unknown SHA-256 (a drawing titled by the filename, the file,
-- its pages). The caller's own file with that hash is returned as it is.
-- SECURITY INVOKER: every row goes through the owner policies above. A
-- transaction-scoped advisory lock per (user, sha256) keeps two first edits
-- from making two sets.
--   p_pages: [{"rotation": 0, "cropBox": [x0, y0, x1, y1], "width": w, "height": h}, ...]
-- Returns the drawing id, the file id and the page ids by index.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_drawing_file(p_sha256 text, p_filename text, p_pages jsonb)
returns table (drawing_id uuid, file_id uuid, page_ids uuid[])
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_drawing uuid;
  v_file uuid;
  v_count integer;
begin
  if v_uid is null or not app.fn_is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sha256' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception 'invalid pages' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_pages);
  if v_count not between 1 and 10000 then
    raise exception 'invalid page count' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_sha256, 0));

  select f.drawing_id, f.id into v_drawing, v_file
  from public.drawing_files f
  join public.drawings d on d.id = f.drawing_id
  where f.sha256 = p_sha256 and d.owner_id = v_uid
  order by f.created_at
  limit 1;

  if v_file is null then
    insert into public.drawings (owner_id, title) values (v_uid, p_filename) returning id into v_drawing;
    insert into public.drawing_files (drawing_id, sha256, page_count, filename)
    values (v_drawing, p_sha256, v_count, p_filename)
    returning id into v_file;
    insert into public.pages (drawing_file_id, index, rotation, crop_box, width, height)
    select v_file, (e.ord - 1)::integer,
           coalesce((e.page ->> 'rotation')::integer, 0),
           array(select jsonb_array_elements_text(e.page -> 'cropBox')::double precision),
           (e.page ->> 'width')::double precision,
           (e.page ->> 'height')::double precision
    from jsonb_array_elements(p_pages) with ordinality as e(page, ord);
  end if;

  return query
    select v_drawing, v_file, array(select p.id from public.pages p where p.drawing_file_id = v_file order by p.index);
end;
$$;

revoke execute on function public.ensure_drawing_file(text, text, jsonb) from public, anon;
grant execute on function public.ensure_drawing_file(text, text, jsonb) to authenticated;
