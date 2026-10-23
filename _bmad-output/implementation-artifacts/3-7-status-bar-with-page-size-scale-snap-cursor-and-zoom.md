# Story 3.7: Status bar with page size, scale, snap, cursor and zoom

Status: review

## Story

As a drafter,
I want the status bar to show page facts at a glance,
so that I can trust what I measure and see.

## Acceptance Criteria

1. **Given** an open drawing, **when** I move the cursor or change page/zoom, **then** the status bar shows, in this fixed order: file name · PagePager · ScaleIndicator · snap toggles · cursor X/Y · zoom % · save area (placeholder slot for Story 6.x SaveIndicator, empty now) (FR22, UX-DR7). Items are Story 1.7 `StatusBarItem`s (buttons when actionable); the bar fits a 1280 px wide window without wrapping (lower-priority items truncate or hide labels to icons, page size moves to tooltip first).
2. **Page size:** the active page's size is shown (item or the pager's tooltip, decide by width) as a named ISO/ANSI sheet when within ±1 % ("A1 841 × 594 mm", "ANSI D 34 × 22 in", including landscape/portrait and the page's /Rotate), otherwise "W × H mm"; units follow the user's unit preference if one exists (Settings > Units placeholder — default mm; record the decision). Size logic lives in framework-free `src/core/pdf/page-size.ts`, unit-tested against ISO A0–A4, B-series, ANSI A–E, ARCH A–E.
3. **ScaleIndicator** (UX-DR9): until calibration exists (Epic 4 Story 4.3) every page shows `⚠ Scale not set` in the warning colour with the warning icon (never colour alone); the component already supports the other states (`✓ Scale 1:100` success, `Scale 1:100 detected — Verify` warning, mixed "2 scales on page") from a typed prop so 4.3/4.4 only wire data. Clicking it opens nothing yet except a tooltip "Calibration arrives with the Measure tools" — or, if a CalibrateDialog stub exists, opens that; do not build calibration here.
4. **Snap toggles:** three `ToggleButton`s (content / markup / grid) with icons, tooltips and `aria-pressed`; state is stored per user (existing per-user preference/layout persistence) and exposed from a small snap-settings store so Story 4.1 only reads it. They have no effect yet (Story 4.1) — the tooltip says what each will do; do not fake snapping.
5. **Cursor X/Y:** live page coordinates under the pointer in PDF units (pt, origin bottom-left of the unrotated page, independent of view rotation/zoom) formatted with tabular figures ("X 1234.5  Y 678.9 pt"); blank when the pointer is off the page or no document is open; updates at most once per animation frame with no React re-render storm (subscribe the item to a tiny store or write the text node directly); real units take over after calibration (Epic 4, keep the formatter ready for a scale).
6. **Zoom %:** existing Revu-style readout (100 % = 96/72 CSS px per pt) moves into its slot; clicking it opens a small menu (Fit page, Fit width, 50/100/200/400 %) using Story 1.7 Menu — or keep it read-only if the 3.2 design already has a zoom control elsewhere; record the choice.
7. **Accessibility:** the status bar keeps its `role=status`/polite announcements only for meaningful changes (page via the 3.3 live region, scale state changes, save state later); cursor X/Y and zoom changes are NOT announced (they would flood screen readers) — mark those items `aria-live="off"` / outside the live region.
8. **Search highlight colour** (carry-over, founder decision 2026-10-24): if not already done in the 3.6 fixes, nothing to do here — just verify the status bar does not reuse the accent for warnings.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) covers item order, page-size text on the multi-page fixture (mixed sizes), `Scale not set` warning with icon, snap toggles persist across reload, cursor X/Y updates on pointer move and clears off-page, zoom readout.

## Tasks / Subtasks

- [x] **Task 1: Core** — `src/core/pdf/page-size.ts` (sheet name detection, mm/in formatting) and `src/core/units/format.ts` (or extend an existing formatter) for coordinates; unit tests.
- [x] **Task 2: Stores** — snap-settings store (per-user persistence), cursor-position store fed by canvas pointer events in page space (reuse view inverse transform from `src/core/render/view.ts`), scale-state selector (always "not set" for now).
- [x] **Task 3: Components** — `ScaleIndicator`, `SnapToggles`, `CursorReadout`, `PageSizeItem`, zoom item, in `src/features/viewer/status/` (or the existing status-bar location); fixed order and responsive collapse.
- [x] **Task 4: Wiring per tab** — items follow the active tab and page (3.5), clear on EmptyWorkspace.
- [x] **Task 5: Tests** — unit + `e2e/viewer-status-bar.spec.ts`; local L17/L21 check (A1 sheet detected, cursor readout sane, no long tasks while moving the pointer) and screenshot `fixtures/private/traces/3-7-status-bar.png` (never commit private files).

