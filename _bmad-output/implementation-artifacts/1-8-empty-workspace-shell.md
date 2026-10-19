# Story 1.8: Empty workspace shell

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in user,
I want to see the workspace layout with an inviting empty state,
so that I know where everything is and how to start, without needing a company.

## Acceptance Criteria

1. **Given** I am signed in (with or without a company, FR3), **when** `/workspace` loads, **then** I see, top to bottom: a 24 px menu bar (File, Edit, View, Document, Tools, Window, Settings, Help) with the account menu at its right end, two 36 px toolbar rows, then a middle band with the left 44 px icon rail + collapsible resizable left panel (default 280, 220–420 px), the canvas area, and the right 44 px ToolRail; below it a collapsible resizable bottom panel (Markups, default 200 px, 120–480 px) and a 24 px status bar (UX-DR5).
2. The canvas area shows **EmptyWorkspace**: a drop zone with the heading "Drop a PDF here or Open…", an **Open** button (also File › Open… and `Ctrl+O`), and a "Recent drawings" section whose empty state reads "No recent drawings" (UX-DR30). Picking or dropping a PDF calls a single `openFiles(files)` handler; until the viewer exists (Epic 3) it shows the info toast "Opening drawings arrives with the viewer." Dropping a non-PDF shows the warning toast "Only PDF files can be opened." The drop zone shows a visible drag-over state (outline + text, not colour only).
3. Panel collapsed state, sizes and the active left panel are remembered **per user** in `localStorage` (key `pm.workspace.layout.v1.<userId>`), validated with Zod on read; a missing, corrupt or unavailable store falls back to the defaults without an error. After a reload the layout comes back as I left it.
4. Defaults when nothing is stored (UX-DR37): viewport width ≥1440 → left panel and bottom panel open; <1440 → both collapsed (icon rails stay); viewport height <800 → bottom panel collapsed.
5. Landmarks: `header` (banner) holds the menu bar and toolbars; the left icon rail is a `nav` "Panels"; the open left panel, the ToolRail and the bottom panel are `aside` (complementary) with their names; the canvas area is `main`; the status bar is a `footer` (contentinfo) containing a `role="status"` region. **F6 / Shift+F6** move focus to the next / previous region in this order: menu bar → toolbar → panel rail → left panel (if open) → canvas → ToolRail → bottom panel (if open) → status bar, wrapping around. F6 does nothing while a menu, popover or dialog is open. All chrome is keyboard reachable with the visible focus ring (NFR43).
6. Below 1280 px viewport width a dismissible banner says "Plan Markup is designed for screens 1280 px or wider" (UX-DR37). It sits above the menu bar, does not cover the canvas, and once dismissed stays hidden for the browser session (`sessionStorage`).
7. ToolRail buttons render grouped (Select/Pan · Markup · Measure · White-out · 4541, UX-DR6) as a vertical `Toolbar` of ToggleButtons, all disabled with the tooltip "Open a drawing first". Toolbar row 1 shows document/view commands with Open enabled and the rest disabled with the same reason; toolbar row 2 is the tool-options strip with the muted text "Select a tool to see its options".
8. Sign out moves into the File menu (last item, after a separator) and the account menu (which also shows my name or email). The old header `UserMenu` is removed. The PendingActivation screen keeps its own Sign out button.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; Playwright e2e covers AC 1–8 (see Task 9) and the existing auth e2e is updated to sign out through the File menu.

## Tasks / Subtasks

- [x] **Task 1: Breakpoints and feature folder** (AC: 4, 6)
  - [x] Add `--breakpoint-ws-min: 1280px`, `--breakpoint-ws-md: 1440px`, `--breakpoint-ws-lg: 1920px` to the `@theme` block in `src/app/globals.css` (UX spec → Breakpoint Strategy). Keep Tailwind's default `sm/md/lg`.
  - [x] New feature folder `src/features/workspace/` (shell, layout store, region cycling, empty state). It must not import other features (architecture: features talk via the store and `lib`), except `@/features/account/actions` for `signOut` (account owns auth actions).
