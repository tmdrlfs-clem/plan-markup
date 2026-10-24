# Story 3.8: Appearance themes

Status: done

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

- [x] **Task 1: Migration + RLS + server action** — new migration in `supabase/migrations/`, RLS/RPC per AC 3, types regenerated if the project does that, server action `setTheme` with Zod; DB tests.
- [x] **Task 2: Theme provider** — client store for the active theme, apply `data-theme` on the workspace root/html, localStorage fallback, SSR value from profile, no-flash handling within the existing CSP.
- [x] **Task 3: Settings → Appearance UI** — menu bar Settings entry (exists from Story 1.7/1.8 — wire it), radio selection with current theme checked, keyboard accessible.
- [x] **Task 4: Canvas/overlay tokens** — route all canvas and overlay colours through tokens, re-read on change, redraw overlays (not tiles) on theme switch.
- [x] **Task 5: Contrast + tests** — token values finalised for Daylight and High contrast (Blueprint already tuned), contrast unit tests, axe per theme, e2e `e2e/appearance-themes.spec.ts`; screenshots of L17 in all three themes to `fixtures/private/traces/3-8-theme-<name>.png` (never commit private files).

### Review Follow-ups (AI)

Adversarial review 2026-10-24 (Claude Opus 5.5) of its own diff 1fbec72..5f89519. Checked: RLS and the column-limited update, the server action boundary, CSP (no pre-paint script was added), the no-flash SSR path, contrast pairs (including ones not yet listed: input boundaries on surface-2 pass at 3.09 / 3.32 / 4.27), the canvas token re-read and background tabs, portals, StrictMode effects, and AC coverage.