### Review Follow-ups (AI)

Adversarial review 2026-10-24 (Claude Opus 5.5) of f08b2e5..f5661ca (diff against 010e422), with the founder defaults of 2026-10-24 kept (millimetres by default with ANSI/ARCH sheets in inches; snap defaults content + markup on, grid off; "Scale not set" as a tooltip only). Checked: page-size detection (/Rotate, UserUnit, CropBox/MediaBox origin), the cursor transform under view rotation, zoom, DPR and /Rotate, per-frame updates and listener cleanup, per-tab wiring, per-user snap persistence (sign-out / sign-in), responsive collapse, the live region, the Story 1.7 component extensions against their other uses, and AC coverage. Plus the founder's tile-fill concern (bounded investigation, below).

- [ ] **[High] R1: The cursor X/Y is not PDF user space.** `cursorPoint()` inverts the /Rotate with the default view box `[0, 0, w, h]`: the CropBox/MediaBox origin and /UserUnit are not in `PageInfo`. On the founder's L17 the page box is `[-1191.97 -841.89 1191.97 841.89]` (checked with pdf.js), so the point the store holds is (1192, 842) pt away from the PDF coordinate of the same spot. `cursor-store.ts` documents "PDF user space units", and Story 4.1 writes its snapped point (segments from the operator list, user space) into the same store, so the readout would jump by that offset whenever a snap engages, and markups placed from the store would land in the wrong place. The *displayed* origin (bottom-left corner of the unrotated page, AC 5) is right; the stored space is not. Fix: `PageInfo` carries the page's view box and UserUnit (the worker reads `page.view` / `page.userUnit`; the raster cache's document entry requires them, so entries written before are read once more from the PDF); the store holds PDF user space; the readout converts to the AC 5 display (points from the page's bottom-left corner, UserUnit applied) with a pure helper. Tests against pdf.js's own viewport for every /Rotate with an off-origin box and a UserUnit.
- [x] **[Medium] R2: Tiles took up to 10 s to fill after a jump at ~190 % (founder concern, investigation).** Measured on L17 (production build, DPR 1, empty raster cache, `e2e/perf-tiles.spec.ts`): the first go-to-hit at 188 % (bucket 2) asked for 40 tiles (18 in view); the worker rendered them one at a time at **244 ms p50 / 362 ms p95 each**, so the view was complete after **5.0 s** (in view) and **10.1 s** (with the margin ring); the queue wait of the last tile was 9.8 s. Rendering was ~100 % of that time: no duplicate or stale requests (each jump asked only for new tiles, the wrap-around jump for none), the order was already in-view first and centre first, and the tiles of other buckets already show under the missing ones. The cost is pdf.js running all ~176 k operators for every 512 px tile, whatever little of the page it covers (2.3 report). **Fix (safe, no rewrite):** pdf.js 6.4's operation recording (`recordOperations` → `page.recordedBBoxes`, the mechanism of its own viewer's zoomed detail view) is run once per page on a 1024 px canvas, and each tile then runs only the operators whose box meets it (`operationsFilter`, `src/core/render/op-culling.ts`, widened by two 1/256 steps). After: tile **17 ms p50 / 55 ms p95**, first jump complete after **1.3 s** in view and **1.7 s** in total (the first tile of a page also pays the one recording pass, ~0.5 s); later jumps **0.3-0.6 s**. Pixel check (Node, pdf.js legacy build, @napi-rs/canvas): every 512 px tile of L17 and L21 at 2 px/pt (70 + 70) plus 72 tiles at 1, 2 and 4 px/pt match the full render within an anti-aliasing channel delta of 4 (one L17 tile differs at all, max delta 2); the committed fixtures are checked the same way in CI (`op-culling.test.ts`, incl. a /Rotate 90 page). The synthetic A0 (159 k operators of huge paths) keeps 15 % of its operators per tile: 2.5 s → 1.3 s, pixel-identical. Numbers also in `docs/spikes/2-3-render-report.md` (addendum). Follow-up idea, not done: record the boxes in idle time right after the preview, so even the first jump does not pay the recording pass.
- [ ] **[Medium] R3: The page size is out of reach for keyboard users between 1280 and 1439 px.** Below 1440 px the item is only an icon whose size lives in a hover tooltip, on a non-focusable span: sighted keyboard users cannot get it at all (WCAG 2.1.1 / 1.4.13). Fix: the icon item is focusable (tab stop with the focus ring, like the pager's sheet label) and its tooltip opens on focus.
- [ ] **[Low] R4: The cursor readout overflows its box.** A fixed `w-[22ch]` includes the padding; a page over 9999 pt (UserUnit, banners) or a calibrated readout in real units (Epic 4, "X 254000  Y 508000 mm") runs into the zoom item. Fix: a minimum width (the bar still does not shift for normal drawings) that grows instead of overflowing.
- [ ] **[Low] R5: `aria-label` on the cursor readout is ignored.** It sits on a generic `span` (ARIA prohibits naming a generic element), so screen readers read only "X 12.0 Y 34.0 pt". Fix: a visually hidden "Cursor position" text before the value, the value still written straight to its own text node.
- [ ] **[Low] R6: Two browser tabs of the same user overwrite each other's snap toggles.** Each tab saves its whole state on a change, so a toggle changed in one tab is undone by the next change in the other. Fix: the persistence hook follows `storage` events for the user's key. The sign-out / sign-in case (the 3.5 tab finding) was checked and is correct (the hook reloads the next user's toggles, replacing, before paint); a test now covers user A → B → A.

## Dev Notes

- Builds on 3.1–3.6: status bar currently holds file name, pager (3.3) and zoom (3.2); per-tab viewer engines (3.5). Read the 3.3–3.6 story files including review follow-ups and deviations first.
- Do not implement snapping (Story 4.1) or calibration (Stories 4.3/4.4); build the indicators so those stories only connect data.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; warning = yellow + icon; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.7]; FR22, UX-DR7, UX-DR9; Story 4.1 (snap toggles), 4.3 (calibrate)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] StatusBar, ScaleIndicator, "Status bar as the trust centre"
- [Source: _bmad-output/implementation-artifacts/3-6-search-text-in-the-drawing.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run **40023081059** (23b2645: typecheck/lint/unit/guards, Playwright e2e on the production build including `viewer-status-bar.spec.ts`, gitleaks): success.
- Local checks: `npm run typecheck`, `npm run lint` and `npm run build` clean; `npm test` 1342 unit tests in 120 files (Docker stopped).
- Local e2e on the production build (`E2E_PROD=1`, workers 1, Docker + local Supabase): 43 passed, 5 skipped (the opt-in private checks). `viewer-status-bar.spec.ts` failed once on its first run: the page-size item kept `inline-flex` next to `hidden` (both display utilities on one element; Tailwind's order made it visible below 1440 px). The responsive variants now sit on wrapper spans (`hidden ws-md:contents` / `contents ws-md:hidden`).
- Locally Supabase ran on remapped ports 583xx: Windows had reserved 55956-57055 this boot, so `supabase start` could not bind 56321/56322. `supabase/config.toml` and `.env.local` were changed only locally and restored afterwards; never committed.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-status-bar`, private, nothing committed): L21 and L17 open in two tabs.
  - Sheet size: both **"A1 841 × 594 mm"** (2384 × 1684 pt, landscape).
  - Cursor at page point (100, 100) at fit: "X 100.0  Y 1583.8 pt" (page height 1683.8 pt, origin bottom-left). Page centre: "X 1192.0  Y 841.8 pt" at fit, zoomed in, and zoomed in with the view rotated 90°; page (1100, 800) rotated: "X 1100.0  Y 883.8 pt". The readout does not move with the view, only with the page point.
  - Pointer sweep: 181 moves in 3 s over the canvas: longest main-thread task **0 ms** (Long Tasks API: nothing ≥ 50 ms).
  - Screenshot `fixtures/private/traces/3-7-status-bar.png` (L17 at fit, 1920 px: file name · pager · A1721 · "A1 841 × 594 mm" · "⚠ Scale not set" · snap toggles · "X 1192.0  Y 841.8 pt" · 31%). Reviewed, not committed.

### Completion Notes List

- **Task 1: core.**
  - `src/core/pdf/page-size.ts` `sheetSize(widthPt, heightPt, unit)`: ISO A0–A5, ISO B0–B4, ANSI A–E and ARCH A–E/E1, within ±1 % on each side, named in the page's orientation as shown (/Rotate applied, since `PageInfo` sizes are the rotated viewport): "A1 841 × 594 mm", "ANSI D 34 × 22 in". Other sizes: "W × H mm" in the user's unit.
  - `src/core/units/format.ts`: `fromPoints`, `DEFAULT_LENGTH_UNIT` ("mm"), `formatCursor(point, measure?)` → "X 1234.5  Y 678.9 pt"; a calibrated `measure` (unit, real length per point) switches it to real units (Epic 4).
  - Unit tests over every sheet in both orientations, the tolerance, other sizes and units, and a check that no two sheets are within the tolerance of each other.
- **Task 2: stores.**
  - `status/snap-settings.ts`: a vanilla zustand store `{ content, markup, grid }` (defaults on, on, off), `setSnap`, and `useSnapSettingsPersistence(userId)` (localStorage `pm.snap.v1.<userId>`, Zod-validated, storage errors fall back to the defaults). Story 4.1 only reads `snapSettings`.
  - `status/cursor-store.ts`: `{ point }` in PDF units; `setCursor` notifies only on a change.
  - The engine feeds it: `ViewerInput` reports `pointerAt(point | null)` on pointer move / leave; `ViewerEngine.pointerAt` publishes at most once per animation frame, and again on every draw (a wheel pan under a still pointer moves the page point). `cursorPoint()` inverts the view (`screenToPage`) and the page's /Rotate (`pdfToPageMatrix`), so the readout is independent of zoom and view rotation; null off the page. A background tab clears it and publishes nothing; a new document clears it.
  - `status/scale-state.ts`: `ScaleState` (`not-set`, `set`, `detected`, `mixed`); `scaleStateOf()` is always "not set" before Epic 4.
- **Task 3: components** (`src/features/viewer/status/status-items.tsx`, Story 1.7 parts):
  - `PageSizeItem`: the label from 1440 px wide; narrower, an orientation icon with the label for assistive technology and in the tooltip ("Page size: A1, landscape, 841 × 594 mm").
  - `ScaleIndicator`: "Scale not set" in the warning colour with the warning icon (StatusBarItem tone), tooltip "Calibration arrives with the Measure tools"; "✓ Scale 1:100", "Scale 1:100 detected — Verify" and "2 scales on page" from the typed prop.
  - `SnapToggles`: three 24 px `ToggleButton`s (Magnet, PenTool, Grid3x3) in a "Snap" group with `aria-pressed`; each tooltip says what it will do.
  - `CursorReadout`: writes its text node straight from the cursor store (no React render per move; the test counts one render), `aria-live="off"`, a fixed 22ch width so the bar does not shift.
  - `ZoomItem`: the Revu-style readout as a `Menu` trigger: Fit page (Ctrl+9), Fit width (Ctrl+0), 50 / 100 / 200 / 400 % (`viewerCommands.zoomTo` → `ViewerEngine.zoomToPercent`, about the centre).
  - Story 1.7 components extended: `StatusBarItem` forwards its ref and extra props, can be a button without its own onClick (`asButton`, for a menu trigger), can show only its icon (`iconOnly`), truncates its label and opens its tooltip upwards; `IconButton` / `ToggleButton` get an `xs` (24 px) size; `ToggleButton` an optional `tooltip` text.
- **Task 4: wiring.** `WorkspaceStatusBar` renders file name · PagePager · page size · ScaleIndicator · snap toggles · cursor X/Y · zoom · an empty `status-save` slot (Story 6.x). The shell passes the active tab's shown page (`pages[pageIndex]`, so the items follow tab and page switches) and its scale; without a drawing only "No drawing open" shows. The file name truncates first; the bar is one 24 px line at 1280 px (e2e: no overflow, every item inside the window).
- **Task 5: tests.** Unit tests for the core, the stores, the engine's cursor (frame throttling, off page, zoom + view rotation, /Rotate 90, background tab), `ViewerInput`, the components and the shell's item order; `e2e/viewer-status-bar.spec.ts` in CI; `e2e/perf-status-bar.spec.ts` opt-in and local.
- **AC 7:** the polite live region still only carries the page announcement (3.3). The cursor and zoom items are outside it, the cursor `aria-live="off"`. The scale state never changes before Epic 4; Story 4.3 announces its changes through the same region.
- **AC 8:** search highlights already use their own yellow tokens (3.6 review). The status bar's warnings (Scale not set) use the warning colour and icon, never the accent; the accent appears only as the pressed state of the snap toggles (ToggleButton's selection style).

**Decisions and deviations (for review):**

1. **ScaleIndicator is not a button yet.** Nothing can be done with it before calibration exists, and a button that does nothing is worse for keyboard and screen-reader users than a plain item; it is a `StatusBarItem` span with the tooltip "Calibration arrives with the Measure tools". Story 4.3 adds `onClick` (open Calibrate). No CalibrateDialog stub exists.
2. **Page size is its own item after the pager** (not the pager's tooltip): from 1440 px the full label; narrower an icon whose tooltip and accessible name carry the size.
3. **Units:** there is no Settings > Units yet, so `DEFAULT_LENGTH_UNIT` is millimetres. Named sheets use their own unit (ISO in mm, ANSI and ARCH in inches) whatever the preference; only other sizes follow it. A5 is included in the ISO list.
4. **Zoom item is a menu**, not read-only: the toolbar has zoom in / out and the fits but no presets, so the readout opens Fit page, Fit width and 50 / 100 / 200 / 400 %.
5. **Snap defaults:** content and markup on, grid off (Revu's defaults). Remembered per user in localStorage (like the workspace layout), not on the server.
6. **Cursor origin:** the bottom-left corner of the unrotated page as the viewer knows it (the viewport's view box). A MediaBox that does not start at (0, 0) is not in `PageInfo`, so such a PDF's coordinates are relative to its corner, not its raw user space. One decimal, in points.
7. **Story 1.7 components were extended** (StatusBarItem ref/props/asButton/iconOnly, `xs` size, ToggleButton tooltip), rather than adding new status-bar primitives.
8. **Snap toggles in the status bar use the ToggleButton's pressed style** (accent fill + inset bar), as everywhere else; warnings never use the accent.

**Questions for the founder:**

- Units: millimetres by default for sizes that are not a standard sheet, and ANSI/ARCH sheets always in inches. Is that right for your drawings, or should a Settings > Units preference come earlier?
- Snap defaults: content and markup on, grid off, as in Revu?
- Scale not set: is a tooltip enough until calibration arrives, or should clicking it explain more (a popover)?

### File List

- `_bmad-output/implementation-artifacts/3-7-status-bar-with-page-size-scale-snap-cursor-and-zoom.md`, `sprint-status.yaml` (modified)
- `src/core/pdf/page-size.ts`, `page-size.test.ts`, `src/core/units/format.ts`, `format.test.ts` (new)
- `src/features/viewer/status/snap-settings.ts`, `snap-settings.test.ts`, `cursor-store.ts`, `cursor-store.test.ts`, `scale-state.ts`, `status-items.tsx`, `status-items.test.tsx` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-input.ts`, `viewer-input.test.ts`, `viewer-commands.ts`, `index.ts` (modified)
- `src/components/ui/status-bar-item.tsx`, `status-bar-item.test.tsx`, `icon-button.tsx`, `toggle-button.tsx`, `toggle-button.test.tsx` (modified)
- `src/features/workspace/workspace-status-bar.tsx`, `workspace-shell.tsx`, `workspace-shell.test.tsx` (modified)
- `e2e/viewer-status-bar.spec.ts`, `e2e/perf-status-bar.spec.ts` (new)

### Change Log

- 2026-10-24: Story 3.7 implemented (Claude Opus 5.5). Status → review.
  - Page size, ScaleIndicator, snap toggles (per user), cursor X/Y and the zoom menu in the status bar's fixed order.
  - Unit tests, e2e and the local L17/L21 check.
  - Commits f08b2e5, 14317b2, 7ff67cc, 1148dc3, 23b2645.
