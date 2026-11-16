-- Story 10.7 (FR7, FR8, NFR17): a company admin changes roles and removes members.
--
-- set_company_member_role   change a member's role (admin, member, viewer).
-- remove_company_member     take a member out of the company. Nothing of
--                           theirs is deleted: their markup sets are owned by
--                           the user, and the account goes on as an individual.
--
-- Both are one audited transaction, end the member's Auth sessions (their
-- next request signs in again, with the new access), and refuse to leave a
-- company without an active admin. Called by the server with the service
-- client (EXECUTE is service_role only); each checks its actor itself (NFR22).
--   PT403 the actor is not an active admin of a company
--   PT404 that user is not a member of the actor's company
--   PT409 the change would leave the company without an active admin

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'company.created',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed'
  ));

-- ---------------------------------------------------------------------------
-- app.fn_company_admin_guard(): the actor's company (locked, so two changes
-- to one company run one after the other) and the target's current role.
-- ---------------------------------------------------------------------------
create function app.fn_company_admin_guard(p_actor_id uuid, p_user_id uuid, out o_company_id uuid, out o_role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or p_user_id is null then
    raise exception 'actor and user are required' using errcode = '22023';
  end if;

  select c.id into o_company_id
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.user_id = p_actor_id and m.role = 'admin' and p.status = 'active'
  for update of c;
  if not found then
    raise exception 'not a company admin' using errcode = 'PT403';
  end if;

  select m.role into o_role
  from public.company_members m
  where m.user_id = p_user_id and m.company_id = o_company_id
  for update;
  if not found then
    raise exception 'not a member of this company' using errcode = 'PT404';
  end if;
end;
$$;

revoke execute on function app.fn_company_admin_guard(uuid, uuid) from public, anon, authenticated;

-- True when the company has an active admin other than p_user_id.
create function app.fn_company_has_other_admin(p_company_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company_id
      and m.user_id <> p_user_id
      and m.role = 'admin'
      and p.status = 'active'
  );
$$;

revoke execute on function app.fn_company_has_other_admin(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.set_company_member_role(). Returns the role before the change; when
-- it already was p_role nothing is written and no session ends.
-- ---------------------------------------------------------------------------
create function public.set_company_member_role(p_actor_id uuid, p_user_id uuid, p_role text)
returns table (previous_role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_previous text;
begin
  if p_role is null or p_role not in ('admin', 'member', 'viewer') then
    raise exception 'role must be admin, member or viewer' using errcode = '22023';
  end if;
  select g.o_company_id, g.o_role into v_company_id, v_previous from app.fn_company_admin_guard(p_actor_id, p_user_id) g;

  if v_previous <> p_role then
    if v_previous = 'admin' and not app.fn_company_has_other_admin(v_company_id, p_user_id) then
      raise exception 'a company needs an active admin' using errcode = 'PT409';
    end if;
    update public.company_members m set role = p_role where m.user_id = p_user_id;
    delete from auth.sessions s where s.user_id = p_user_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (p_actor_id, 'company.member_role_changed', 'company', v_company_id,
            pg_catalog.jsonb_build_object('user_id', p_user_id, 'from', v_previous, 'to', p_role));
  end if;

  previous_role := v_previous;
  return next;
end;
$$;

revoke execute on function public.set_company_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_company_member_role(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.remove_company_member(). An admin may remove themselves when another
-- active admin remains.
-- ---------------------------------------------------------------------------
create function public.remove_company_member(p_actor_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select g.o_company_id, g.o_role into v_company_id, v_role from app.fn_company_admin_guard(p_actor_id, p_user_id) g;

  if v_role = 'admin' and not app.fn_company_has_other_admin(v_company_id, p_user_id) then
    raise exception 'a company needs an active admin' using errcode = 'PT409';
  end if;
  delete from public.company_members m where m.user_id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'company.member_removed', 'company', v_company_id,
          pg_catalog.jsonb_build_object('user_id', p_user_id, 'role', v_role));
end;
$$;

revoke execute on function public.remove_company_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_company_member(uuid, uuid) to service_role;
