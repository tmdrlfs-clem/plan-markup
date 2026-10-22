# Story 3.1: Open a local PDF and see the first page fast

Status: in-progress

## Story

As a drafter,
I want to open a PDF from my computer and see the drawing almost immediately,
so that I can start work without waiting or uploading anything.

## Acceptance Criteria

1. **Given** the empty workspace, **when** I drop a PDF or choose File › Open… / the Open button / `Ctrl+O`, **then** the file is read locally (`File.arrayBuffer()`, bytes transferred to the worker) and rendered by `render.worker` (pdf.js 6.4.299, `isEvalSupported: false`, `enableScripting: false`, no PDF JavaScript or actions executed, links not followed) into `ImageBitmap` tiles drawn on the canvas at "fit page" (FR17, AR12, AR14, NFR30). EmptyWorkspace is replaced by the viewer; opening another file replaces the current one (tabs arrive in 3.5).
2. A partial preview appears quickly and a complete low-resolution frame follows, then the page sharpens progressively to the current zoom bucket (NFR1, A10). Budget on reference hardware (Story 2.3): L17/L21 complete low-res frame ≤ 3 s; heavy A0 — partial preview ≤ 3 s with the complete frame following (Story 2.3 decision). A reopen of the same file paints from the IndexedDB raster cache (key sha256 + page + bucket + tile) without waiting for pdf.js.
3. No request body contains PDF bytes and no Storage call occurs while opening and viewing (Playwright test intercepting all requests, NFR26, AR20).
4. Annotations already in the PDF are drawn read-only as part of the page raster (pdf.js `annotationMode: ENABLE`, no form widgets interactive, nothing imported — AR27/A3).
5. A page with no vector or text content (only images) shows the HintBar info "This page is an image — snapping and scale detection are unavailable; calibrate manually" (UX-DR11, UX-DR31). The HintBar sits under the toolbar, never covers the canvas, is dismissible, shows one notice at a time.
6. A corrupt file or a password-protected file shows an inline error in the canvas area with what to do ("This file is not a valid PDF." / "This PDF is password-protected. Remove the password in another app and open it again.") plus an Open another file button; the workspace stays usable. Password prompts are not offered in MVP.
7. The canvas is focusable with `aria-label` "Drawing canvas, page n of m"; it has the states loading / ready / image-only / render error; failed tiles show a placeholder with a retry action; a thin progress bar shows at the top of the canvas area while loading (it moves into the tab in 3.5) (UX-DR12). No full-screen spinner.
8. The status bar left item shows the file name; the window title becomes "<file name> — Plan Markup".
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e covers open via file chooser and drop, the no-upload check, corrupt and password files, image-only HintBar, and that `/spike/*` stays unreachable in production.

## Tasks / Subtasks

