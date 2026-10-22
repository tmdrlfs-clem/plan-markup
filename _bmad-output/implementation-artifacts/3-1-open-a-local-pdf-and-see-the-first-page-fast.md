# Story 3.1: Open a local PDF and see the first page fast

Status: done

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

- [x] **Task 1: pdf.js assets same-origin**: copy `pdf.worker.min.mjs`, the wasm decoders, standard fonts and cmaps from `pdfjs-dist` into `public/pdfjs/<version>/` with a script run on `postinstall`/`prebuild` (git-ignored output, version in the path for caching), replacing the spike's dev-only `/spike/pdfjs` route. Verify in a **production build** that the nested pdf.js worker can decode CCITT/JBIG2/JPX images under our CSP (Story 2.3 open item); if `wasm-unsafe-eval` is needed in `worker-src`/`script-src`, add it narrowly, record it in an ADR (`docs/decisions/0005-…`) and in the security-headers test.
- [x] **Task 2: Promote the render worker**: `src/workers/render.worker.ts` + `render-pdfjs.ts` from Story 2.3 to production quality: typed messages `{ type: "render.<verb>", reqId, payload }` → `result | progress | error` (AR14), Zod-validated input, `open` returns `{ pageCount, pages: [{ width, height, rotate }] }` and per-page content flags (`hasVector`, `hasText`, `imageOnly` from the operator list: no path/text ops, ≥ 1 image op), `preview` (progressive partial), `tile`, `cancel`, `close`. CPU-backed `OffscreenCanvas` (`willReadFrequently: true`, Story 2.3 GPU finding). Password → typed error `password-required`; invalid → `invalid-pdf`. `serializeWorkerError` plus the error `code` pattern from Story 2.1.
- [x] **Task 3: Viewer core** (`src/core/render/` keep, `src/features/viewer/` new): reuse `tiles.ts` (buckets, visible set, LRU 256 MB budget). A zustand vanilla `viewer-store` (document status, page index 0, view = fit page, errors, hint) — no React state per tile. `CanvasViewport` component: tile canvas + (empty) static markups canvas + active canvas, sized to viewport × DPR, redraw on resize; fit-page on open and on resize. Zoom/pan come in 3.2 — structure the view transform so 3.2 only adds input handling.
- [x] **Task 4: IndexedDB raster cache**: `src/lib/idb/tile-cache.ts` with `idb` 8.0.4: store `ImageBitmap`-derived blobs (`OffscreenCanvas.convertToBlob` in the worker, PNG/WebP) keyed by `sha256:page:bucket:col:row`; size budget (e.g. 512 MB, LRU by last access) with eviction; every access in try/catch (private mode → no cache, no error). sha256 computed off the main thread (in `render.worker` for now; `engine.worker` takes it later, AR14).
- [x] **Task 5: Wire Open**: `openFiles()` → viewer (first PDF only; extra files → info toast "Tabs arrive soon — opened <name>"). File chooser, `Ctrl+O`, File › Open… and drop all use it. Non-PDF stays a warning toast.
- [x] **Task 6: HintBar** (`src/components/ui/hint-bar.tsx`, UX-DR11): info/warning/danger variants, icon + text + optional action + Dismiss, one visible at a time (store), slot under toolbar row 2 in the shell grid.
- [x] **Task 7: States and errors** (AC 6, 7, 8): loading progress bar, image-only, render error with tile retry, inline file errors; status bar file name; document title.
- [x] **Task 8: Remove the spike route**: delete `src/app/(spike)/` and its fixture/pdfjs routes and the `PLAN_MARKUP_LOCAL_SPIKE` path once the viewer replaces them; keep `scripts/spike-render/measure.mjs` working against `/workspace` (sign-in with the seed user) or note it as retired in the 2.3 report. Proxy and CSP back to their pre-spike shape except what Task 1 requires.
- [x] **Task 9: Tests**: unit (worker handler with stubbed pdf.js: open/password/invalid/imageOnly flags, cancel; tile cache with fake-indexeddb if already available, else an in-memory adapter test; viewer store). Committed small fixtures in `fixtures/pdf/`: `vector-a3.pdf` (reuse/derive from `export-sample.pdf`), `image-only.pdf`, `corrupt.pdf`, `password.pdf` (generate with a script; document how). Playwright `e2e/viewer-open.spec.ts`: open via chooser and drop → canvas state ready + non-blank pixels; network interception asserts no request body contains the PDF's first 1 KB and no `/storage/` calls (AC 3); corrupt / password inline errors and workspace still usable; image-only HintBar; `/spike/render` 404 in the production build used by CI e2e.