- [x] **Task 2: Layout store and persistence** (AC: 3, 4)
  - [x] `layout-store.ts`: `createLayoutStore(userId)` → zustand **vanilla** store with `{ left: { collapsed, size, active: LeftPanelId }, bottom: { collapsed, size } }` and actions `setLeftCollapsed`, `setLeftSize`, `showLeftPanel(id)` (opens and activates; calling it for the already active, open panel collapses it — Revu rail behaviour), `setBottomCollapsed`, `setBottomSize`, `hideAllPanels()`.
  - [x] `LeftPanelId = "tool-chest" | "measurements" | "sprinkler" | "thumbnails" | "properties" | "layers"`; default `active` = `"tool-chest"`.
  - [x] `layout-persistence.ts`: `loadLayout(userId, viewport)` / `saveLayout(userId, layout)`. Zod schema `{ v: 1, left: {...}, bottom: {...} }`, sizes clamped to bounds on read. Every storage access in try/catch (private mode / blocked storage). Writes are debounced (200 ms) so a drag does not write on every pointer move. `defaultLayout({ width, height })` implements AC 4 and is a pure, unit-tested function.
  - [x] Hydration: the server renders with panels collapsed (no `window`); the client loads the stored/default layout in a `useLayoutEffect` on mount. Accept the one-frame change; do not block rendering on it. Profile-backed settings replace `localStorage` in a later story.
  - [x] Unit tests (node env): defaults for 1920×1080, 1440×900, 1366×768, 1280×720, 1920×760; corrupt JSON / wrong version / out-of-range sizes; `showLeftPanel` toggle rule; `hideAllPanels`.
- [x] **Task 3: Workspace shell layout** (AC: 1, 5)
  - [x] `workspace-shell.tsx` (`"use client"`): CSS grid filling the viewport (`h-dvh`, no page scroll): rows `auto` (banner) / 24 px menu bar / 36 px / 36 px / `1fr` middle / bottom panel `auto` / 24 px status bar. Middle band is a flex row: 44 px rail · left `Panel` · canvas (`min-w-0 flex-1`) · 44 px ToolRail. Mount `TooltipProvider` and `Toaster` once here.
  - [x] Use the Story 1.7 `Panel` for the left (`side="left"`, `role="complementary"` — Panel renders a `section` with the given role) and bottom (`side="bottom"`) panels, controlled from the layout store. Surfaces: chrome `bg-surface-1`, canvas area `bg-surface-0`, 1 px `border-border` separators.
  - [x] `src/app/(workspace)/workspace/page.tsx` stays a server component: it calls `requireActiveUser("/workspace")` (NFR13, unchanged) and renders `<WorkspaceShell user={{ id, name, email }} />`. Pass only those three fields to the client.
- [x] **Task 4: Menu bar and account menu** (AC: 1, 8)
  - [x] `workspace-menu-bar.tsx` with Story 1.7 `MenuBar*` components. Items (shortcut strings from the UX shortcut table; everything not listed as enabled is `disabled`):
    - File: Open… `Ctrl+O` (enabled) · Save `Ctrl+S` · Save as… `Ctrl+Shift+S` · Print… `Ctrl+P` · Flatten… `Ctrl+Shift+M` · Export… · separator · **Sign out** (enabled).
    - Edit: Undo `Ctrl+Z` · Redo `Ctrl+Y` · separator · Copy `Ctrl+C` · Paste `Ctrl+V` · Delete `Del` · Select all `Ctrl+A`.
    - View: Zoom in `+` · Zoom out `-` · Fit page `Ctrl+9` · Fit width `Ctrl+0` · separator · checkbox items for the six left panels and "Markups list" (enabled, bound to the layout store) · Hide all panels `Shift+F4` (enabled).
    - Document: Rotate pages… · Insert pages… · Delete pages… · Page labels…
    - Tools: Calibrate… · Tool Chest · 4541 zones.
    - Window: the same panel checkbox items as View (Revu keeps them in Window; both are fine and share one component).
    - Settings: Keyboard shortcuts… · Theme (disabled until a settings story).
    - Help: Keyboard shortcuts · About Plan Markup.
  - [x] Disabled menu items need no reason text (Radix disabled items are skipped by arrows); only buttons use `disabledReason`.
  - [x] `account-menu.tsx`: a `Menu` whose trigger is a ghost button showing the name (fallback email) with `aria-label="Account: <name or email>"`; content: `MenuLabel` with the email, separator, Sign out.
  - [x] Sign out from a menu item calls the existing `signOut` server action inside `startTransition` (it redirects to `/sign-in`). Delete `src/features/account/user-menu.tsx` and its usage.
