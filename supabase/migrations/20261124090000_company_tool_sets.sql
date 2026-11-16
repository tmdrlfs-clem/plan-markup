-- Story 10.11 (FR44): company tool sets.
--
-- A company admin publishes one of their own tool sets to their company:
-- `tool_sets.company_id` names the company. The set stays the admin's (they
-- go on editing it, and the company sees every change); every active member of
-- the company reads it, its tools and their images, and nobody but the owner
-- writes them.
--
-- set_tool_set_published   publish or withdraw one of the actor's own sets, in
--                          one audited transaction. Called by the server with
--                          the service client (EXECUTE is service_role only);
--                          it checks its actor itself (NFR22).
--   PT403 the actor is not an active admin of a company
--   PT404 the actor has no such set
--   PT409 the company already has 100 published sets
--
-- Users never write `company_id`: INSERT and UPDATE on tool_sets are granted
-- by column, without it. A set is withdrawn by itself when its owner stops
-- being an admin of that company (role change, removal, company deleted).

alter table public.tool_sets
  add column company_id uuid,
  add constraint fk_tool_sets_company foreign key (company_id) references public.companies (id) on delete set null;

create index tool_sets_company_idx on public.tool_sets (company_id) where company_id is not null;

comment on column public.tool_sets.company_id is 'The company this set is published to (Story 10.11); null for a personal set. Written only by set_tool_set_published().';
comment on table public.tool_sets is 'A user''s tool set (Story 7.1). Written by its owner; a published set is read by its company''s members (Story 10.11).';

-- ---------------------------------------------------------------------------
-- Column grants: everything a user wrote before, and not company_id.
-- ---------------------------------------------------------------------------
revoke insert, update on public.tool_sets from authenticated;
grant insert (id, owner_id, name, position, created_at, updated_at) on public.tool_sets to authenticated;
grant update (name, position, updated_at) on public.tool_sets to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: members read a set published to their company, and its tools.
-- app.fn_is_company_member() is false for pending and deactivated users.
-- ---------------------------------------------------------------------------
drop policy tool_sets_select_own on public.tool_sets;
create policy tool_sets_select_own_or_company on public.tool_sets
  for select to authenticated
  using (
    (owner_id = (select auth.uid()) and (select app.fn_is_active_user()))
    or (company_id is not null and app.fn_is_company_member(company_id))
  );

drop policy tools_select_own on public.tools;
create policy tools_select_own_or_company on public.tools
  for select to authenticated
  using (
    (owner_id = (select auth.uid()) and (select app.fn_is_active_user()))
    or exists (
      select 1 from public.tool_sets s
      where s.id = tool_set_id and s.company_id is not null and app.fn_is_company_member(s.company_id)
    )
  );

-- A tool image `<owner_id>/<tool_set_id>/…` of a set published to the caller's company.
create function app.fn_reads_company_tool_asset_path(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.tool_sets s
    where s.id::text = (storage.foldername(p_name))[2]
      and s.owner_id::text = (storage.foldername(p_name))[1]
      and s.company_id is not null
      and app.fn_is_company_member(s.company_id)
  );
$$;

revoke execute on function app.fn_reads_company_tool_asset_path(text) from public, anon;
grant execute on function app.fn_reads_company_tool_asset_path(text) to authenticated;

drop policy tool_assets_select_own on storage.objects;
create policy tool_assets_select_own_or_company on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tool-assets'
    and (app.fn_owns_tool_asset_path(name) or app.fn_reads_company_tool_asset_path(name))
  );

-- ---------------------------------------------------------------------------
-- A set is withdrawn when its owner stops being an admin of its company.
-- ---------------------------------------------------------------------------
create function app.fn_withdraw_company_tool_sets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.role <> 'admin' or new.company_id <> old.company_id or new.user_id <> old.user_id then
    update public.tool_sets s
    set company_id = null, updated_at = pg_catalog.now()
    where s.owner_id = old.user_id and s.company_id = old.company_id;
  end if;
  return null;
end;
$$;

revoke execute on function app.fn_withdraw_company_tool_sets() from public, anon, authenticated;

create trigger trg_company_members_withdraw_tool_sets
  after update or delete on public.company_members
  for each row execute function app.fn_withdraw_company_tool_sets();

-- ---------------------------------------------------------------------------
-- audit_log: publishing and withdrawing.
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'user.plan_changed',
    'company.created', 'company.plan_changed',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined',
    'company.member_role_changed', 'company.member_removed',
    'company.tool_set_published', 'company.tool_set_withdrawn',
    'support.markup_sets_viewed'
  ));

-- ---------------------------------------------------------------------------
-- public.set_tool_set_published(). Returns whether anything changed: asking
-- for what already is writes nothing.
-- ---------------------------------------------------------------------------
create function public.set_tool_set_published(p_actor_id uuid, p_tool_set_id uuid, p_published boolean)
returns table (changed boolean, company_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_current uuid;
  v_name text;
begin
  if p_actor_id is null or p_tool_set_id is null or p_published is null then
    raise exception 'actor, tool set and published are required' using errcode = '22023';
  end if;

  -- The company row is locked: two publications to one company run one after the other.
  select c.id, c.name into v_company_id, v_company_name
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.user_id = p_actor_id and m.role = 'admin' and p.status = 'active'
  for update of c;
  if not found then
    raise exception 'not a company admin' using errcode = 'PT403';
  end if;

  select s.company_id, s.name into v_current, v_name
  from public.tool_sets s
  where s.id = p_tool_set_id and s.owner_id = p_actor_id
  for update;
  if not found then
    raise exception 'no such tool set' using errcode = 'PT404';
  end if;

  changed := false;
  company_name := v_company_name;
  if p_published and v_current is distinct from v_company_id then
    if (select count(*) from public.tool_sets s where s.company_id = v_company_id) >= 100 then
      raise exception 'the company has 100 published tool sets' using errcode = 'PT409';
    end if;
    update public.tool_sets s set company_id = v_company_id, updated_at = pg_catalog.now() where s.id = p_tool_set_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (p_actor_id, 'company.tool_set_published', 'company', v_company_id,
            pg_catalog.jsonb_build_object('tool_set_id', p_tool_set_id, 'name', v_name));
    changed := true;
  elsif not p_published and v_current is not null then
    update public.tool_sets s set company_id = null, updated_at = pg_catalog.now() where s.id = p_tool_set_id;
    insert into public.audit_log (actor_id, action, target_type, target_id, detail)
    values (p_actor_id, 'company.tool_set_withdrawn', 'company', v_current,
            pg_catalog.jsonb_build_object('tool_set_id', p_tool_set_id, 'name', v_name));
    changed := true;
  end if;
  return next;
end;
$$;

revoke execute on function public.set_tool_set_published(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_tool_set_published(uuid, uuid, boolean) to service_role;
