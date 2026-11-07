# Story 8.5: M1 release readiness

Status: in-progress (in-repo work done; the cloud setup in docs/release.md waits on the founder's accounts)

## Story

As the founder,
I want the M1 workspace deployed and verified end to end,
so that pilots can do as-built work for 5 days without Revu.

## Acceptance Criteria

1. **Release pipeline (AR22, NFR35, NFR46):** the app deploys to Vercel (`syd1`) with Supabase cloud (ap-southeast-2), migrations applied by CI `supabase db push`, and Sentry receiving errors.
   - `release.yml` and `vercel.json` are in the repo.
   - **Open:** the projects, secrets, Sentry DSN and first deploy (docs/release.md steps 1–5, 7).
2. **Shortcuts list (UX-DR35):** Settings → Keyboard shortcuts (and Help → Keyboard shortcuts) lists the basic set, view-only, in the UX spec table's order, with only the keys M1 binds. Done.
3. **Keyboard-only and axe (UX-DR39):** a keyboard-only Playwright test completes open → calibrate → measure → stamp → flatten/export (`e2e/keyboard-only.spec.ts`). axe-core finds no serious or critical violation on the workspace chrome. Done.
4. **Viewport matrix:** 1280×720, 1440×900, 1920×1080 and 2560×1440@2x pass the smoke (`e2e/viewport-matrix.spec.ts`). Done.
5. **Uptime monitoring with alerts (NFR38):** `/api/health` is in place (200 ok / 503 degraded, public, no-store). **Open:** the monitor itself (docs/release.md step 6).
6. **Security review (NFR36):** `docs/security-review-m1.md` has no open High findings. M1 (protect the production environment) is set with the environment.

## Tasks / Subtasks

- [x] **Shortcuts:** `ShortcutsDialog` (`SHORTCUTS` table), opened from the Settings and Help menus. Every listed key was checked against its binding.
- [x] **Keyboard placement:** the viewer's keyboard pointer. With a point-placing tool and the canvas focused, the arrows move it (4 px, Shift ×10) with snapping and the status bar X/Y. Enter places a point; Enter again finishes; Esc or a mouse move ends it.
- [x] **Rail a11y fix:** ArrowUp/Down on a flyout's "More" button now move along the rail instead of opening the menu and trapping keyboard users. ArrowLeft, Enter or Space open the menu.
- [x] **Layout fix:** the tool rail no longer overflows the window by 1 px (its `aside` is `box-content`).
- [x] **Health:** `/api/health` (public path in `proxy.ts`), with unit tests and a smoke e2e.
- [x] **Pipeline:** `.github/workflows/release.yml` (migrate → deploy → verify; each job skips until its secrets exist), `vercel.json` (`syd1`, Git deploys of `main` off), and `docs/release.md`.
- [x] **Security review:** `docs/security-review-m1.md`.
- [ ] **Cloud setup and first production release** (docs/release.md): Supabase project, Vercel project, GitHub environment and secrets, Sentry, uptime monitor, first admin.
- [ ] **Verify in production:** sign in, open → calibrate → measure → stamp → export, Sentry event received, monitor green.

## Dev Agent Record

### File List

- src/features/workspace/shortcuts-dialog.tsx (new), workspace-menu-bar.tsx, workspace-shell.tsx, workspace-shell.test.tsx, tool-rail.tsx
- src/features/viewer/viewer-input.ts, viewer-input.test.ts
- src/app/api/health/route.ts (new), route.test.ts (new); src/proxy.ts
- e2e/keyboard-only.spec.ts (new), e2e/viewport-matrix.spec.ts (new), e2e/smoke.spec.ts
- .github/workflows/release.yml (new), vercel.json (new), docs/release.md (new), docs/security-review-m1.md (new)
