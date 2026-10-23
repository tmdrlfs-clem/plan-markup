# Story 3.7: Status bar with page size, scale, snap, cursor and zoom

Status: ready-for-dev

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

- [ ] **Task 1: Core** — `src/core/pdf/page-size.ts` (sheet name detection, mm/in formatting) and `src/core/units/format.ts` (or extend an existing formatter) for coordinates; unit tests.
- [ ] **Task 2: Stores** — snap-settings store (per-user persistence), cursor-position store fed by canvas pointer events in page space (reuse view inverse transform from `src/core/render/view.ts`), scale-state selector (always "not set" for now).
- [ ] **Task 3: Components** — `ScaleIndicator`, `SnapToggles`, `CursorReadout`, `PageSizeItem`, zoom item, in `src/features/viewer/status/` (or the existing status-bar location); fixed order and responsive collapse.
- [ ] **Task 4: Wiring per tab** — items follow the active tab and page (3.5), clear on EmptyWorkspace.
- [ ] **Task 5: Tests** — unit + `e2e/viewer-status-bar.spec.ts`; local L17/L21 check (A1 sheet detected, cursor readout sane, no long tasks while moving the pointer) and screenshot `fixtures/private/traces/3-7-status-bar.png` (never commit private files).

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
