-- Story 10.5 (FR9, FR11, AR5): companies and their members.
--
-- companies             one row per customer company; the name is unique
--                       whatever its case.
-- company_members       who belongs to which company, with a role. The primary
--                       key is the user: a user belongs to at most one company (FR9).
-- app.fn_is_company_member / app.fn_is_company_admin
--                       RLS helpers for this and later tables.
-- admin_create_company  the platform admin creates a company with its first
--                       admin, in one audited transaction.
--
-- Users never write these tables: members are added by this function now and
-- by invitations (10.6) and role changes (10.7) later.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_check check (name = btrim(name) and char_length(name) between 1 and 100)
);

create unique index companies_name_lower_key on public.companies (lower(name));

comment on table public.companies is 'Customer companies (Story 10.5). Created by the platform admin; read by their members.';

create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function app.fn_set_updated_at();

create table public.company_members (
  user_id uuid primary key,
  company_id uuid not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint fk_company_members_profile foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint fk_company_members_company foreign key (company_id) references public.companies (id) on delete cascade,
  constraint company_members_role_check check (role in ('admin', 'member', 'viewer'))
);

create index company_members_company_idx on public.company_members (company_id, role);

comment on table public.company_members is 'Company membership and role (Story 10.5). One row per user: at most one company each (FR9).';

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies on these tables can call them without
-- recursing into their own RLS. Both are false for pending and deactivated users.
-- ---------------------------------------------------------------------------
create function app.fn_is_company_member(p_company_id uuid)
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
    where m.user_id = (select auth.uid())
      and m.company_id = p_company_id
      and p.status = 'active'
  );
$$;

revoke execute on function app.fn_is_company_member(uuid) from public, anon;
grant execute on function app.fn_is_company_member(uuid) to authenticated;

create function app.fn_is_company_admin(p_company_id uuid)
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
    where m.user_id = (select auth.uid())
      and m.company_id = p_company_id
      and m.role = 'admin'
      and p.status = 'active'
  );
$$;

revoke execute on function app.fn_is_company_admin(uuid) from public, anon;
grant execute on function app.fn_is_company_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: read by the company's members and the platform admin; no user writes.
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.company_members enable row level security;

revoke all on public.companies from public, anon, authenticated;
revoke all on public.company_members from public, anon, authenticated;
grant select on public.companies to authenticated;
grant select on public.company_members to authenticated;

create policy companies_select_member_or_platform_admin on public.companies
  for select to authenticated
  using ((select app.fn_is_company_member(id)) or (select app.fn_is_platform_admin()));

create policy company_members_select_member_or_platform_admin on public.company_members
  for select to authenticated
  using ((select app.fn_is_company_member(company_id)) or (select app.fn_is_platform_admin()));

-- ---------------------------------------------------------------------------
-- audit_log: the company actions.
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('user.activated', 'user.deactivated', 'company.created'));
alter table public.audit_log drop constraint audit_log_target_type_check;
alter table public.audit_log add constraint audit_log_target_type_check
  check (target_type in ('user', 'company'));

-- ---------------------------------------------------------------------------
-- public.admin_create_company(): a company and its first admin.
--
-- Called by the server with the service client (EXECUTE is service_role
-- only), passing the signed-in user's id as the actor; the function checks
-- the actor itself (NFR22). The first admin is an existing, active account
-- that is in no company yet. Errors use PostgREST's PTxxx codes:
--   PT403 actor is not a platform admin     PT404 no account with that email
--   PT422 the account is not active         PT409 the account is in a company
-- A name already taken raises 23505 (the unique index).
-- ---------------------------------------------------------------------------
create function public.admin_create_company(p_actor_id uuid, p_name text, p_admin_email text)
returns table (company_id uuid, admin_user_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_admin_email, '')));
  v_user_id uuid;
  v_status text;
  v_company_id uuid;
begin
  if p_actor_id is null then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'name must have 1 to 100 characters' using errcode = '22023';
  end if;
  if v_email = '' or char_length(v_email) > 254 then
    raise exception 'admin email is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.status = 'active' and a.is_platform_admin
  ) then
    raise exception 'not a platform admin' using errcode = 'PT403';
  end if;

  select p.id, p.status into v_user_id, v_status
  from public.profiles p
  where lower(p.email) = v_email
  for update;
  if not found then
    raise exception 'no account with that email' using errcode = 'PT404';
  end if;
  if v_status <> 'active' then
    raise exception 'the account is not active' using errcode = 'PT422';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_user_id) then
    raise exception 'the account already belongs to a company' using errcode = 'PT409';
  end if;

  insert into public.companies (name) values (v_name) returning id into v_company_id;
  insert into public.company_members (user_id, company_id, role) values (v_user_id, v_company_id, 'admin');
  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (
    p_actor_id,
    'company.created',
    'company',
    v_company_id,
    pg_catalog.jsonb_build_object('name', v_name, 'admin_user_id', v_user_id)
  );

  company_id := v_company_id;
  admin_user_id := v_user_id;
  return next;
end;
$$;

revoke execute on function public.admin_create_company(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_company(uuid, text, text) to service_role;