### Review Follow-ups (AI)

Code review of 2026-10-22: 10 findings, all fixed with unit tests.

- [x] [AI-Review][High] Worker start failure / worker `error` / `messageerror` left requests pending forever. A failed start now drops the queued messages (and the transferred bytes) and posts `worker-failed` (new protocol code). On that reply, an `error` or a `messageerror`, `RenderClient` rejects every pending request with `worker-failed`, terminates the worker and marks itself dead. Other requests then fail fast; the next `render.open` starts a new worker (the client now takes a factory). The engine shows the render-error state, and Try again reopens. Tests: `rpc.test.ts`, `viewer-engine.test.ts`.
- [x] [AI-Review][High] In-memory tile keys omitted the device scale. Keys are now `page:bucket:col:row@s<step>:<tileSize>`. A fit or DPR change cancels in-flight tiles and clears failed markers; late old-scale replies are dropped. Test: `viewer-engine.test.ts`.
- [x] [AI-Review][Med] The host waited for IndexedDB. It now starts at once with a `deferredRasterCache`. `openTileCache` has a 2 s timeout and `blocked` / `blocking` (close + disable) / `terminated` handlers, and falls back to no cache. Tests: `tile-cache.test.ts`, `render.worker.test.ts`.
- [x] [AI-Review][Med] The nested pdf.js parser worker had no error listener. `ensureParserWorker` now listens for `error`: it terminates the worker, resets `GlobalWorkerOptions.workerPort`, and rejects a `failed` promise that open and render race against. The next open starts a fresh parser worker. Test: `render-pdfjs.test.ts`.
- [x] [AI-Review][Med] The cache-hit open path had no cancel check after `await getDoc`. `open` now checks abort and generation after every await. A cancel or close during the lookup installs nothing and answers `cancelled`. Test: `render.worker.test.ts`.
- [x] [AI-Review][Med] `PdfjsTileRenderer.open` wrote shared state inside its loop. It now uses a local document and page map, and installs them only if `this.task` is still its own; otherwise it rejects `cancelled` and destroys its task. Test: `render-pdfjs.test.ts` (mocked `getDocument`).
- [x] [AI-Review][Med] `putTile`/evict raced on `total`. Puts and evictions now run on one promise chain, with a single lazy measure of the total; it is reset to unknown after a partial failure. Test: concurrent puts in `tile-cache.test.ts`.
- [x] [AI-Review][Med] Any storage error disabled the cache for good. Now a failed read is a miss and a failed write is skipped. `QuotaExceededError` evicts to 50 % and retries once. Only open failures, `blocking` and `terminated` disable the cache. Tests: `tile-cache.test.ts`.
- [x] [AI-Review][Low] `getTile` awaited a readwrite touch. The touch is now fire-and-forget with a catch. Test: `tile-cache.test.ts`.
- [x] [AI-Review][Med] Preview and tile keys were inconsistent. Raster scales are quantised to 1/16-octave steps (`tiles.ts` `scaleStep` / `quantizeScale`, rounded up, ≤ 4.4 % oversample).
  - The worker renders tiles and previews at the quantised scale.
  - Keys carry the step: `<sha>:<page>:s<step>:<tileSize>:<col>:<row>` and `<sha>:<page>:preview:s<step>`.
  - A reopen at a different window size re-renders and stores a preview at its own step, and still hits wherever the step matches.
  - The format is documented in `tile-cache.ts`.
  - Tests: `tiles.test.ts`, `render.worker.test.ts`.

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Review follow-ups: CI run **39759993996** (typecheck/lint/unit/guards, Playwright e2e on the production build, gitleaks): success. Commit 2e55e4c. Local: typecheck, lint, 1035 unit tests in 99 files, and `next build` all pass.
- CI run **39756497361** (CI: typecheck/lint/unit/guards, Playwright e2e on the production build, gitleaks): success. Database run 39756497363: success. Commit 319ec59.
- Local, production build (`next build` + `next start`, E2E_PROD=1, workers 1): full e2e 32/32 passed. `viewer-open.spec.ts` also passed against `next dev`.
- L17 RCP (`fixtures/private/pdf/A1721-…-Rev.2.pdf`) opened once in the signed-in workspace. Setup: production build, Chromium 156 headless, 1920 x 1080, DPR 1, Docker + local Supabase running.
  - Complete low-res frame: **2020 ms**, from file chosen to complete preview painted, including worker and parser-worker cold start. Informal, one run; NFR1 is ≤ 3 s.
  - Reopen from the IndexedDB raster cache: **50 ms**.
  - Screenshot: `fixtures/private/traces/3-1-l17-workspace.png` (git-ignored). Reviewed: the full RCP, legends, title block and the existing cloud annotations render correctly at fit page, and the status bar and window title show the file name.
