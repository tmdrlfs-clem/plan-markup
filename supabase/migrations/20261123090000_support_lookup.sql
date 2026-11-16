-- Story 10.10 (FR15, NFR34): the platform admin looks up an account's markup
-- sets for support.
--
-- admin_lookup_markup_sets   one row per markup set of the account: its file
--                            name, page count, how many markups it holds and
--                            when it was last saved. Nothing of the drawing
--                            itself: no page, geometry, text or stored file.
--                            Every call writes audit_log, in the same
--                            transaction as the read.
--
-- Called by the server with the service client (EXECUTE is service_role
-- only), passing the signed-in user's id as the actor; the function checks
-- the actor itself (NFR22).
--   PT403 the actor is not an active platform admin
--   PT404 no such account

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'user.plan_changed',
    'company.created', 'company.plan_changed',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed',
    'support.markup_sets_viewed'
  ));

create function public.admin_lookup_markup_sets(p_actor_id uuid, p_user_id uuid)
returns table (
  drawing_id uuid,
  filename text,
  page_count integer,
  file_count integer,
  markup_count integer,
  created_at timestamptz,
  last_saved_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sets integer;
begin
  if p_actor_id is null or p_user_id is null then
    raise exception 'actor and user are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.status = 'active' and a.is_platform_admin
  ) then
    raise exception 'not a platform admin' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'no such account' using errcode = 'PT404';
  end if;

  select count(*)::integer into v_sets from public.drawings d where d.owner_id = p_user_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'support.markup_sets_viewed', 'user', p_user_id, pg_catalog.jsonb_build_object('sets', v_sets));

  return query
  select
    d.id,
    -- The newest file of the set; the set's own title when it has no file yet.
    coalesce(f.filename, d.title),
    f.page_count,
    coalesce(fc.files, 0)::integer,
    coalesce(mk.markups, 0)::integer,
    d.created_at,
    greatest(d.updated_at, mk.last_at)
  from public.drawings d
  left join lateral (
    select df.filename, df.page_count
    from public.drawing_files df
    where df.drawing_id = d.id
    order by df.created_at desc, df.id
    limit 1
  ) f on true
  left join lateral (
    select count(*) as files from public.drawing_files df where df.drawing_id = d.id
  ) fc on true
  left join lateral (
    select count(*) filter (where k.deleted_at is null) as markups, max(k.updated_at) as last_at
    from public.markups k
    where k.drawing_id = d.id
  ) mk on true
  where d.owner_id = p_user_id
  order by greatest(d.updated_at, mk.last_at) desc, d.id
  limit 500;
end;
$$;

revoke execute on function public.admin_lookup_markup_sets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_lookup_markup_sets(uuid, uuid) to service_role;
