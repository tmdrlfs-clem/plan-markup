# Story 2.3: Spike — A0 render and 500-markup frame rate

Status: in-progress

## Story

As the founder,
I want proof that huge vector drawings render fast and stay smooth with many markups,
so that NFR1 and NFR2 are achievable with the chosen render architecture.

## Acceptance Criteria

1. **Given** the reference hardware and named fixtures recorded in `fixtures/README.md` (A10): this machine — Intel i5-1145G7 (4 cores / 8 threads), 15.8 GB RAM, Iris Xe, Windows 11, Chrome (Playwright's bundled Chromium is acceptable; note the version) — and the fixtures `fixtures/private/pdf/A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf` (L17, 2.2 MB), `A2121-LEVEL-21-…` (L21, 2.5 MB) and a generated 50 MB A0 vector PDF, **when** a prototype render worker (pdf.js 6.4.299, `isEvalSupported: false`) produces `ImageBitmap` tiles and a Canvas2D layer draws 500 synthetic markups, **then** the first low-resolution frame appears in ≤ 3 s for each fixture (NFR1; measured from file bytes available to first tile painted on screen).
2. Pan and zoom sustain ≥ 30 fps (target 60) with 500 markups on the page (NFR2), measured over scripted pan and zoom sequences (p50 and p5 frame times reported).
3. No main-thread task exceeds 50 ms during open, pan and zoom — measured with a Chrome performance trace (long tasks); the trace files are kept in `fixtures/private/traces/` and summarised in the report.
4. `docs/spikes/2-3-render-report.md` recommends tile size, zoom buckets, the tile-cache eviction budget (memory), and the layer structure for Epic 3/4, with the measured numbers per fixture and the go / change decision.
5. The prototype is not reachable in production; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass and CI stays green (the measurement itself runs locally only; it needs private fixtures and the reference machine).

## Tasks / Subtasks

- [ ] **Task 1: Fixtures** (AC 1): `scripts/spike-render/make-a0.mjs` generates `fixtures/private/pdf/synthetic-a0-50mb.pdf` (A0 landscape 3370 × 2384 pt, ~50 MB, deterministic): mostly vector content like a real RCP — a dense ceiling grid, many short line segments, hatching, arcs/circles (Béziers), and some text; Flate-compressed content streams; ≥ 2 M path operators in total. Record the three fixtures (size, page size, operator counts if measurable) and the reference hardware in `fixtures/README.md`.
- [ ] **Task 2: Tile math (keep)**: `src/core/render/tiles.ts` (framework-free, unit-tested): zoom buckets (powers of 2 relative to fit, e.g. ¼ … 8 × device pixel ratio), tile grid for a viewport at a bucket, visible-tile set with a 1-tile margin, priority order (centre first), LRU tile cache keyed by `page + bucket + col + row` with a byte budget (w × h × 4) and eviction.
- [ ] **Task 3: Render worker (keep, prototype quality)**: `src/workers/render.worker.ts`: load the PDF bytes once (transferred), pdf.js with `isEvalSupported: false` and the worker-friendly canvas path (`OffscreenCanvas`); messages `open`, `renderTile {page, bucket, col, row}`, `cancel`, `close`; replies with `ImageBitmap` (transferred). First answer is one low-resolution whole-page tile (fit bucket) so something shows fast; then tiles at the current bucket. Cancel stale requests on zoom/pan. Errors via `serializeWorkerError`. Note: pdf.js itself also uses its own worker; decide whether to run pdf.js in our worker with `disableWorker`-style in-thread parsing or to keep pdf.js's worker and render to `OffscreenCanvas` — measure both if cheap and record the choice.
- [ ] **Task 4: Viewer prototype page**: a dev-only route `src/app/(spike)/spike/render/page.tsx` that calls `notFound()` when `process.env.NODE_ENV === "production"` (and is excluded from the proxy auth requirement only in development if needed — do not weaken production auth). It loads a fixture via `<input type="file">` and, in development only, via `?fixture=<name>` from a dev-only route handler that streams files from `fixtures/private/pdf/` (whitelisted names, 404 in production). Canvas stack per architecture: (1) tile canvas (draws `ImageBitmap`s), (2) static markups canvas, (3) active canvas (hover highlight), all sized to the viewport × DPR. Pan with drag/wheel, zoom with Ctrl+wheel around the cursor; during a gesture scale the existing tiles (no re-render) and request new tiles when the gesture settles (~150 ms).
- [ ] **Task 5: 500 markups**: generate 500 seeded synthetic markups in PDF user space (mix: rectangles, clouds-like polylines with arcs, lines with arrowheads, text labels, 66-style sprinkler symbols as small circles+crosses). Draw them in one pass per frame on the static canvas with viewport culling via `rbush` 4.0.1 (pin exact, already in the architecture) and redraw only on view change; hover hit-test via the same index. No React state per markup.
- [ ] **Task 6: Measurement harness**: `scripts/spike-render/measure.mjs` (Playwright, headed Chromium, viewport 1920×1080, DPR 1 and 1.5 if feasible): for each fixture — open and time first low-res tile painted (page sets `performance.mark`s), then a scripted pan sequence (5 s) and zoom sequence (in 4 buckets and out) with 500 markups, collecting frame times via `requestAnimationFrame` deltas in the page and long tasks via `PerformanceObserver('longtask')`, plus a CDP trace saved to `fixtures/private/traces/<fixture>.json`. Run each fixture 3 times; report median. Exit 0 always (it is a measurement).
- [ ] **Task 7: Report** (AC 4): numbers per fixture (first frame, fps p50/p5 for pan and zoom, longest main-thread task, worker tile render times per bucket, peak JS heap / tile cache bytes), recommended tile size (compare 256 / 512 / 1024 if time allows), zoom buckets, eviction budget, which pdf.js worker setup to use, risks and the decision.
- [ ] **Task 8: Tests**: unit tests for `tiles.ts` (buckets, visible set, priority, LRU eviction by bytes) and the worker message handler (with a stubbed renderer). No e2e in CI for the spike page (private fixtures); add one Playwright check only that `/spike/render` is 404 in a production build if that is cheap, otherwise a unit test of the guard.

## Dev Notes

- This spike decides the Epic 3 viewer architecture: keep `src/core/render/tiles.ts` and the worker protocol at production quality; the page and harness are throwaway.
- Architecture: layer stack (pdf tiles → static markups → active → DOM overlays); IndexedDB tile cache keyed by sha256 + page + bucket is Epic 3 work (memory LRU only here); `flatbush` for snap segments and `rbush` for markup hit-testing.
- pdf.js 6.4.299: Node/legacy build is only for scripts; the browser uses `pdfjs-dist/build/pdf.mjs` and its worker file. CSP from Story 1.6 must allow the worker (`worker-src 'self' blob:` — check `src/proxy.ts`/headers and adjust only if required, document it). Story 2.1 found pdf.js 6 needs `wasmUrl` to decode CCITT/JBIG2/JPX images — set it (copy the wasm files to `public/` via a script or serve from `node_modules` in dev) and check CSP `wasm-unsafe-eval` is NOT required for pdf.js's image decoders; if it is, record it as a finding.
- Facts carried: code/comments/docs/commits in English; `src/core` framework-free (lint-enforced); tests co-located (node env, jsdom opt-in); exact version pins; dev port 3020; Docker Desktop off when running Vitest/Playwright locally for stable timing — and close other heavy apps during measurement, note background load in the report.
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3]
- [Source: _bmad-output/planning-artifacts/prd.md] NFR1, NFR2, A10
- [Source: _bmad-output/planning-artifacts/architecture.md] lines 48, 143, 174, 196–199, 223, 400–405, 469
- [Source: docs/spikes/2-1-btx-report.md] pdf.js 6 `wasmUrl` finding
- [Source: _bmad-output/implementation-artifacts/1-6-security-headers-error-tracking-and-logging.md] CSP

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