- CSP/wasm check (production build, `wasm-images.pdf`):
  - With the parser-worker CSP: the worker fetched `openjpeg.wasm` and `jbig2.wasm`, fetched no `*_nowasm_fallback.js` and logged no CSP violation. Both images rendered correctly.
  - With `'wasm-unsafe-eval'` removed from the built routes manifest: wasm compilation was refused and pdf.js loaded both JS fallbacks. The images still rendered.
  - Recorded in ADR 0005.
- pdf.js in Node on the fixtures:
  - corrupt: InvalidPDFException;
  - password: PasswordException;
  - image-only: one paintImageXObject and no path or text ops;
  - vector-a3: paths and text.

### Completion Notes List

- **Task 1: same-origin pdf.js assets.**
  - `scripts/copy-pdfjs-assets.mjs` (postinstall, predev, prebuild) copies these into git-ignored `public/pdfjs/<version>/`: the parser worker, the wasm decoders and their JS fallbacks, standard fonts, cmaps, ICC profiles and licences. quickjs-eval is not shipped.
  - `/pdfjs/` is outside the proxy matcher. `next.config.ts` sends `PDFJS_WORKER_CSP` (`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; …`) and a one-year immutable cache on it.
  - The page CSP is unchanged. Recorded in ADR 0005; asserted in `headers.test.ts`, `next-config.test.ts`, `proxy.test.ts` (matcher) and `security-headers.spec.ts`.
- **Task 2: render worker.**
  - `render-protocol.ts`: Zod schemas; requests `render.open|preview|tile|cancel|close`; replies `result|progress|error` with stable codes, including `password-required` and `invalid-pdf`.
  - `render.worker.ts` host: computes sha256 off the main thread before pdf.js takes the bytes. It runs one job at a time, cancel and close act at once, and every request gets exactly one final reply.
  - `render-pdfjs.ts`: nested parser only, `isEvalSupported: false`, `enableXfa: false`, CPU canvases, page `rotate`, content flags.
  - Also new: `src/core/render/content-flags.ts`, and `src/workers/rpc.ts` (RenderClient). The client reports unexpected worker errors via `reportWorkerError` and never reports expected ones.
- **Task 3: viewer core** in `src/features/viewer/`:
  - `viewer-store.ts`: zustand vanilla, document-level state only.
  - `viewer-engine.ts`: canvas stack sized to viewport x DPR, fit page on open and resize, preview then bucket tiles, 256 MB LRU, on-demand rAF. `setView` and `fitPage` are ready for 3.2.
  - `canvas-viewport.tsx`, `document-viewer.tsx`, and `index.ts` (the public surface; the workspace imports only from it).
- **Task 4: IndexedDB raster cache.**
  - `src/lib/idb/tile-cache.ts` (`idb` 8.0.4): 512 MB budget, LRU by last access with a 1-minute touch throttle, evicts down to 90 %. Every call is guarded: any failure means no cache and no error.
  - `src/workers/render-cache.ts`: PNG ↔ ImageBitmap, Zod-validated doc metadata.
  - The worker encodes with `OffscreenCanvas.convertToBlob` after posting the bitmap. A reopen answers open, preview and cached tiles before pdf.js has parsed.