- [x] **Task 5: Toolbars and ToolRail** (AC: 7)
  - [x] `workspace-toolbar.tsx`: row 1 `Toolbar aria-label="Document"`: Open (enabled, `FolderOpen`), Save, Print, separator, Undo, Redo, separator, Zoom out, Zoom in, Fit page, Fit width — disabled ones use `disabledReason="Open a drawing first"`. Row 2 `Toolbar aria-label="Tool options"` with the muted placeholder text (the text is not a toolbar item; if Radix Toolbar needs at least one focusable child, render the text outside the toolbar and leave row 2 as a plain `div`).
  - [x] `tool-rail.tsx`: vertical `Toolbar aria-label="Tools" orientation="vertical"` with `ToolbarToggleGroup type="single"` groups separated by `ToolbarSeparator`: Select `V`, Pan `Shift+V` · Line `L`, Arrow `A`, Rectangle `R`, Ellipse `E`, Cloud `C`, Text box `T`, Pen `P`, Highlight `H`, Stamp `S` · Length `Shift+Alt+L`, Area `Shift+Alt+A`, Count `Shift+Alt+C` · White-out `Shift+W` · Sprinkler zone `J`. All `disabled` with `disabledReason="Open a drawing first"`. If the rail is taller than the viewport, it scrolls (`overflow-y-auto`), never clips.
  - [x] Tool shortcuts are **displayed** but not bound (tools arrive in later epics); since all tools are disabled the tooltip shows the reason, not the shortcut (existing IconButton behaviour).
- [x] **Task 6: Left rail, panels, bottom panel, status bar** (AC: 1, 3, 5)
  - [x] `panel-rail.tsx`: `nav aria-label="Panels"` with a vertical `Toolbar` of ToggleButtons, one per `LeftPanelId`: Tool Chest `Alt+X`, Measurements `Alt+U`, 4541 `Alt+4`, Thumbnails `Alt+T`, Properties `Alt+P`, Layers `Alt+Y`. Pressed = that panel is open and active. Click → `showLeftPanel(id)`.
  - [x] Left `Panel` title = the active panel's name; body = that panel's empty state (one line + muted hint), e.g. Tool Chest "No tool sets yet" / "Import a Revu tool set (.btx) once a drawing is open."; Thumbnails "No drawing open"; Properties "Nothing selected"; Measurements "No measurements yet"; Layers "No layers yet"; 4541 "Open and calibrate a drawing to place sprinklers." Strings live in one `panel-registry.ts` (id, title, icon, shortcut, empty text).
  - [x] Bottom `Panel` title "Markups", body "Markups you add appear here."
  - [x] `workspace-status-bar.tsx`: `footer` with a `role="status"` `aria-live="polite"` region; left `StatusBarItem` "No drawing open". Leave the fixed-order slots (pager, scale, snap, cursor, zoom, save — UX-DR7) as comments only; later stories fill them.