- [x] **[Medium] T1: Pending and deactivated users can still write their profile (now the theme).** `profiles_update_self` predates the Story 1.5 rule that every data policy ANDs `app.fn_is_active_user()` (FR5); the new column grant makes one more column writable through it, so a deactivated account can PATCH `/rest/v1/profiles` for its theme (and name). The app never offers it, but RLS is the boundary. Fix: a new migration recreates the policy with `(select app.fn_is_active_user())` in USING and WITH CHECK; `profiles_select_self` stays (pending users read their status). pgTAP: a pending and a deactivated user each update 0 rows; an active one still can.
- [x] **[Medium] T2: Shipping the code before the migration would lock everyone out.** `getOwnProfile` now names `theme` in its select; against a database without the column every profile read errors, `readAuthState` fails closed, and no one can open the workspace (the remote database is deliberately not migrated yet). A cosmetic column must not be able to do that. Fix: the theme is read tolerantly (an absent or unknown value is Blueprint) without touching the fail-closed status read; unit test with a profile row that has no theme. Deployment note added: migrate before deploying.
- [x] **[Low] T3: Another open workspace tab of the same user keeps the old theme.** The choice reaches only the tab it was made in until a reload. Fix: the workspace follows `storage` events of `pm.theme.v1` (the copy written on every choice), like the snap toggles (3.7 R6).
- [x] **[Low] T4: Portals were not proven to follow the theme.** Menus, tooltips and toasts render outside the workspace root and rely on `<html data-theme>`; the e2e only checked the attribute. Fix: the e2e opens the Appearance submenu in each theme and checks the menu's computed background is that theme's surface.
- Accepted, not changed: before hydration `<html>` (and so the body behind the full-screen workspace root, and the document's color-scheme) is Blueprint for a few frames; nothing of it is visible because the root covers the viewport and sets its own color-scheme. Setting it on the server would need the root layout to know the route.

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI for the implementation (5f89519): CI run **40031313793** success, Database run **40031313791** success.
- Review fixes (T1-T4), local: typecheck, lint, build clean; `npm test` 1417 unit tests in 126 files; `supabase test db` PASS (new: pending and deactivated users update 0 rows; `profiles_name_length.test.sql` now activates its user first); `check:rls` OK; e2e on the production build 44 passed, 7 skipped (private opt-in). Review commit 3454774: CI run **40052680967** success, Database run **40052680982** success.

- Local: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` (all unit tests, Docker running); `supabase test db` incl. the new `profiles_theme.test.sql`; `npm run check:rls` OK; `npm run db:types` / `db:schema` regenerated (`types.gen.ts`, `schema.sql`).
- e2e on the production build (`E2E_PROD=1`, workers 1, local Supabase after `npm run db:reset` for the new seeded user): all passed, opt-in private checks skipped. `appearance-themes.spec.ts` passed on its first run; axe-core (`@axe-core/playwright` 4.13.0) found no serious or critical violation in any theme. (`security-headers` failed once only because `NEXT_PUBLIC_SUPABASE_URL` was not exported for the remapped local ports; passes with it.)
- Local private check `PERF_L17=1 … perf-themes` (L17 at 188 % with search highlights): switching Blueprint → Daylight → High contrast, longest main-thread task **0 ms**, pending tiles after each switch **0, 0, 0** (nothing re-rendered). Screenshots `fixtures/private/traces/3-8-theme-blueprint.png`, `-daylight.png`, `-contrast.png` reviewed: chrome, panels, status bar and highlights follow the theme; the sheet stays white. Not committed.
- Supabase ran on locally remapped ports 583xx (Windows reserved 55956-57055); `config.toml` / `.env.local` restored afterwards, never committed. The remote database was not migrated.

### Completion Notes List

- **Task 1 (migration, RLS, action).** `20261024090000_profiles_theme.sql`: `profiles.theme text not null default 'blueprint'` with `profiles_theme_check`, and `grant update (theme)` to `authenticated`. The existing `profiles_update_self` policy limits the rows, the column grants limit the columns to name and theme: no SECURITY DEFINER function, so NFR22 does not apply. pgTAP `profiles_theme.test.sql`: not null, default, new users get Blueprint, the check rejects other values and null, user A changes their own theme, A's update of B's theme changes 0 rows, a theme update cannot carry another column, anon is refused, B unchanged; `profiles_rls.test.sql` now asserts "name and theme only". `setTheme` server action (`src/features/appearance/actions.ts`): `getAuthUser()` (never an id from the input), Zod `ThemeSchema`, `Result` with safe messages; unit-tested. The profile read and `AuthUser` carry `theme` (an unknown stored value reads as Blueprint).
- **Task 2 (theme on the client).** `src/lib/theme.ts` (themes, labels, schema; shared by server and client; `tokens.ts` re-exports it). The workspace page passes the profile's theme to the shell, which renders it as `data-theme` on its root: the first paint is already right. `useWorkspaceTheme` applies the theme to `<html>` too (portals and the canvas token bridge follow it) and puts Blueprint back when the workspace unmounts; `chooseTheme` switches at once, keeps a copy in localStorage, saves on the profile, and on failure puts the previous theme back with an error toast (a newer choice is never undone by an older failure).
- **Task 3 (menu).** Settings > Appearance: a submenu of three radio items (Blueprint, Daylight, High contrast) with the current one checked; keyboard: Enter / arrows / Enter (unit test). Replaces the disabled "Theme" placeholder.
- **Task 4 (canvas tokens).** New per-theme tokens `--canvas-backdrop`, `--canvas-zoom-rect`, `--canvas-failed-fill`, `--canvas-failed-stroke`. The engine reads its whole palette (backdrop, search highlights, Zoom rubber band, failed-tile hatch) from the canvas element's tokens (`viewerPalette`; Blueprint's values only for unreadable tokens, kept equal to globals.css by a test), drops it on every theme change and redraws from the bitmaps in memory: no tile or preview is requested again (jsdom test with a real MutationObserver). The sheet stays white (`SHEET`, the only colour literal the new guard test allows in viewer and workspace code).
- **Task 5 (contrast, tests).** Contrast pairs for every canvas overlay against the sheet and the backdrop (selection outline, rubber band, failed hatch, snap on the backdrop), the status warning on hover and on the status bar, the accent on the status bar, and the current search hit's outline against its own fill over the sheet. Two real failures fixed: Daylight's backdrop (rubber band 2.98:1 → lighter backdrop `#d9dbdf`) and Daylight's warning text on surface-3 (4.41:1 → `#7a5d00`). `e2e/appearance-themes.spec.ts`: all three themes from the menu with real clicks, the canvas backdrop pixel per theme, axe per theme, the profile's choice in the server-rendered HTML and after a reload, the sign-in page Blueprint with localStorage saying Daylight. `e2e/perf-themes.spec.ts` (local, private).

**Decisions and deviations (for review):**

1. **No pre-paint script.** The workspace is always server-rendered with the signed-in user's profile, so its theme is in the HTML; sign-in and PendingActivation are Blueprint by the scope rule. An inline script would only serve a case that cannot occur and would need a CSP nonce/hash: none was added, `src/proxy.ts` is unchanged. localStorage is the fallback when no profile value is known (and the browser's copy).
2. **Column grant instead of an RPC.** The self-update policy plus `grant update (theme)` is the column-limited update AC 3 allows; there is no SECURITY DEFINER code to secure.
3. **Radio items in a submenu, not a dialog** (AC 1 offered both): one click, the state visible, Story 1.7 MenuBar parts.
4. **A dedicated seeded user** `theme@plan-markup.test` for the themes e2e, so parallel specs signed in as other users never see a changed theme (seed only; local and CI).
5. **Search highlight fills are not a 3:1 boundary.** They are translucent so the drawing's text stays readable under them (founder decision 2026-10-24, yellow); the current hit is identified by its dark outline, checked at 3:1 against its fill over the sheet in every theme.
6. **High contrast**: the existing 2 px focus ring (with a 2 px gap) applies to all themes; warnings keep their icon, the snap toggles `aria-pressed` and their pressed bar; verified in the screenshots.
7. **Admin and marketing stay Daylight** (AC 4): neither exists yet; nothing to wire. Only the workspace follows the profile.
8. Tasks 2 and 3 are one commit (the shell and the menu props change together).
9. New dev dependency `@axe-core/playwright` 4.13.0 (exact pin, released 2026-08-11).