- **Task 5: wiring open.**
  - `openFiles()` opens the first PDF via `openDocument()`. Extra files show the toast "Tabs arrive soon — opened <name>". With no PDF, the warning toast shows.
  - The chooser, Ctrl+O, File › Open…, a drop on the empty workspace and a drop on the canvas all use it.
- **Task 6: HintBar.** `hint-store.ts` + `hint-bar.tsx`: info/warning/danger variants, icon, text, optional action, Dismiss, one notice at a time. Mounted in the header under toolbar row 2.
- **Task 7: viewer states.**
  - The canvas is focusable, with `aria-label` "Drawing canvas, page n of m" and `data-state` loading/ready/image-only/render-error.
  - A 2 px indeterminate progress bar shows while loading; there is no spinner.
  - Failed tiles are drawn as hatched placeholders with a Retry overlay.
  - Inline errors offer Open another file, plus Try again for a render failure.
  - The status bar shows the file name and the window title is "<file> — Plan Markup".
- **Task 8: spike retired.**
  - Deleted `src/app/(spike)/`, `src/lib/spike/`, the proxy's `/spike` exemption and the `/spike/**` tracing exclusion.
  - `/spike/*` is now an ordinary protected path that 404s (covered by e2e).
  - `measure.mjs` is marked retired here and in the 2.3 report.
- **Task 9: tests.**
  - Unit tests:
    - worker host: open, password, invalid, no pages, preview flags and progress, tiles, invalid requests, cancel, close, raster-cache reopen;
    - content flags;
    - tile cache: in-memory backend, eviction, failure → miss;
    - render-cache, rpc, viewer engine (fake client), canvas viewport, HintBar, shell.
  - Fixtures and their generators are in `fixtures/pdf/`, documented in `fixtures/README.md`.
  - `e2e/viewer-open.spec.ts` covers the browser flows.
  - Suite: 1017 unit tests in 99 files.

**Deviations (for review):**

1. **Content flags.** They come back per page on the `render.preview` result, not on `open`.
   - Source: the operator list pdf.js has just executed (`RenderTask._internalRenderTask.operatorList`, pinned pdf.js 6.4.299). If that internal API ever changes, the flags fall back to null, which hides the hint.
   - Reason: a separate `getOperatorList()` at open would parse every page a second time on the critical path.
   - The flags are cached with the document metadata.
2. **Tile cache key:** `sha256:page:bucket@<device scale x 1e4>:<tileSize>:col:row`.
   - A bucket's scale depends on the viewport and the DPR, so the key carries it.
   - The preview has its own key (`sha256:page:preview`). It is drawn scaled, so it hits at any window size.
3. **Tiles and cancel.**
   - At fit page no tiles are requested: the preview already has the fit bucket's resolution, so tiles would repeat a full-page render.
   - Tiles are requested when the view needs more resolution: a larger window now, zoom in 3.2.
   - A cancelled request gets an error reply with code `cancelled`; `render.cancel` itself replies `{}`.
4. **CI e2e.** CI e2e now runs on the production build (`npm run build`, then `E2E_PROD=1` runs `npm run start`). The local default is still `next dev`.
5. **No `enableScripting`.** pdf.js 6 `getDocument` has no such option. Scripting is never set up (no pdf.sandbox, no quickjs wasm shipped), and no annotation layer is built. So no PDF JavaScript runs and no link is followed.
6. **Other.**
   - Extra fixture: `wasm-images.pdf` (Python/Pillow generator) for the wasm/CSP check.
   - The spike route was removed in the render-worker commit (c25a47a), before the viewer existed, because the spike engine depended on the old protocol.

**Open questions:**

- `_next/static` worker chunks, including the render worker, still carry no CSP header. ADR 0005 accepts this for now; revisit it with the export worker.
- The IndexedDB `docs` store (page sizes and flags per sha256, a few hundred bytes each) is not counted in the 512 MB budget and is never evicted.
- Still not measured from 2.3: L21, DPR 1.5, 512 vs 1024 px tiles and A0 on a production build. Only the informal L17 run above was done.

### File List

Review follow-ups (2026-10-22): `src/core/render/tiles.ts`, `tiles.test.ts`; `src/features/viewer/canvas-viewport.tsx`, `viewer-engine.ts`, `viewer-engine.test.ts`; `src/lib/idb/tile-cache.ts`, `tile-cache.test.ts`; `src/workers/render-protocol.ts`, `render-pdfjs.ts`, `render-pdfjs.test.ts`, `render.worker.ts`, `render.worker.test.ts`, `rpc.ts`, `rpc.test.ts` (all modified).

