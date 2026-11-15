-- Story 10.4 (FR12, NFR17, NFR34): the platform admin lists accounts and
-- activates or deactivates them; every admin write is recorded.
--
-- audit_log               one row per admin write: who, what, on whom, when.
--                         Append-only (a trigger refuses update and delete,
--                         for every role). Read by the platform admin only.
-- profiles                the platform admin may read every profile (the list).
-- admin_set_user_status   the only way a status changes: one transaction that
--                         checks the actor, changes the status, ends the
--                         user's sessions on deactivation and writes audit_log.

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- No foreign keys: the record outlives the accounts it names.
  actor_id uuid not null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  detail jsonb not null default '{}'::jsonb,
  constraint audit_log_action_check check (action in ('user.activated', 'user.deactivated')),
  constraint audit_log_target_type_check check (target_type in ('user')),
  constraint audit_log_detail_check check (jsonb_typeof(detail) = 'object')
);

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);

comment on table public.audit_log is 'Platform admin writes (Story 10.4, NFR34). Append-only; written only by admin functions; read by the platform admin.';

alter table public.audit_log enable row level security;

revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;

create policy audit_log_select_platform_admin on public.audit_log
  for select to authenticated
  using ((select app.fn_is_platform_admin()));

-- No insert, update or delete policy: rows come from admin functions only.

create function app.fn_audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

revoke execute on function app.fn_audit_log_append_only() from public, anon, authenticated;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.fn_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- profiles: the platform admin reads every profile.
-- ---------------------------------------------------------------------------
create policy profiles_select_platform_admin on public.profiles
  for select to authenticated
  using ((select app.fn_is_platform_admin()));

create index profiles_status_created_idx on public.profiles (status, created_at desc);

-- ---------------------------------------------------------------------------
-- public.admin_set_user_status(): activate or deactivate an account.
--
-- Called by the server with the service client (EXECUTE is service_role
-- only), which passes the signed-in user's id as the actor. The function
-- checks the actor itself (NFR22): an active platform admin, and never
-- deactivating their own account. Errors use PostgREST's PTxxx codes.
--
-- Deactivation deletes the user's Auth sessions (their refresh tokens go with
-- them), so their next request is anonymous (NFR17). Returns the status before
-- the change; when it already was p_status nothing is written.
-- ---------------------------------------------------------------------------
create function public.admin_set_user_status(p_actor_id uuid, p_user_id uuid, p_status text)
returns table (previous_status text, email text, name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_email text;
  v_name text;
begin
  if p_actor_id is null or p_user_id is null then
    raise exception 'actor and user are required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'deactivated') then
    raise exception 'status must be active or deactivated' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.status = 'active' and a.is_platform_admin
  ) then
    raise exception 'not a platform admin' using errcode = 'PT403';
  end if;
  if p_actor_id = p_user_id and p_status = 'deactivated' then
    raise exception 'an admin cannot deactivate their own account' using errcode = 'PT409';
  end if;

  select p.status, p.email, p.name into v_previous, v_email, v_name
  from public.profiles p
  where p.id = p_user_id
  for update;
  if not found then
    raise exception 'no such user' using errcode = 'PT404';
  end if;

  if v_previous <> p_status then
    update public.profiles set status = p_status where id = p_user_id;
    if p_status = 'deactivated' then
      delete from auth.sessions s where s.user_id = p_user_id;
    end if;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (
      p_actor_id,
      case p_status when 'active' then 'user.activated' else 'user.deactivated' end,
      'user',
      p_user_id,
      pg_catalog.jsonb_build_object('from', v_previous, 'to', p_status)
    );
  end if;

  previous_status := v_previous;
  email := v_email;
  name := v_name;
  return next;
end;
$$;

revoke execute on function public.admin_set_user_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_user_status(uuid, uuid, text) to service_role;
