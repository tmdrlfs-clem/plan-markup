# Story 10.12: Company use → hazard mapping

Status: review

## Story

As a company admin,
I want to edit our default use → hazard mapping,
so that zones default to how we classify spaces.

## Acceptance Criteria

1. Given Company → 4541 settings, when I edit the mapping, then new zones in my company use it; existing zones keep their use and hazard (FR72).
2. Edits are audit-logged.

## Tasks / Subtasks

- [x] Migration `20261125090000_company_use_hazard_map.sql`:
  - `use_hazard_map.company_id` references `companies` (cascade). RLS: the platform rows are read by every active user as before; a company's rows are read by its members only; the platform admin's write policy covers the platform rows only.
  - `public.set_company_use_hazard_map(actor, uses)`: service_role only; checks that the actor is an active admin of a company; replaces the whole mapping (1 to 50 uses, exactly one default) or, with null, removes it; writes `audit_log` (`company.use_hazard_map_changed` with the version, what it was and what it is; `company.use_hazard_map_reset` with what was removed) in the same transaction. Saving the same mapping again writes and records nothing.
  - `public.zones` gains `hazard` (the class the zone keeps; null on older zones).
- [x] Company → 4541 settings (`/company/4541`, `src/features/company/use-map-*.tsx`, in the Company nav): the mapping as an editable table (use name, hazard class, the default, remove), Add a use, Save mapping, and Use the platform default (asks first). Problems are shown at their row. `saveCompanyUseMap` / `resetCompanyUseMap` server actions.
- [x] `getUseHazardMap` resolves with the user's company: its own mapping when it has one, else the platform default, else the built-in JSON.
- [x] A zone keeps its hazard class (`zone.hazard` in the zone markup): set from the mapping when the zone is drawn and whenever a use is chosen. `zoneHazard` reads it first. The selected zone's figures say when the kept class differs from today's mapping, with Change to … (undoable) when the mapping still names the use.
- [x] Tests:
  - pgTAP `company_use_hazard_map.test.sql` (30): privileges; every refusal writes and records nothing; versions 1, 2, then 3 after a reset; members read their company's rows and the platform's; another company and the platform admin read none of it; nobody writes rows directly. `zones_view.test.sql` reads `hazard`.
  - Unit: `use-map.test.ts` (the save schema, kept class in the use list), `zone.test.ts` (kept class), `use-map-actions.test.ts`, `use-map-screen.test.tsx`, `sprinkler/actions.test.ts`, `sprinkler-panel.test.tsx`.
  - e2e `company-use-map.spec.ts`: the admin adds a use, makes it the default and saves; a member's new zone is that use and class from "Company mapping v1"; a member gets 404 on the settings; after the admin goes back to the platform default the member's saved zone still has its use and class and a new zone is Office (ELH); both audit rows.

## Dev Notes

- **D1, a zone now stores its hazard class.** Story 9.3 said the opposite ("a zone stores its use, not its hazard … a mapping change re-classes existing zones"). That cannot stand with this story's criterion that existing zones keep their use and hazard, so the class is kept on the zone from the moment its use is chosen. Zones drawn before this story hold no class and go on following the current mapping until a use is chosen for them; they were not backfilled.
- **D2, re-classing is the drafter's act.** When the mapping later gives a zone's use another class, the zone's figures say so and offer Change to …; nothing changes by itself. When the mapping no longer names the use, the zone keeps its class and the note says so (choose another use to re-class it).
- **D3, the company mapping replaces the platform default as a whole;** it is not merged with it. The settings start from the platform default, so a company that changes one row keeps the other seven, but a use the platform adds later does not appear in a company's own mapping.
- **D4, saved as a whole,** with Save mapping, not row by row: one audit row per change, holding the mapping before and after.
- **D5, versions count up per company** (1, 2, 3 …) and are never reused, also after going back to the platform default. The 4541 panel shows "Company mapping vN".
- **D6, a company's mapping is never a draft** (`verified` true): it is the company's own decision. The platform default keeps its draft mark until Story 10.13.
- **D7, Use the platform default removes the company's mapping** after a confirmation; the audit row keeps what was removed.
- **D8, 1 to 50 uses, exactly one default,** each use once whatever its case; names follow the existing use-name rule. The hazard classes are the four of NZS 4541 as before; the rule figures are not edited here (Story 10.13).
- **D9, only company admins open the settings** (404 for everyone else); members and viewers get the mapping through the 4541 panel. The platform admin cannot read or write a company's mapping.
- **D10, the panel reads the mapping once per visit:** a member sees a changed mapping after reloading the workspace.
