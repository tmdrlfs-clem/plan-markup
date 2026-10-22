# Spike 2.3: A0 render and 500-markup frame rate

Date: 2026-10-22. Story: `_bmad-output/implementation-artifacts/2-3-spike-a0-render-and-500-markup-frame-rate.md`.

## Decision

- **Go** for L17-class drawings (real A1 RCPs, ~170-180 k operators) and for frame rate. The
  worker tile architecture (pdf.js in a worker → `ImageBitmap` tiles → Canvas2D layer stack)
  meets NFR1, NFR2 and the 50 ms long-task rule.
- **Change** for very heavy A0 files. Epic 3 adds:
  - the progressive preview (already in the worker protocol);
  - an IndexedDB raster cache keyed by sha256 + page + bucket, so a reopen paints at once;
  - optionally, an upload-time thumbnail.

  On first open, the synthetic 50 MB A0 shows a partial frame in ~0.6 s and the complete
  low-resolution frame in ~5 s, which is over NFR1's 3 s.

## Setup

- **Reference machine (A10):** Intel i5-1145G7 (4 cores / 8 threads), 15.8 GB RAM, Iris Xe,
  Windows 11 Pro 10.0.22631.
- **Browser:** Playwright 1.64.1 bundled Chromium 156.0.8078.4, headed, viewport 1920 x 1080.
- **Background load:** heavy. Bluebeam Revu (~1 GB), Outlook, Chrome, WhatsApp and Claude
  were running, with ~2.6-3.4 GB RAM free. Docker Desktop was off. The founder could not close
  these apps, so the numbers are pessimistic.
- **Fixtures** (`fixtures/README.md`):
  - L17 RCP: A1, 2.1 MB, ~176 k operators / ~398 k path segments.
  - L21 RCP: A1, 2.4 MB.
  - Synthetic A0: 50.1 MB, 3370 x 2384 pt, ~9.66 M path segments, 183 MB of uncompressed
    content, from `scripts/spike-render/make-a0.mjs`.
- **Harness:** `scripts/spike-render/measure.mjs`. It times the first tile from file bytes
  available to the first tile painted (two rAFs after `drawImage`). It runs a scripted 5 s pan at
  2x fit and a zoom sequence from fit to 8x and back. During these it collects rAF frame deltas,
  `PerformanceObserver('longtask')` entries, worker tile times and a Chrome trace. 500 seeded
  markups are on the page throughout.
- **Viewer:** `/spike/render`, gated to dev or a local flag.
- **Raw data:** `fixtures/private/traces/` (git-ignored), holding `prod-nested.out`,
  `prod-nested-l17-dpr1.json`, `results-try-*.json`, the `try-*` traces and screenshots.
- **Screenshots:** reviewed. The drawing, all 500 markups (rectangles, clouds, arrows, labels,
  sprinkler symbols) and the hover highlight render correctly.

## Results

### Evidence: L17, production build, nested pdf.js worker, DPR 1, 3 runs

| Metric | Run 1 | Run 2 | Run 3 | Median | Target |
| --- | --- | --- | --- | --- | --- |
| First low-res frame (complete preview) | 1671 ms | 1781 ms | 1258 ms | **1671 ms** | NFR1 ≤ 3 s: **pass** |
| First progressive partial frame | 470 ms | 498 ms | 458 ms | 470 ms | n/a |
| Pan fps p50 | 60.2 | 60.2 | 59.9 | **60** | NFR2 ≥ 30 (target 60): **pass** |
| Zoom fps p50 | 60.2 | 59.9 | 59.9 | **60** | **pass** |
| Longest main-thread task (Chrome trace, run 1) | 14 ms | – | – | – | ≤ 50 ms: **pass** (0 tasks > 50 ms) |
| Longest worker task (trace, run 1) | 394 ms | – | – | – | off the main thread |

In the matching dev-server run, L17 p5 fps was 58.8 for pan and zoom, and no long tasks were
recorded. Other L17 numbers from that run:

- The worker took ~240 ms p50 for a 512 px tile at bucket 0, and ~300 ms (max 374 ms) at bucket 2.
- The full-page preview took ~1.2 s in the worker.
- The tile cache peaked at 28-41 MB.
- The JS heap peaked at ~15.5 MB.
- The 500-markup draw took ≤ 0.5-1 ms (p95).

### Indicative only: synthetic A0, dev server, DPR 1, one run per setup

| Metric | Nested pdf.js worker | In-thread pdf.js |
| --- | --- | --- |
| First low-res frame | **4903 ms** (fail) | **7050 ms** (fail) |
| First partial frame | 603 ms | n/a |
| Pan / zoom fps p50 (p5) | 59.9 / 59.9 (58.8 / 58.5) | 59.9 / 60.2 (58.5 / 58.5) |
| Longest main-thread task | 0 long tasks observed | 20.4 ms (trace), 0 > 50 ms |
| Worker tile, 512 px, bucket 0 / 2 (p50) | 466 / 460 ms | 619 / 468 ms |
| Tile cache peak | 36 MB | 36 MB |

The A0 fail is an **upper-bound stress result**. The synthetic file has ~9.6 M path operators and
183 MB of content, ~50x heavier than the real RCPs (~170 k operators). Parsing alone takes ~4.4 s
(pdf.js operator list in Node), so no tile layout can paint a complete frame within 3 s on first
open. The frame rate is unaffected because everything heavy runs in the worker.