- [x] **Task 7: Keyboard: regions and shortcuts** (AC: 2, 5)
  - [x] `use-region-cycling.ts`: one `keydown` listener on `window` for `F6` / `Shift+F6`. Regions are elements with `data-region="<name>"` in DOM order (skip hidden/collapsed ones). Move focus to the region's first tabbable element, else to the region itself (`tabIndex={-1}`, focus ring visible). Ignore the key while `document.activeElement` is inside `[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]`. `preventDefault` (F6 is the browser's address-bar key).
  - [x] Bind these shortcuts in one `use-workspace-shortcuts.ts` (no general registry yet; the editor store story brings that): `Ctrl+O` (Open, `preventDefault` to suppress the browser's open-file), `Alt+X/U/4/T/P/Y` (show panel), `Alt+L` (toggle Markups list), `Shift+F4` (hide all panels). Ignore them while focus is in an editable element (`input`, `textarea`, `select`, `[contenteditable]`) except `Ctrl+O`. Use `event.code` for the `Alt+` digit/letter keys (macOS turns `Alt+X` into "≈" in `event.key`).
  - [x] Panel rail and menu items display exactly the shortcuts this task binds.
- [x] **Task 8: EmptyWorkspace and narrow banner** (AC: 2, 6)
  - [x] `empty-workspace.tsx`: centred card (no large radius, `rounded-lg` max) with `FileUp` icon, heading "Drop a PDF here or Open…" (`h1`, workspace scale `text-ws-xl`), Open primary `Button`, then "Recent drawings" (`h2`) + list (`ul`) from a `recent: { id, name }[]` prop — empty now → "No recent drawings". The whole `main` is the drop target: `dragenter/dragover/dragleave/drop` with a counter for nested `dragleave`; drag-over = dashed `border-accent` outline + text "Drop to open" (shape + text, not colour only). Hidden `<input type="file" accept="application/pdf,.pdf" multiple>` behind Open.
  - [x] `openFiles(files: File[])`: PDFs (by MIME `application/pdf` or `.pdf` extension) → info toast (AC 2); none → warning toast. No file content is read.
  - [x] `narrow-banner.tsx`: shown when `window.innerWidth < 1280` (listen to `resize` via `matchMedia("(max-width: 1279.98px)")`), `role="region" aria-label="Screen size notice"` with info icon + text + Dismiss `IconButton` ("Dismiss notice"). Dismissal in `sessionStorage` (try/catch).
- [x] **Task 9: Tests** (AC: 9)
  - [x] Vitest + Testing Library (jsdom) for: layout store/persistence (Task 2), region cycling order with collapsed panels skipped and the menu-open guard, shortcuts (editable-element guard, `Ctrl+O` exception, `event.code` for `Alt+4`), EmptyWorkspace (Open input, PDF vs non-PDF drop → toasts, drag-over state), panel rail toggle rule, ToolRail all disabled with reason tooltips, account menu shows name/email.
  - [x] Playwright `e2e/workspace-shell.spec.ts` (signed in as the active seed user, viewport 1920×1080 unless stated): landmarks present (banner, nav "Panels", main, contentinfo, complementary "Tools"); menu bar has the 8 menus in order; F6 cycles through regions and Shift+F6 back; collapsing the left panel and resizing the bottom panel survive a reload; at 1366×768 panels start collapsed (fresh storage); at 1200×800 the banner appears and Dismiss hides it until a new session; a ToolRail button shows "Open a drawing first" on hover/focus; Sign out via File menu and via the account menu both land on `/sign-in`.
  - [x] Update `e2e/auth.spec.ts` "sign out ends the session" to sign out through File › Sign out. `security-headers.spec.ts` must stay green (no new inline styles beyond Radix positioning / Panel sizes, which `style-src-attr` allows).

## Dev Notes

### Context

This is the last story of Epic 1. It composes the Story 1.7 components into the real workspace frame that every later epic fills in: Epic 3 replaces EmptyWorkspace with the viewer, the editor store story replaces the local shortcut hook with the command registry, and status bar items arrive with their features. Keep the shell **dumb**: layout + empty states only, no drawing or editor state.

### Facts carried from earlier stories (must follow)

- Language: all code, comments, UI text, test names and commits in English.
- Tests co-located; DOM tests start with `// @vitest-environment jsdom` and import `@/test/radix-jsdom` when they use Radix.
- Use the Story 1.7 components only (no raw styled controls in features): `MenuBar*`, `Menu*`, `Toolbar*`, `ToggleButton`, `IconButton`, `Panel`, `StatusBarItem`, `Button`, `Tooltip(Provider)`, `Toaster` + `toast()`. Import each from `@/components/ui/<name>` (no barrel).
- Icons: `lucide-react` only (lint-enforced). Pick plain icons (e.g. `MousePointer2`, `Hand`, `Slash`, `ArrowUpRight`, `Square`, `Circle`, `Cloud`, `Type`, `Pen`, `Highlighter`, `Stamp`, `Ruler`, `Pentagon`, `Hash`, `Eraser`, `Droplets`, `Wrench`, `Images`, `SlidersHorizontal`, `Layers`, `FolderOpen`, `Save`, `Printer`, `Undo2`, `Redo2`, `ZoomIn`, `ZoomOut`, `Maximize`, `MoveHorizontal`, `FileUp`, `Info`). Verify each name exists in lucide-react 1.58.0 before using it.
- Tokens / near-sharp: radii 2–4 px, hard shadows, `focus-ring`, `z-*` tokens, `text-ws-*` in the workspace. No blur, no large radii, no raw hex.
- Dialog Enter = primary is deferred one task; fields with a local Escape set `data-escape-local` (Story 1.7 review). Not needed here unless a dialog is added (none is).
- Toasts with an `action` never merge; plain info toasts with the same text merge into "×N" — that is the wanted behaviour for repeated drops.
- `requireActiveUser()` is called by the page itself (NFR13); the workspace layout's call is defence in depth. Do not change auth code.
- Server actions: `signOut` in `src/features/account/actions.ts` (Next's built-in action origin check applies). UI layers must not import `@supabase/*` / `@sentry/*`.
- CSP: `style-src-attr 'unsafe-inline'` allows inline `style` (Panel sizes); never inject `<style>` elements.
- Dev server port 3020 (`npm run dev`); local Supabase on 563xx (`npm run db:start`).

### Layout numbers

| Element | Size |
|---|---|
| Menu bar | 24 px, triggers `text-ws-md`, `px-3` |
| Toolbar rows | 2 × 36 px, buttons 28 px (`IconButton size="sm"`) |
| Icon rails (left panel rail, right ToolRail) | 44 px wide, buttons 32 px (`size="md"`), 6 px vertical gap |
| Left panel | default 280, min 220, max 420 |
| Bottom panel | default 200, min 120, max 480 |
| Status bar | 24 px, `text-ws-xs` |
| Canvas | the rest; at 1920×1080 with both panels open ≥1500×700 px (check in e2e: `main` bounding box) |

### Persistence format

```json
{ "v": 1,
  "left": { "collapsed": false, "size": 280, "active": "tool-chest" },
  "bottom": { "collapsed": false, "size": 200 } }
```

Key `pm.workspace.layout.v1.<userId>`. Unknown `active` → default. The banner dismissal uses `sessionStorage` key `pm.workspace.narrowBannerDismissed`.

### Out of scope (later stories)

- 1280–1439 px overlay panels and the toolbar "More" overflow (UX-DR37): toolbars have no real tools yet; the viewer/editor stories add them.
- Recent drawings data (IndexedDB local history, Epic 3/persistence).
- Tool activation, command registry, canvas focus and single-letter shortcuts.
- Theme switching UI and the Keyboard shortcuts dialog (Settings stories).
- axe-core in Playwright (UX testing strategy) — not added here; a dedicated accessibility CI story adds it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8: Empty workspace shell]; UX-DR5, UX-DR6, UX-DR7, UX-DR30, UX-DR37 (epics.md lines 202–204, 227, 234)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] Spacing & Layout Foundation, Special States, Custom Components → Workspace shell / Panels / Bottom panel, Navigation Patterns, Keyboard Shortcuts (MVP basic set), Responsive Strategy, Breakpoint Strategy, Accessibility Strategy
- [Source: _bmad-output/planning-artifacts/architecture.md] project tree (`src/features/*`, `(workspace)/layout.tsx`), feature boundaries, zustand vanilla store
- [Source: _bmad-output/implementation-artifacts/1-7-foundation-components.md] component APIs and review fixes
- [Source: _bmad-output/implementation-artifacts/1-5-sign-in-and-sign-out.md] sign-out action and e2e users

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), BMAD dev-story workflow, 2026-10-18.

