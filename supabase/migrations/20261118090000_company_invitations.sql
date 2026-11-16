-- Story 10.6 (FR6, NFR18): a company admin invites people by email.
--
-- company_invitations   one row per invitation: company, email, role, the
--                       SHA-256 of the emailed token (never the token), who
--                       sent it, when it expires (7 days at most), and when it
--                       was accepted or revoked. One open invitation per
--                       company and email.
-- create_company_invitation / revoke_company_invitation
--                       the company admin's writes, each one audited transaction.
-- get_company_invitation / accept_company_invitation
--                       what the emailed link shows and does. The link is
--                       single-use and bound to the invited email.
-- list_company_members  the member list for the company admin.
--
-- The four invitation functions are called by the server with the service
-- client (EXECUTE is service_role only) and check their actor themselves
-- (NFR22). Errors use PostgREST's PTxxx codes, listed on each function.

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  email text not null,
  role text not null,
  token_hash text not null,
  -- No foreign key: the record outlives the inviter's account.
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  constraint fk_company_invitations_company foreign key (company_id) references public.companies (id) on delete cascade,
  constraint company_invitations_email_check check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  constraint company_invitations_role_check check (role in ('admin', 'member', 'viewer')),
  constraint company_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint company_invitations_token_hash_key unique (token_hash),
  constraint company_invitations_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint company_invitations_closed_once_check check (accepted_at is null or revoked_at is null),
  constraint company_invitations_accepted_check check ((accepted_at is null) = (accepted_by is null))
);

create unique index company_invitations_open_key on public.company_invitations (company_id, email)
  where accepted_at is null and revoked_at is null;
create index company_invitations_company_idx on public.company_invitations (company_id, created_at desc);

comment on table public.company_invitations is 'Company invitations (Story 10.6). Written only by the invitation functions; read (without the token hash) by the company''s admins.';

alter table public.company_invitations enable row level security;

revoke all on public.company_invitations from public, anon, authenticated;
-- Every column but token_hash.
grant select (id, company_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.company_invitations to authenticated;

create policy company_invitations_select_company_admin_or_platform_admin on public.company_invitations
  for select to authenticated
  using ((select app.fn_is_company_admin(company_id)) or (select app.fn_is_platform_admin()));

-- ---------------------------------------------------------------------------
-- audit_log: the invitation actions.
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    'user.activated', 'user.deactivated', 'company.created',
    'company.member_invited', 'company.invitation_revoked', 'company.member_joined'
  ));

-- ---------------------------------------------------------------------------
-- public.create_company_invitation(): invite an email to the actor's company.
--   PT403 the actor is not an active admin of a company
--   PT409 that email is already a member of this company
--   PT423 that email belongs to another company
-- An open invitation to the same email is revoked and replaced (a resend).
-- ---------------------------------------------------------------------------
create function public.create_company_invitation(p_actor_id uuid, p_email text, p_role text, p_token_hash text)
returns table (invitation_id uuid, company_id uuid, company_name text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_company_id uuid;
  v_company_name text;
  v_member_company uuid;
  v_invitation_id uuid;
  v_expires timestamptz;
begin
  if p_actor_id is null then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if char_length(v_email) not between 3 and 254 or pg_catalog.strpos(v_email, '@') < 2 then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('admin', 'member', 'viewer') then
    raise exception 'role must be admin, member or viewer' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;

  select m.company_id, c.name into v_company_id, v_company_name
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.user_id = p_actor_id and m.role = 'admin' and p.status = 'active'
  for update of c;
  if not found then
    raise exception 'not a company admin' using errcode = 'PT403';
  end if;

  select m.company_id into v_member_company
  from public.profiles p
  join public.company_members m on m.user_id = p.id
  where lower(p.email) = v_email;
  if found then
    if v_member_company = v_company_id then
      raise exception 'already a member of this company' using errcode = 'PT409';
    end if;
    raise exception 'belongs to another company' using errcode = 'PT423';
  end if;

  update public.company_invitations i
     set revoked_at = pg_catalog.now()
   where i.company_id = v_company_id and i.email = v_email
     and i.accepted_at is null and i.revoked_at is null;

  insert into public.company_invitations (company_id, email, role, token_hash, invited_by, expires_at)
  values (v_company_id, v_email, p_role, p_token_hash, p_actor_id, pg_catalog.now() + interval '7 days')
  returning id, company_invitations.expires_at into v_invitation_id, v_expires;

  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'company.member_invited', 'company', v_company_id,
          pg_catalog.jsonb_build_object('invitation_id', v_invitation_id, 'role', p_role));

  invitation_id := v_invitation_id;
  company_id := v_company_id;
  company_name := v_company_name;
  expires_at := v_expires;
  return next;
end;
$$;

