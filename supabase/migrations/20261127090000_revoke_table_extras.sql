-- Story 10.14 (NFR36, M3 security review H1): no TRUNCATE, TRIGGER or
-- REFERENCES for the API roles.
--
-- Supabase's default privileges give anon and authenticated every privilege
-- on a new table in public. The migrations revoke what each table should not
-- allow, but some kept TRUNCATE, TRIGGER and REFERENCES (rule_figures,
-- use_hazard_map, signatures, tool_sets, tools). TRUNCATE ignores row level
-- security: a signed-in user with a direct database connection could empty a
-- table of every user's rows. The API (PostgREST) has no TRUNCATE, so this was
-- not reachable through the app, but nothing should rest on that.
--
-- From here:
--   * no table in public or app grants TRUNCATE, TRIGGER or REFERENCES to
--     anon or authenticated;
--   * a new table in public grants nothing to anon or authenticated until
--     its migration says so (the default privileges of the postgres role,
--     which runs the migrations);
--   * supabase/tests/rls_matrix.test.sql fails when either comes back.

do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v')
  loop
    execute format('revoke truncate, trigger, references on %I.%I from anon, authenticated', r.nspname, r.relname);
  end loop;
end;
$$;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
