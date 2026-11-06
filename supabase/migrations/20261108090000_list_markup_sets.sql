-- Stories 6.5 / 6.6 (FR51, FR81): the caller's markup sets, newest first.
--
-- One row per markup set: its title, its first file (name, hash, page count),
-- how many live markups it has and when anything in it last changed (the set,
-- a markup or a calibration). SECURITY INVOKER: the owner policies of every
-- table apply, so a caller only ever lists their own sets.

create or replace function public.list_markup_sets()
returns table (
  drawing_id uuid,
  title text,
  filename text,
  sha256 text,
  page_count integer,
  markup_count integer,
  last_modified timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id,
         d.title,
         f.filename,
         f.sha256,
         f.page_count,
         (select count(*)::integer from public.markups m where m.drawing_id = d.id and m.deleted_at is null),
         greatest(
           d.updated_at,
           (select max(m.updated_at) from public.markups m where m.drawing_id = d.id),
           (select max(c.updated_at) from public.calibrations c
              join public.pages p on p.id = c.page_id
              join public.drawing_files pf on pf.id = p.drawing_file_id
             where pf.drawing_id = d.id)
         )
  from public.drawings d
  join lateral (
    select f.filename, f.sha256, f.page_count
    from public.drawing_files f
    where f.drawing_id = d.id
    order by f.created_at
    limit 1
  ) f on true
  where d.owner_id = (select auth.uid())
  order by 7 desc, d.id
  limit 1000;
$$;

revoke execute on function public.list_markup_sets() from public, anon;
grant execute on function public.list_markup_sets() to authenticated;

-- FR81: a user's files by name (the "another version" hint).
create index drawing_files_filename_idx on public.drawing_files (filename);
