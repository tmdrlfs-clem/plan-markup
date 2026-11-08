-- Story 9.1 (FR71, FR79, A7, AR24): NZS 4541 rule figures and the default
-- use → hazard mapping.
--
-- rule_figures    one row per ruleset version: the per-hazard placement figures
--                 (m, m²) and extra named tables, each with its own verified flag.
--                 Seeded from src/core/sprinkler/rules/nzs4541.v1.json;
--                 scripts/check-rule-seed.mjs fails when they disagree.
-- use_hazard_map  a use's default hazard class. company_id null: the platform
--                 default (seeded from use-hazard.v1.json, draft); a company's
--                 own rows (FR72, M3) override it. companies does not exist yet,
--                 so company_id has no foreign key until it does.
--
-- Read by active signed-in users; written by the platform admin only (admin
-- editing and its audit log arrive with the admin console, M3).

create table public.rule_figures (
  ruleset_id text not null,
  version text not null,
  verified boolean not null,
  source text not null,
  hazards jsonb not null,
  tables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (ruleset_id, version),
  constraint rule_figures_id_check check (ruleset_id ~ '^[a-z0-9-]{1,40}$' and version ~ '^[0-9]{1,6}$'),
  constraint rule_figures_source_check check (length(source) between 1 and 500),
  constraint rule_figures_hazards_check check (
    jsonb_typeof(hazards) = 'object'
    and hazards ?& array['ELH', 'OH1', 'OH2', 'OH3']
    and pg_column_size(hazards) <= 8192
  ),
  constraint rule_figures_tables_check check (jsonb_typeof(tables) = 'object' and pg_column_size(tables) <= 32768)
);

comment on table public.rule_figures is 'NZS 4541 rule figures per ruleset version (Story 9.1). Read: active users; write: platform admin.';

create table public.use_hazard_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  map_version text not null,
  use text not null,
  hazard text not null,
  is_default boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint use_hazard_map_use_check check (use ~ '^[A-Za-z][A-Za-z0-9 /&-]{0,39}$'),
  constraint use_hazard_map_hazard_check check (hazard in ('ELH', 'OH1', 'OH2', 'OH3')),
  constraint use_hazard_map_version_check check (map_version ~ '^[0-9]{1,6}$')
);

-- One row per use (case-insensitive) per company, the platform default included.
create unique index use_hazard_map_use_idx
  on public.use_hazard_map (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(use));
-- At most one default use per company.
create unique index use_hazard_map_default_idx
  on public.use_hazard_map (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_default;

comment on table public.use_hazard_map is 'Use → hazard class (Story 9.1). company_id null = platform default. Read: active users; write: platform admin.';

create trigger use_hazard_map_set_updated_at
  before update on public.use_hazard_map
  for each row execute function app.fn_set_updated_at();

alter table public.rule_figures enable row level security;
alter table public.use_hazard_map enable row level security;

create policy rule_figures_select_active on public.rule_figures
  for select to authenticated
  using ((select app.fn_is_active_user()));

create policy rule_figures_write_admin on public.rule_figures
  for all to authenticated
  using ((select app.fn_is_platform_admin()))
  with check ((select app.fn_is_platform_admin()));

create policy use_hazard_map_select_active on public.use_hazard_map
  for select to authenticated
  using ((select app.fn_is_active_user()));

create policy use_hazard_map_write_admin on public.use_hazard_map
  for all to authenticated
  using ((select app.fn_is_platform_admin()))
  with check ((select app.fn_is_platform_admin()));

revoke all on public.rule_figures from anon;
revoke all on public.use_hazard_map from anon;
grant select, insert, update, delete on public.rule_figures to authenticated;
grant select, insert, update, delete on public.use_hazard_map to authenticated;

-- Seed: nzs4541 v1 (src/core/sprinkler/rules/nzs4541.v1.json).
insert into public.rule_figures (ruleset_id, version, verified, source, hazards, tables)
values (
  'nzs4541', '1', true,
  'Placement figures founder-confirmed against NZS 4541, 2026-10-16',
  '{
    "ELH": {"Amax": 21, "Smax": 4.6, "Smin": 1.8, "Wmax": 2.3, "Wmin": 0.05},
    "OH1": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "Wmin": 0.05},
    "OH2": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "Wmin": 0.05},
    "OH3": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "Wmin": 0.05}
  }'::jsonb,
  '{
    "wallReduced": {"verified": false, "source": "EN 12845 reading (exposed joists or open sides); not used in M2 placement",
                    "values": {"ELH": 1.5, "OH1": 1.5, "OH2": 1.5, "OH3": 1.5}},
    "designDensity": {"verified": false, "source": "Information only (mm/min); not used in placement",
                      "values": {"ELH": 2.25, "OH1": 5.0, "OH2": 5.0, "OH3": 5.0}}
  }'::jsonb
);

-- Seed: the draft platform-default mapping (src/core/sprinkler/rules/use-hazard.v1.json).
insert into public.use_hazard_map (company_id, map_version, use, hazard, is_default, verified)
values
  (null, '1', 'Office', 'ELH', true, false),
  (null, '1', 'Meeting', 'ELH', false, false),
  (null, '1', 'Corridor', 'ELH', false, false),
  (null, '1', 'Kitchen', 'OH1', false, false),
  (null, '1', 'Plant', 'OH1', false, false),
  (null, '1', 'Storage', 'OH2', false, false),
  (null, '1', 'Retail', 'OH2', false, false),
  (null, '1', 'Carpark', 'OH2', false, false);