### Not measured

The founder waived the measurement rerun on 2026-10-22 after the full run was stopped for low
system memory. These items are deferred to Epic 3:

- L21 (L17 is the same class, so a similar result is expected);
- DPR 1.5;
- the 256 vs 512 vs 1024 px tile comparison;
- A0 on a production build;
- the A0 inline vs nested comparison on a production build, and multiple runs.

## Recommendations for Epic 3/4

- **pdf.js setup:** run pdf.js's parser in its own nested worker, created from a same-origin
  static `pdf.worker.min.mjs`. The render worker draws, and parsing overlaps drawing.
  - Measured on the first frame: L17 1.35-1.7 s with the nested worker vs 3.4 s in-thread (dev);
    A0 4.9 s vs 7.0 s.
  - Serve pdf.js's `wasm/`, `standard_fonts/`, `cmaps/` and `iccs/` as static same-origin assets.
    The spike's dev-only `/spike/pdfjs` route stands in for this.
  - Always set `isEvalSupported: false`.
- **Worker canvases on the CPU:** use `getContext("2d", { willReadFrequently: true })`.
  - A GPU-backed worker `OffscreenCanvas` sent millions of pdf.js path commands to the GPU
    process. The page's compositor starved and fell to ~1 fps during A0 tiles, with no main-thread
    long task. The CPU canvas fixed it.
  - pdf.js's own scratch canvases come from our `OffscreenCanvasFactory`, also with
    `willReadFrequently`.
- **Tiles:** 512 px, provisional (the size comparison was not run). pdf.js runs the whole
  operator list for every tile, with no culling. A tile therefore costs about as much as the full
  page: ~250 ms on L17 and ~0.5 s on A0. Fewer, larger tiles may do better; compare 512 and 1024 in
  Epic 3. Consider a small pool of render workers only if memory allows, since each holds the
  document.
- **Zoom buckets:** powers of two of the fit scale, ¼ to 8x (`MIN_BUCKET` -2, `MAX_BUCKET` 3),
  times the device pixel ratio.
  - At rest, the view uses the next bucket up.
  - During a gesture, the viewer scales the existing tiles over the preview and requests new
    tiles 150 ms after the view settles, with a 1-tile margin, centre first, and stale requests
    cancelled.
- **Tile cache:** an in-memory LRU with a 256 MB byte budget (w x h x 4). It peaked at 28-41 MB, so
  the budget has headroom. Epic 3 adds the IndexedDB cache (sha256 + page + bucket).
- **Preview:** keep the whole-page fit-bucket preview as the first answer. Keep progressive
  snapshots during it (first after 300 ms, then every 500 ms).
- **Layer stack** (confirmed):
  1. tile canvas (`ImageBitmap`s);
  2. static markups canvas: one batched pass per view change, culled with `rbush` 4.0.1;
  3. active/hover canvas: hit-test through the same index;
  4. DOM overlays.

  There is no React state per markup. Keep `src/core/render/tiles.ts` and the
  `src/workers/render.worker.ts` protocol. The viewer page and harness are throwaway.

## CSP findings

- No CSP change was needed. `worker-src 'self' blob:` from Story 1.6 covers the render worker,
  and `wasm-unsafe-eval` was not added.
- Turbopack-bundled worker scripts under `_next/static` get **no CSP header**: the proxy matcher
  skips `_next/static`, and a dedicated worker uses its own response's CSP. Inside the render
  worker, nothing restricts wasm or `import()`. Decide in Epic 3 whether worker scripts need a CSP
  header.
- A nested pdf.js worker loaded from an app route gets the nonce CSP (`script-src` with
  `'strict-dynamic'`, no `'wasm-unsafe-eval'` in production). This may block pdf.js's wasm image
  decoders (JBIG2/JPX/CCITT) in production. It is **unverified** (dev allows `'unsafe-eval'`). Verify
  it in Epic 3 with a JBIG2/JPX fixture. Either serve the worker as a static file without that
  policy, or record the need for `'wasm-unsafe-eval'` in a worker-only CSP.

## Other findings

- **Windows window occlusion** throttles rAF to 1 Hz when the Chromium window is covered. Runs
  then show exactly ~1000 ms frames with no long tasks. The harness turns off
  `CalculateNativeWinOcclusion` and background throttling, brings the page to the front, and
  retries such runs.
- **File tracing:** `next build` traced `fixtures/private/*.pdf` (and all of `pdfjs-dist`) into the
  spike routes' server traces. `next.config.ts` now sets `outputFileTracingExcludes`, which keeps
  `fixtures/private` out of every route's trace.
- **pdf.js in a worker** needs replacement factories because its defaults touch `document`: an
  `OffscreenCanvasFactory`, a no-op `FilterFactory`, `ownerDocument` with the worker's `fonts`, and
  an explicit `useWorkerFetch: true`. Embedded fonts render correctly through the worker's
  `FontFaceSet`.

## Gate and security of the prototype

`/spike/render`, `/spike/fixture/[name]` and `/spike/pdfjs/[...path]` return 404 unless one of
these holds:

- the server is `next dev`; or
- it is a local production build started with `PLAN_MARKUP_LOCAL_SPIKE=1` and the request goes
  to a loopback host. This mode exists so the spike can be timed with minified React.

The proxy skips the session only behind the same gate, so a default production deployment still
redirects `/spike` to sign-in. Unit tests cover the guard, the proxy, the routes and the page.
