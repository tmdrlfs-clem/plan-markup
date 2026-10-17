-- Story 1.5: rate limiter (NFR15) and active-user helper (FR5).

-- ---------------------------------------------------------------------------
-- app.rate_limits: fixed-window counters. Only hashes are stored (no emails or IPs).
-- ---------------------------------------------------------------------------
create table app.rate_limits (
  bucket text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, key_hash),
  constraint rate_limits_bucket_check check (bucket ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint rate_limits_key_hash_check check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint rate_limits_hits_check check (hits >= 0)
);

comment on table app.rate_limits is 'Fixed-window rate-limit counters. Written only by public.consume_rate_limit (service_role).';

alter table app.rate_limits enable row level security;
revoke all on app.rate_limits from public, anon, authenticated;

-- Deny-all marker policy: satisfies the RLS coverage rule; service_role bypasses RLS.
create policy rate_limits_all_none on app.rate_limits
  for all to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- public.consume_rate_limit(): counts one hit and says whether it is allowed.
--
-- NFR22 asks SECURITY DEFINER functions to verify the caller. This function
-- has no user context: its caller check is the EXECUTE grant below
-- (service_role only), asserted in supabase/tests/rate_limits.test.sql.
-- It lives in public because PostgREST only exposes public (and graphql_public).
-- ---------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_max_hits integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_window interval;
  v_hits integer;
  v_started timestamptz;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid key_hash' using errcode = '22023';
  end if;
  if p_max_hits is null or p_max_hits not between 1 and 10000 then
    raise exception 'p_max_hits must be between 1 and 10000' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'p_window_seconds must be between 1 and 86400' using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  insert into app.rate_limits as r (bucket, key_hash, window_started_at, hits, updated_at)
  values (p_bucket, p_key_hash, v_now, 1, v_now)
  on conflict (bucket, key_hash) do update
    set window_started_at = case
          when r.window_started_at <= v_now - v_window then v_now
          else r.window_started_at
        end,
        hits = case
          when r.window_started_at <= v_now - v_window then 1
          else r.hits + 1
        end,
        updated_at = v_now
  returning r.hits, r.window_started_at into v_hits, v_started;

  -- Housekeeping: drop stale counters now and then.
  if pg_catalog.random() < 0.01 then
    delete from app.rate_limits where updated_at < v_now - interval '1 day';
  end if;

  if v_hits <= p_max_hits then
    allowed := true;
    retry_after_seconds := 0;
  else
    allowed := false;
    retry_after_seconds := greatest(
      1,
      pg_catalog.ceil(extract(epoch from (v_started + v_window - v_now)))::integer
    );
  end if;
  return next;
end;
$$;

revoke execute on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- app.fn_is_active_user(): true only when the caller's profile is active.
--
-- Every future data policy (drawings, markups, tool sets, ...) must AND this
-- helper (or a helper built on it), so pending and deactivated users read no
-- data (FR5). profiles_select_self stays as it is: pending users must be able
-- to read their own status.
-- ---------------------------------------------------------------------------
create or replace function app.fn_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
  );
$$;

revoke execute on function app.fn_is_active_user() from public, anon;
grant execute on function app.fn_is_active_user() to authenticated;