- [ ] **Task 1: pdf.js assets same-origin**: copy `pdf.worker.min.mjs`, the wasm decoders, standard fonts and cmaps from `pdfjs-dist` into `public/pdfjs/<version>/` with a script run on `postinstall`/`prebuild` (git-ignored output, version in the path for caching), replacing the spike's dev-only `/spike/pdfjs` route. Verify in a **production build** that the nested pdf.js worker can decode CCITT/JBIG2/JPX images under our CSP (Story 2.3 open item); if `wasm-unsafe-eval` is needed in `worker-src`/`script-src`, add it narrowly, record it in an ADR (`docs/decisions/0005-…`) and in the security-headers test.
- [ ] **Task 2: Promote the render worker**: `src/workers/render.worker.ts` + `render-pdfjs.ts` from Story 2.3 to production quality: typed messages `{ type: "render.<verb>", reqId, payload }` → `result | progress | error` (AR14), Zod-validated input, `open` returns `{ pageCount, pages: [{ width, height, rotate }] }` and per-page content flags (`hasVector`, `hasText`, `imageOnly` from the operator list: no path/text ops, ≥ 1 image op), `preview` (progressive partial), `tile`, `cancel`, `close`. CPU-backed `OffscreenCanvas` (`willReadFrequently: true`, Story 2.3 GPU finding). Password → typed error `password-required`; invalid → `invalid-pdf`. `serializeWorkerError` plus the error `code` pattern from Story 2.1.
- [ ] **Task 3: Viewer core** (`src/core/render/` keep, `src/features/viewer/` new): reuse `tiles.ts` (buckets, visible set, LRU 256 MB budget). A zustand vanilla `viewer-store` (document status, page index 0, view = fit page, errors, hint) — no React state per tile. `CanvasViewport` component: tile canvas + (empty) static markups canvas + active canvas, sized to viewport × DPR, redraw on resize; fit-page on open and on resize. Zoom/pan come in 3.2 — structure the view transform so 3.2 only adds input handling.
- [ ] **Task 4: IndexedDB raster cache**: `src/lib/idb/tile-cache.ts` with `idb` 8.0.4: store `ImageBitmap`-derived blobs (`OffscreenCanvas.convertToBlob` in the worker, PNG/WebP) keyed by `sha256:page:bucket:col:row`; size budget (e.g. 512 MB, LRU by last access) with eviction; every access in try/catch (private mode → no cache, no error). sha256 computed off the main thread (in `render.worker` for now; `engine.worker` takes it later, AR14).
- [ ] **Task 5: Wire Open**: `openFiles()` → viewer (first PDF only; extra files → info toast "Tabs arrive soon — opened <name>"). File chooser, `Ctrl+O`, File › Open… and drop all use it. Non-PDF stays a warning toast.
- [ ] **Task 6: HintBar** (`src/components/ui/hint-bar.tsx`, UX-DR11): info/warning/danger variants, icon + text + optional action + Dismiss, one visible at a time (store), slot under toolbar row 2 in the shell grid.
- [ ] **Task 7: States and errors** (AC 6, 7, 8): loading progress bar, image-only, render error with tile retry, inline file errors; status bar file name; document title.
- [ ] **Task 8: Remove the spike route**: delete `src/app/(spike)/` and its fixture/pdfjs routes and the `PLAN_MARKUP_LOCAL_SPIKE` path once the viewer replaces them; keep `scripts/spike-render/measure.mjs` working against `/workspace` (sign-in with the seed user) or note it as retired in the 2.3 report. Proxy and CSP back to their pre-spike shape except what Task 1 requires.
- [ ] **Task 9: Tests**: unit (worker handler with stubbed pdf.js: open/password/invalid/imageOnly flags, cancel; tile cache with fake-indexeddb if already available, else an in-memory adapter test; viewer store). Committed small fixtures in `fixtures/pdf/`: `vector-a3.pdf` (reuse/derive from `export-sample.pdf`), `image-only.pdf`, `corrupt.pdf`, `password.pdf` (generate with a script; document how). Playwright `e2e/viewer-open.spec.ts`: open via chooser and drop → canvas state ready + non-blank pixels; network interception asserts no request body contains the PDF's first 1 KB and no `/storage/` calls (AC 3); corrupt / password inline errors and workspace still usable; image-only HintBar; `/spike/render` 404 in the production build used by CI e2e.

## Dev Notes

- Story 2.3 report (`docs/spikes/2-3-render-report.md`) is the design input: nested pdf.js worker from a same-origin static file, CPU worker canvases, 512 px tiles (provisional), buckets ¼–8 × fit, 256 MB memory budget, progressive preview, IndexedDB cache. Windows window occlusion throttles rAF to 1 Hz — e2e must not assume rAF cadence in background windows.
- Story 2.1 finding: pdf.js 6 needs `wasmUrl` for CCITT/JBIG2/JPX; also set `standardFontDataUrl` and `cMapUrl` to the same-origin copies.
- `next.config.ts` already excludes `fixtures/private` from output tracing — keep it.
- Feature boundaries: `src/features/viewer/` must not import `src/features/workspace/` internals; the shell composes them (workspace imports viewer's public component). Workers and `src/core` stay framework-free.
- UI: Story 1.7 components only; near-sharp tokens; English UI text; `text-ws-*` in the workspace.
- Facts carried: Next 16 middleware is `src/proxy.ts`; read `node_modules/next/dist/docs/` before Next-specific code; tests co-located (jsdom opt-in + `@/test/radix-jsdom`); exact pins; dev port 3020; local e2e with workers 1; low memory on this machine when Revu/Outlook run — one browser at a time.
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]; AR12, AR14, AR20, AR27; UX-DR11, UX-DR12, UX-DR31
- [Source: _bmad-output/planning-artifacts/prd.md] FR17, NFR1, NFR26, NFR30, A3, A10
- [Source: _bmad-output/planning-artifacts/architecture.md] rendering, workers, IndexedDB, data flow on open
- [Source: docs/spikes/2-3-render-report.md], [Source: docs/spikes/2-1-btx-report.md]
- [Source: _bmad-output/implementation-artifacts/1-8-empty-workspace-shell.md] shell, openFiles, EmptyWorkspace

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
