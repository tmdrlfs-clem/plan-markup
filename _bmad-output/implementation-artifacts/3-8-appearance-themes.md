# Story 3.8: Appearance themes

Status: ready-for-dev

## Story

As a user,
I want to choose Blueprint, Daylight or High contrast,
so that the workspace suits my eyes and my room.

## Acceptance Criteria

1. **Given** Settings → Appearance from the menu bar, **when** I pick a theme (Blueprint, Daylight, High contrast — radio items in a Story 1.7 Menu or a small Appearance dialog with a `Select`/radio group; decide and record), **then** the workspace chrome AND canvas overlays (selection, snap glyph colour, search highlights from 3.6, hint bar, status warnings, thumbnail current-page border, tab strip) switch immediately without reload; Blueprint is the default (FR69, UX-DR3).
2. Canvas renderers read colours through `src/components/ui/tokens.ts` (or the existing token bridge) and re-read on theme change; no hard-coded colours remain in canvas/overlay code (lint or unit test guards it). The PDF sheet itself is never recoloured (white sheet stays white in every theme).
3. **Persistence:** the choice is stored on the profile — migration adds `profiles.theme text not null default 'blueprint' check (theme in ('blueprint','daylight','contrast'))`; RLS lets a user update only their own `theme` (self-update policy limited to that column, or a `SECURITY DEFINER` RPC with fixed `search_path`, caller check and EXECUTE revoked from `anon`/`public` — NFR22); Zod validates the value at the server action boundary. Before sign-in (and while the profile loads) the theme comes from `localStorage` (try/catch, safe default). The server renders `<html data-theme>` from the profile when available so there is no flash of the wrong theme; otherwise an inline pre-paint script reads localStorage (CSP-compliant: nonce/hash per Story 1.6 — check `src/proxy.ts`).
4. Scope rules (UX-DR3, decision 2026-10-20): sign-in and PendingActivation stay Blueprint; admin and marketing stay Daylight; only the workspace follows the user's choice.
5. **Contrast:** automated checks pass for all three themes — text ≥ 4.5:1, UI components and canvas overlays ≥ 3:1 against both the chrome and the white sheet (NFR43): extend `src/components/ui/contrast-pairs.ts` / `contrast.test.ts` with every new pair (search highlight, current hit, warning item, selection), and axe-core in the Playwright workspace check runs once per theme with no serious/critical violations.
6. High contrast is a real accessibility theme: near-black chrome, white text, thick (2 px) focus rings, no information by colour alone; verify the warning/scale/snap states read correctly in it.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; DB tests (pgTAP or the existing RLS smoke tests) cover the theme column, default, check constraint and that user A cannot change user B's theme; CI e2e (production build) covers switching all three themes from the menu, persistence across reload (profile), localStorage fallback on the sign-in page not changing its Blueprint look, and canvas overlay colours changing (e.g. a `data-*` attribute or computed token read).

## Tasks / Subtasks

- [ ] **Task 1: Migration + RLS + server action** — new migration in `supabase/migrations/`, RLS/RPC per AC 3, types regenerated if the project does that, server action `setTheme` with Zod; DB tests.
- [ ] **Task 2: Theme provider** — client store for the active theme, apply `data-theme` on the workspace root/html, localStorage fallback, SSR value from profile, no-flash handling within the existing CSP.
- [ ] **Task 3: Settings → Appearance UI** — menu bar Settings entry (exists from Story 1.7/1.8 — wire it), radio selection with current theme checked, keyboard accessible.
- [ ] **Task 4: Canvas/overlay tokens** — route all canvas and overlay colours through tokens, re-read on change, redraw overlays (not tiles) on theme switch.
- [ ] **Task 5: Contrast + tests** — token values finalised for Daylight and High contrast (Blueprint already tuned), contrast unit tests, axe per theme, e2e `e2e/appearance-themes.spec.ts`; screenshots of L17 in all three themes to `fixtures/private/traces/3-8-theme-<name>.png` (never commit private files).

## Dev Notes

- Tokens already exist under `[data-theme="blueprint" | "daylight" | "contrast"]` in `src/app/globals.css`; `src/components/ui/{tokens,theme-css,contrast,contrast-pairs}.ts` exist from Story 1.7. `src/app/(auth)/layout.tsx` pins Blueprint (690965c). Profiles/RLS from Story 1.3 (`supabase/migrations/20261017024840_profiles_and_app_helpers.sql`); follow its patterns (`fn_is_active_user`, JWT helpers) and the Postgres 17.6.1.155 pin (ADR 0002).
- Read the 3.6 and 3.7 story files including review follow-ups (search highlight colour token is new in 3.6 fixes).
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.8]; FR69, UX-DR3, NFR22, NFR43
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] themes (lines ~356–376), Accessibility (~823–838)
- [Source: _bmad-output/implementation-artifacts/3-7-status-bar-with-page-size-scale-snap-cursor-and-zoom.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
