# 0005: Same-origin pdf.js assets and the parser worker's CSP

Date: 2026-10-22
Status: accepted (Story 3.1)

## Context

The viewer renders PDFs in `render.worker` (our bundled Web Worker). pdf.js's parser,
`pdf.worker.min.mjs`, runs as a worker nested inside it, which the Story 2.3 report recommends
(L17 first frame 1.35-1.7 s with the nested parser vs 3.4 s in-thread). pdf.js 6 also fetches
wasm image decoders (`openjpeg.wasm` for JPX, `jbig2.wasm` for JBIG2 and CCITT, `qcms_bg.wasm` for
ICC profiles), standard fonts and cmaps, and it compiles PostScript functions to wasm at run time.

A dedicated worker loaded from a URL runs under the CSP of **its own response**, not the page's.
Story 2.3 left two questions open:

- The spike served these files from an app route, so the nested worker got the app's nonce CSP:
  `'strict-dynamic'` and no `'wasm-unsafe-eval'` in production. Would the wasm decoders work?
- `_next/static` chunks, the render worker among them, get no CSP header at all, because the proxy
  skips `_next/static`.

## Decision

- **Static, versioned, same-origin assets.** `scripts/copy-pdfjs-assets.mjs` copies the parser
  worker, the wasm decoders and their JS fallbacks, `standard_fonts/`, `cmaps/`, `iccs/` and the
  licences from `pdfjs-dist` into `public/pdfjs/<version>/`. It runs on postinstall, predev and
  prebuild, and the output is git-ignored. The quickjs wasm (PDF JavaScript) is not copied:
  scripting is never set up. The files are open-source library code, so `/pdfjs/` is left out of
  the proxy matcher. No session is needed and there is no per-request work. The version in the
  path lets them be cached for a year (`immutable`).
- **A narrow CSP for the parser worker** (`PDFJS_WORKER_CSP` in `src/lib/security/headers.ts`,
  sent by `next.config.ts` on `/pdfjs/:path*`):

  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

  The parser is the code that reads untrusted PDF bytes, so it gets the tightest policy that still
  works. It can fetch and `import()` from its own origin (wasm, fonts, cmaps, fallbacks) and
  compile WebAssembly. It cannot `eval` JS, start workers or reach any other origin.
  `'wasm-unsafe-eval'` exists only in this worker's policy. The app's page CSP is unchanged.
- **Render worker without a CSP header: accepted for now.** It runs only our own bundled code
  (pdf.js's display layer with `isEvalSupported: false`), and it never parses PDF syntax itself.
  Giving `_next/static` worker chunks a header would mean a CSP on every static chunk. That is
  harmless for page scripts but untested with Turbopack's chunking, so it is left for a later
  hardening pass.

## Evidence (production build, `next build` + `next start`, Chromium 156, 2026-10-22)

`fixtures/pdf/wasm-images.pdf` holds a JPX image and a CCITT G4 image. It comes from
`scripts/fixtures/make-wasm-images.py`.

- **With the policy above:** the worker fetched `openjpeg.wasm` and `jbig2.wasm`, did **not**
  fetch either `*_nowasm_fallback.js`, logged no CSP violation, and both images rendered. The e2e
  test `viewer-open.spec.ts` asserts this in CI, against the production build.
- **The same build with `'wasm-unsafe-eval'` removed** (manifest edited, server restarted): the
  worker fetched the `.wasm` files, compiling them was refused, and pdf.js loaded
  `jbig2_nowasm_fallback.js` and `openjpeg_nowasm_fallback.js` instead. The images still rendered,
  through the slower JS decoders. That path has no ICC colour management (qcms is wasm-only) and no
  wasm PostScript functions.

So `'wasm-unsafe-eval'` is not needed for correctness, but it is needed for the decoders pdf.js is
built and tested around (speed on large scans, ICC colour). In this narrow worker-only scope it
does not weaken the page.

## Revisit

- If pdf.js drops the JS fallbacks, this directive becomes mandatory; the e2e test catches a
  regression either way.
- A CSP header for `_next/static` worker chunks (render, engine and export workers), together
  with Epic 6's export worker.
- Bumping pdf.js: the copy script follows the installed version, and the e2e and the
  `pdfjsAssetBase` test pin the path.