### Debug Log References

Environment: Windows 11, Node v24.15.0, Docker Desktop, local Supabase.

1. `MenuBar` was 36 px (`h-9`) and its triggers 28 px; UX-DR5 says 24 px. Changed the component defaults (`h-6`, triggers `h-5 px-2`) instead of overriding: `cx` cannot override a same-property utility (Tailwind v4 orders them by name, see the 1.7 review). The same reason made the account menu trigger a plain `button` with `MENU_TOP_TRIGGER` rather than a resized `Button`.
2. jsdom counts the Panel `<header>` as a banner (browsers scope it to its section); the unit test picks the banner that contains the menubar. Playwright sees one banner.
3. F6: the status bar has no tabbable item yet, so `footer` got `tabIndex={-1}` and `focus-ring`. The bottom panel was first a region in both states; the code review moved it to AC 5 (an F6 stop only while open; Tab still reaches Expand when collapsed).
4. e2e: `npm run db:start` failed twice with `HealthCheckTimeoutError` (analytics/logflare unhealthy right after Docker Desktop started). Started with the CI flags instead: `supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor`.
5. e2e on this machine (Docker starting, cold Turbopack): sign-in POSTs took ~5 s and the first `/workspace` 3–20 s, so existing auth tests failed on the 5 s expect timeout too. Ran locally with a scratch config outside the repo (repo config + `workers: 1`, `timeout: 90 s`, `expect: 20 s`); the repo config is unchanged.
6. Tooltip e2e: in real Chromium, consecutive `hover()` calls alternately did and did not open Radix tooltips (Playwright moves the mouse in one jump, which can leave Radix's pointer-in-transit flag set). The e2e checks the disabled-tool tooltip through keyboard focus; hover is covered by the IconButton unit tests. Not seen with a real mouse.
7. The old placeholder heading "Workspace" was asserted by `auth.spec.ts` and `security-headers.spec.ts`; both now wait for the "Main menu" menubar.
8. The workspace e2e signs in as `admin@plan-markup.test` once (shared `storageState`, serial mode) plus once per sign-out test, to stay inside the per-email sign-in rate limit used by `auth.spec.ts`.
9. Unit tests under full-suite load (Docker running) timed out at 5 s; after quitting Docker: 743/744, the one failure a 5 s timeout of the two-render persistence test, so `workspace-shell.test.tsx` sets `testTimeout: 20_000`. Runs: `npm run typecheck` clean; `npm run lint` clean; `npm run build` OK; feature unit tests 36 passed; Playwright full suite (scratch config) 25 passed + `security-headers.spec.ts` 6/6 on rerun (one `networkidle` timeout on `/sign-in` under load, unrelated page). Screenshot at 1920×1080 checked by eye: layout, empty state, View menu.

### Completion Notes List

- Files under `src/features/workspace/`; only `@/features/account/actions` (signOut) is imported from another feature.
- Server renders panels collapsed; the client restores the stored or default layout in `useLayoutEffect` (one-frame change accepted, per the story).
- Open / drop / Ctrl+O end in `openFiles()`, a placeholder toast until the viewer (Epic 3).
- Bound keys: F6 / Shift+F6, Ctrl+O, Alt+X/U/4/T/P/Y, Alt+L, Shift+F4. Tool shortcuts are display-only (tools are disabled).

### File List

- Added: `src/features/workspace/{panel-registry,layout-persistence,layout-store,open-files,use-region-cycling,use-workspace-shortcuts}.ts`, `src/features/workspace/{layout-context,account-menu,empty-workspace,narrow-banner,panel-rail,tool-rail,workspace-menu-bar,workspace-shell,workspace-status-bar,workspace-toolbar}.tsx`, tests `layout-persistence.test.ts`, `use-workspace-shortcuts.test.ts`, `workspace-shell.test.tsx`, `e2e/workspace-shell.spec.ts`
- Modified: `src/app/(workspace)/workspace/page.tsx`, `src/app/globals.css` (ws breakpoints), `src/components/ui/menu-bar.tsx`, `src/components/ui/menu-styles.ts` (24 px bar), `e2e/auth.spec.ts`, `e2e/security-headers.spec.ts`
- Deleted: `src/features/account/user-menu.tsx`

### Change Log

- 2026-10-18: Empty workspace shell implemented (Story 1.8).
- 2026-10-18: CI run 39083897201 passed on 6ffbdbc (typecheck/lint/unit/guards, gitleaks, Playwright e2e on CI's repo config); story closed.
- 2026-10-19: Code review (high) fixes: collapsing a panel that holds the focus moves it to the panel's rail button (left) or the Expand button (bottom); a file dropped outside the drop zone no longer replaces the page (window dragover/drop guard); the collapsed bottom panel is not an F6 stop (AC 5); a pending layout save is flushed on `pagehide`; Alt+L uses a `toggleBottomCollapsed` store action (no stale closure) and held shortcut keys run once; Ctrl+O follows the typed letter (Dvorak, AZERTY) with the key position as fallback for non-Latin layouts, Alt keys stay on `code` for macOS; sign-out runs once while pending and a failure shows a danger toast instead of the error boundary; the menu bar row and the status bar no longer force `h-6` around a 24 px child plus a border (1 px overflow); NarrowBanner's no-op subscribe is a module function. Not changed: the review asked to override the MenuBar height with a className instead of changing the default; `cx` cannot override a same-property Tailwind utility (1.7 review), and the 24 px bar is the spec for the only MenuBar user. Tests in `workspace-shell.test.tsx`, `use-workspace-shortcuts.test.ts`; 753 tests. CI run 39202086479 passed on 64a5427.