revoke execute on function public.create_company_invitation(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_company_invitation(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.revoke_company_invitation(): withdraw an open invitation.
--   PT404 no such invitation in a company the actor is an active admin of
--   PT409 the invitation is already accepted or revoked
-- ---------------------------------------------------------------------------
create function public.revoke_company_invitation(p_actor_id uuid, p_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_closed boolean;
begin
  if p_actor_id is null or p_invitation_id is null then
    raise exception 'actor and invitation are required' using errcode = '22023';
  end if;

  select i.company_id, (i.accepted_at is not null or i.revoked_at is not null) into v_company_id, v_closed
  from public.company_invitations i
  join public.company_members m on m.company_id = i.company_id
  join public.profiles p on p.id = m.user_id
  where i.id = p_invitation_id and m.user_id = p_actor_id and m.role = 'admin' and p.status = 'active'
  for update of i;
  if not found then
    raise exception 'no such invitation' using errcode = 'PT404';
  end if;
  if v_closed then
    raise exception 'the invitation is already closed' using errcode = 'PT409';
  end if;

  update public.company_invitations set revoked_at = pg_catalog.now() where id = p_invitation_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_actor_id, 'company.invitation_revoked', 'company', v_company_id,
          pg_catalog.jsonb_build_object('invitation_id', p_invitation_id));
end;
$$;

revoke execute on function public.revoke_company_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_company_invitation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- public.get_company_invitation(): what the emailed link shows. No row for an
-- unknown token. state: open | expired | accepted | revoked. Changes nothing.
-- ---------------------------------------------------------------------------
create function public.get_company_invitation(p_token_hash text)
returns table (invitation_id uuid, company_name text, email text, role text, state text, account_exists boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         c.name,
         i.email,
         i.role,
         case
           when i.accepted_at is not null then 'accepted'
           when i.revoked_at is not null then 'revoked'
           when i.expires_at <= pg_catalog.now() then 'expired'
           else 'open'
         end,
         exists (select 1 from public.profiles p where lower(p.email) = i.email)
  from public.company_invitations i
  join public.companies c on c.id = i.company_id
  where i.token_hash = p_token_hash;
$$;

revoke execute on function public.get_company_invitation(text) from public, anon, authenticated;
grant execute on function public.get_company_invitation(text) to service_role;

-- ---------------------------------------------------------------------------
-- public.accept_company_invitation(): the invited user joins. Single use.
--   PT404 unknown token
--   PT410 the invitation is accepted, revoked or expired
--   PT403 the user's email is not the invited email
--   PT422 the user's account is deactivated
--   PT409 the user is already a member of this company
--   PT423 the user belongs to another company
-- A pending account becomes active: the invitation stands in for the platform
-- admin's activation (FR6), and the emailed link proves the address.
-- ---------------------------------------------------------------------------
create function public.accept_company_invitation(p_token_hash text, p_user_id uuid)
returns table (company_id uuid, company_name text, role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.company_invitations%rowtype;
  v_email text;
  v_status text;
  v_member_company uuid;
  v_company_name text;
begin
  if p_token_hash is null or p_user_id is null then
    raise exception 'token and user are required' using errcode = '22023';
  end if;

  select i.* into v_inv from public.company_invitations i where i.token_hash = p_token_hash for update;
  if not found then
    raise exception 'no such invitation' using errcode = 'PT404';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= pg_catalog.now() then
    raise exception 'the invitation is no longer valid' using errcode = 'PT410';
  end if;

  select lower(p.email), p.status into v_email, v_status from public.profiles p where p.id = p_user_id for update;
  if not found or v_email <> v_inv.email then
    raise exception 'the invitation is for another email' using errcode = 'PT403';
  end if;
  if v_status = 'deactivated' then
    raise exception 'the account is deactivated' using errcode = 'PT422';
  end if;

  select m.company_id into v_member_company from public.company_members m where m.user_id = p_user_id;
  if found then
    if v_member_company = v_inv.company_id then
      raise exception 'already a member of this company' using errcode = 'PT409';
    end if;
    raise exception 'belongs to another company' using errcode = 'PT423';
  end if;

  insert into public.company_members (user_id, company_id, role) values (p_user_id, v_inv.company_id, v_inv.role);
  if v_status = 'pending' then
    update public.profiles set status = 'active' where id = p_user_id;
  end if;
  update public.company_invitations
     set accepted_at = pg_catalog.now(), accepted_by = p_user_id
   where id = v_inv.id;
  insert into public.audit_log (actor_id, action, target_type, target_id, detail)
  values (p_user_id, 'company.member_joined', 'company', v_inv.company_id,
          pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.role));

  select c.name into v_company_name from public.companies c where c.id = v_inv.company_id;
  company_id := v_inv.company_id;
  company_name := v_company_name;
  role := v_inv.role;
  return next;
end;
$$;

revoke execute on function public.accept_company_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_company_invitation(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- public.list_company_members(): the members of the caller's company, for its
-- admins. Profiles are readable only by their owner, so the names and emails
-- come through this function, which checks the caller (auth.uid()) itself:
-- an active admin gets their own company's members; anyone else gets no rows.
-- ---------------------------------------------------------------------------
create function public.list_company_members()
returns table (user_id uuid, name text, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.name, p.email, m.role, m.created_at
  from public.company_members me
  join public.profiles mp on mp.id = me.user_id
  join public.company_members m on m.company_id = me.company_id
  join public.profiles p on p.id = m.user_id
  where me.user_id = (select auth.uid())
    and me.role = 'admin'
    and mp.status = 'active'
  order by m.created_at, m.user_id;
$$;

revoke execute on function public.list_company_members() from public, anon;
grant execute on function public.list_company_members() to authenticated;
