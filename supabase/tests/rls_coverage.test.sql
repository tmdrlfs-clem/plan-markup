-- Every table in public and app has RLS enabled and at least one policy (NFR20).
-- Queries the catalog, so it covers future tables without listing them.
-- scripts/check-rls.mjs runs the same query outside pgTAP for readable CI output.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app')
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every table in public and app has row level security enabled'
);

select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app')
      and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_catalog.pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname
      )
  $$,
  'every table in public and app has at least one policy'
);

select * from finish();
rollback;