Story implementation:

- `.github/workflows/ci.yml` (modified)
- `.gitignore` (modified)
- `_bmad-output/implementation-artifacts/3-1-open-a-local-pdf-and-see-the-first-page-fast.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `docs/decisions/0003-csp-and-error-tracking.md` (modified)
- `docs/decisions/0005-pdfjs-assets-and-worker-csp.md` (new)
- `docs/spikes/2-3-render-report.md` (modified)
- `e2e/security-headers.spec.ts` (modified)
- `e2e/viewer-open.spec.ts` (new)
- `eslint.config.mjs` (modified)
- `fixtures/README.md` (modified)
- `fixtures/pdf/corrupt.pdf`, `fixtures/pdf/image-only.pdf`, `fixtures/pdf/password.pdf`, `fixtures/pdf/vector-a3.pdf`, `fixtures/pdf/wasm-images.pdf` (new)
- `next.config.ts` (modified)
- `package.json` (modified)
- `playwright.config.ts` (modified)
- `scripts/copy-pdfjs-assets.mjs`, `scripts/copy-pdfjs-assets.test.mjs` (new)
- `scripts/fixtures/make-viewer-fixtures.mjs`, `scripts/fixtures/make-wasm-images.py` (new)
- `scripts/spike-render/measure.mjs` (modified: retired)
- `src/app/(spike)/spike/assets.ts`, `fixture/[name]/route.ts`, `pdfjs/[...path]/route.ts`, `render/engine.ts`, `render/markups.ts`, `render/page.tsx`, `render/scripted.ts`, `render/viewer.tsx`, `spike-routes.test.ts` (deleted)
- `src/app/globals.css` (modified)
- `src/components/ui/hint-bar.tsx`, `hint-bar.test.tsx`, `hint-store.ts` (new)
- `src/core/render/content-flags.ts`, `content-flags.test.ts` (new)
- `src/features/viewer/canvas-viewport.tsx`, `canvas-viewport.test.tsx`, `document-viewer.tsx`, `index.ts`, `viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts` (new)
- `src/features/workspace/open-files.ts`, `workspace-shell.tsx`, `workspace-shell.test.tsx`, `workspace-status-bar.tsx` (modified)
- `src/lib/idb/tile-cache.ts`, `tile-cache.test.ts` (new)
- `src/lib/security/headers.ts`, `headers.test.ts` (modified)
- `src/lib/spike/guard.ts`, `guard.test.ts` (deleted)
- `src/proxy.ts`, `src/proxy.test.ts` (modified)
- `src/workers/render-cache.ts`, `render-cache.test.ts`, `render-pdfjs.test.ts`, `render-protocol.ts`, `rpc.ts`, `rpc.test.ts` (new)
- `src/workers/render-pdfjs.ts`, `render.worker.ts`, `render.worker.test.ts` (modified)
- `tools/config/next-config.test.ts` (modified)

### Change Log

- 2026-10-22: Story 3.1 implemented (Claude Opus 5.5). Status → review.
  - Same-origin pdf.js assets with a worker-only CSP (ADR 0005).
  - The render worker protocol, with an IndexedDB raster cache.
  - The workspace viewer: fit page, progressive preview, tiles, states, inline errors, HintBar, window title and status bar.
  - Spike route retired; fixtures and e2e added; CI e2e runs on the production build.
  - Commits a7c2061, 706ce90, c25a47a, 1c253f4, 319ec59. CI run 39756497361 green.
- 2026-10-22: Code review follow-ups, 10 of 10 fixed (Claude Opus 5.5):
  - fatal worker failures are handled and the worker restarts on the next open;
  - in-memory keys carry the scale;
  - the cache opens in the background with a timeout and versionchange handlers;
  - the parser worker recovers after an error;
  - cancel-safe open paths;
  - serialised cache writes with a quota retry;
  - fire-and-forget touch;
  - quantised raster scales with consistent cache keys.
  - Unit tests: 1035 in 99 files. Status → done.
