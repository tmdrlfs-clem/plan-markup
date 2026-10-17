-- public.consume_rate_limit() and app.rate_limits (NFR15).
-- Self-contained: uses its own buckets and hashes (repeat('a', 64), ...) inside the transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------------------------------------------------------------------------
-- Counting inside one window (as postgres)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select allowed, retry_after_seconds
     from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 900) $$,
  $$ values (true, 0) $$,
  'call 1 of 3 is allowed with retry_after_seconds = 0'
);
select results_eq(
  $$ select allowed, retry_after_seconds
     from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 900) $$,
  $$ values (true, 0) $$,
  'call 2 of 3 is allowed'
);
select results_eq(
  $$ select allowed, retry_after_seconds
     from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 900) $$,
  $$ values (true, 0) $$,
  'call 3 of 3 is allowed'
);

create temp table over_limit as
  select * from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 900);
select is((select allowed from over_limit), false, 'call 4 of 3 is blocked');
select ok(
  (select retry_after_seconds > 0 and retry_after_seconds <= 900 from over_limit),
  'a blocked call reports 0 < retry_after_seconds <= window'
);
select is(
  (select hits from app.rate_limits where bucket = 'test_bucket' and key_hash = repeat('a', 64)),
  4,
  'blocked calls are still counted'
);

-- ---------------------------------------------------------------------------
-- Separate keys and buckets
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select allowed from public.consume_rate_limit('test_bucket', repeat('b', 64), 3, 900) $$,
  $$ values (true) $$,
  'a different key_hash is counted separately'
);
select results_eq(
  $$ select allowed from public.consume_rate_limit('other_bucket', repeat('a', 64), 3, 900) $$,
  $$ values (true) $$,
  'a different bucket is counted separately'
);

-- ---------------------------------------------------------------------------
-- Window expiry
-- ---------------------------------------------------------------------------
update app.rate_limits
set window_started_at = now() - interval '901 seconds'
where bucket = 'test_bucket' and key_hash = repeat('a', 64);

select results_eq(
  $$ select allowed, retry_after_seconds
     from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 900) $$,
  $$ values (true, 0) $$,
  'after the window has passed the next call is allowed'
);
select is(
  (select hits from app.rate_limits where bucket = 'test_bucket' and key_hash = repeat('a', 64)),
  1,
  'hits restarts at 1 in a new window'
);

-- ---------------------------------------------------------------------------
-- Input validation
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.consume_rate_limit('test_bucket', 'not-a-hash', 3, 900) $$,
  '22023', null,
  'an invalid key_hash raises 22023'
);
select throws_ok(
  $$ select * from public.consume_rate_limit('Bad-Bucket', repeat('a', 64), 3, 900) $$,
  '22023', null,
  'an invalid bucket name raises 22023'
);
select throws_ok(
  $$ select * from public.consume_rate_limit('test_bucket', repeat('a', 64), 0, 900) $$,
  '22023', null,
  'p_max_hits = 0 raises 22023'
);
select throws_ok(
  $$ select * from public.consume_rate_limit('test_bucket', repeat('a', 64), 3, 86401) $$,
  '22023', null,
  'p_window_seconds over one day raises 22023'
);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.consume_rate_limit(text, text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.consume_rate_limit(text, text, integer, integer)', 'execute'),
  'anon and authenticated have no EXECUTE on consume_rate_limit'
);
select ok(
  has_function_privilege('service_role', 'public.consume_rate_limit(text, text, integer, integer)', 'execute'),
  'service_role has EXECUTE on consume_rate_limit'
);
select ok(
  (select c.relrowsecurity
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = 'rate_limits'),
  'RLS is enabled on app.rate_limits'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from app.rate_limits $$,
  '42501', null,
  'authenticated cannot select from app.rate_limits'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ select count(*) from app.rate_limits $$,
  '42501', null,
  'anon cannot select from app.rate_limits'
);

reset role;
select * from finish();
rollback;
