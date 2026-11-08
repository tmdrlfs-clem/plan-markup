-- Story 9.2 (FR70): 4541 zones.
--
-- A zone is a markup of type 'zone'. It is written by public.apply_markup_ops
-- (the same op path, field-level LWW, undo and sync as every markup) and read
-- through markups' RLS (effective access on the drawing). This view names its
-- parts for the engine and reports: the outer polygon and holes in PDF user
-- space, each hole's tag ('column' or 'shaft'), the zone's name, use and
-- placement options. security_invoker: the caller's RLS on markups applies.
create view public.zones
with (security_invoker = true, security_barrier = true) as
select
  m.id,
  m.drawing_id,
  m.page_id,
  m.geometry -> 'points' as polygon,
  coalesce(m.geometry -> 'holes', '[]'::jsonb) as holes,
  coalesce(m.props -> 'zone' -> 'holeTags', '[]'::jsonb) as hole_tags,
  m.props -> 'zone' ->> 'name' as name,
  m.props -> 'zone' ->> 'use' as use,
  coalesce(m.props -> 'zone' -> 'options', '{}'::jsonb) as options,
  m.version,
  m.created_at,
  m.updated_at
from public.markups m
where m.type = 'zone' and m.deleted_at is null;

comment on view public.zones is 'Story 9.2: the 4541 zones (markups of type zone, not deleted), under the caller''s markups RLS.';

revoke all on public.zones from public, anon, authenticated;
grant select on public.zones to authenticated;
