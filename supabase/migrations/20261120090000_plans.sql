-- Story 10.8 (FR13, NFR24): the platform admin records a plan on companies
-- and on individual accounts, before billing exists.
--
-- profiles.plan / companies.plan   trial (the default), pilot or standard.
-- admin_set_plan                   the only way a plan changes: one audited
--                                  transaction that checks the actor.
--
-- Users never set a plan: profiles has column grants for name and theme only,
-- and companies has no write grant at all. The plan is a record; nothing is
-- switched on or off by it yet.

alter table public.profiles add column plan text not null default 'trial';
alter table public.profiles add constraint profiles_plan_check check (plan in ('trial', 'pilot', 'standard'));
comment on column public.profiles.plan is 'Server-controlled (Story 10.8). The plan of an individual account; a company member works under the company''s plan.';

alter table public.companies add column plan text not null default 'trial';
alter table public.companies add constraint companies_plan_check check (plan in ('trial', 'pilot', 'standard'));
comment on column public.companies.plan is 'Server-controlled (Story 10.8).';

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'user.plan_changed',
    'company.created', 'company.plan_changed',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed'
  ));

-- ---------------------------------------------------------------------------
-- public.admin_set_plan(): set the plan of a user or a company.
--
-- Called by the server with the service client (EXECUTE is service_role
-- only), passing the signed-in user's id as the actor; the function checks
-- the actor itself (NFR22). Returns the plan before the change; when it
-- already was p_plan nothing is written.
--   PT403 the actor is not an active platform admin
--   PT404 no such user or company
-- ---------------------------------------------------------------------------
create function public.admin_set_plan(p_actor_id uuid, p_target_type text, p_target_id uuid, p_plan text)
returns table (previous_plan text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text;
begin
  if p_actor_id is null or p_target_id is null then
    raise exception 'actor and target are required' using errcode = '22023';
  end if;
  if p_target_type is null or p_target_type not in ('user', 'company') then
    raise exception 'target type must be user or company' using errcode = '22023';
  end if;
  if p_plan is null or p_plan not in ('trial', 'pilot', 'standard') then
    raise exception 'plan must be trial, pilot or standard' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.status = 'active' and a.is_platform_admin
  ) then
    raise exception 'not a platform admin' using errcode = 'PT403';
  end if;

  if p_target_type = 'user' then
    select p.plan into v_previous from public.profiles p where p.id = p_target_id for update;
  else
    select c.plan into v_previous from public.companies c where c.id = p_target_id for update;
  end if;
  if not found then
    raise exception 'no such target' using errcode = 'PT404';
  end if;

  if v_previous <> p_plan then
    if p_target_type = 'user' then
      update public.profiles p set plan = p_plan where p.id = p_target_id;
    else
      update public.companies c set plan = p_plan where c.id = p_target_id;
    end if;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (
      p_actor_id,
      case p_target_type when 'user' then 'user.plan_changed' else 'company.plan_changed' end,
      p_target_type,
      p_target_id,
      pg_catalog.jsonb_build_object('from', v_previous, 'to', p_plan)
    );
  end if;

  previous_plan := v_previous;
  return next;
end;
$$;

revoke execute on function public.admin_set_plan(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_plan(uuid, text, uuid, text) to service_role;