### File List

- `supabase/migrations/20261024090000_profiles_theme.sql`, `supabase/tests/profiles_theme.test.sql` (new); `supabase/tests/profiles_rls.test.sql`, `supabase/seed.sql`, `supabase/schema.sql` (modified)
- `src/lib/theme.ts` (new); `src/lib/db/profiles.ts`, `src/lib/db/types.gen.ts`, `src/lib/auth/get-auth-user.ts`, `get-auth-user.test.ts` (modified)
- `src/features/appearance/actions.ts`, `actions.test.ts`, `theme-store.ts`, `theme-store.test.tsx` (new)
- `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx`, `workspace-menu-bar.tsx`, `src/app/(workspace)/workspace/page.tsx` (modified)
- `src/app/globals.css`, `src/components/ui/tokens.ts`, `token-names.ts`, `contrast-pairs.ts`, `contrast.test.ts` (modified); `src/components/ui/viewer-palette.test.ts` (new)
- `src/features/viewer/viewer-engine.ts` (modified); `src/features/viewer/canvas-colors.test.ts`, `viewer-engine-theme.test.ts` (new)
- `e2e/appearance-themes.spec.ts`, `e2e/perf-themes.spec.ts` (new); `package.json`, `package-lock.json` (modified)

### Change Log

- 2026-10-24: Story 3.8 implemented (Claude Opus 5.5): profile theme with column-limited RLS, Settings > Appearance, canvas palette from tokens, contrast pairs, axe per theme. Status → review. Commits 1fbec72, 5526a10, e7f6e2c and the Task 5 commit.
- 2026-10-24: Review (Claude Opus 5.5) T1-T4 fixed with tests: migration `20261024100000_profiles_update_active_only.sql` (profile updates only by active users, FR5), tolerant theme read (no lockout if code ships before the migration; deploy note: migrate first), theme followed across tabs, portals checked per theme in the e2e. Status → done.
