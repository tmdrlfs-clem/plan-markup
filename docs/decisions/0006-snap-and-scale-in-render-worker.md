# 0006: Snap indexing and scale detection in the render worker

Date: 2026-10-24
Status: accepted (Stories 4.1, 4.2; review of 4.2)

## Context

The architecture (AR14, `architecture.md` → Frontend Architecture → Workers) plans three workers:
`render.worker` (pdf.js), `engine.worker` (hash, vector extraction, snap index build, dynamic fill,
4541 placement) and `export.worker` (`@cantoo/pdf-lib`). Stories 4.1 (snap to linework) and 4.2
(printed scales) were written against `engine.worker`.

Both features read what pdf.js already holds for the page:

- **Snap** (4.1) extracts vector segments from the page's operator list. Reading the list is the
  cost: 0.8-1.1 s on the founder's L17 / L21 sheets and about 4 s on the synthetic A0. Extraction
  plus the `flatbush` build is 70-100 ms on L17 / L21 (300 ms on A0).
- **Scale detection** (4.2) reads the page's text items, which the render worker already
  extracts and caches (memory, then IndexedDB) for search (3.6) and sheet labels (3.3). Detection
  itself takes 5-10 ms per page.

Only the render worker holds the parsed pdf.js document (one per tab, Story 3.5). An
`engine.worker` would need either a second pdf.js parse of the whole file (about 1.2-4.5 s and the
file's memory a second time per tab) or a structured clone of every operator list and text
content across workers.

## Decision

- `snap.buildIndex` and `scale.detect` are jobs of **`render.worker`**, using the same AR14
  message protocol (`{ type: '<domain>.<verb>', reqId, payload }` → `result | progress | error`,
  Zod at the boundary, `serializeWorkerError` with a `code`), the same queue, priority and cancel
  rules: after tiles; text-based jobs with `render.text`, the snap index last; a job that needs
  pdf.js while it is still parsing waits off the queue's head.
- Snap queries run on the main thread against the transferred index (three buffers, zero copy;
  a query is 0.04-0.1 ms p95), so the pointer frame needs no worker round trip.
- The framework-free cores stay in `src/core/snap` and `src/core/scale`, so moving the jobs to
  another worker later changes only the host, not the logic.
- No `engine.worker` exists yet.

## Consequences

- No second parse and no second copy of the document per tab; snapping and scale detection reuse
  the render worker's caches.
- Long snap extractions share the render worker's single queue with tiles. Mitigated by priority
  (tiles first), by building neighbour indices only while a snapping tool is armed (4.1 review S1)
  and by the 1,000,000-segment cap (accepted by the founder, 2026-10-24).
- The main thread still never parses, extracts or builds an index (AR14's rule holds); only the
  worker the work runs in differs from the plan.
- The render worker's code grows; its job handlers stay thin wrappers over `src/core`.

## When to split out `engine.worker`

Create `engine.worker` when work arrives that does **not** need pdf.js's parsed document, or that
is long enough to starve tile rendering:

- dynamic fill (the live spreading fill bounded by drawing lines, Story 4.10) and **4541 sprinkler placement**
  (seconds per floor, operation-count budgets, NFR6): CPU-bound geometry fed with segments or
  outlines the render worker has already extracted (transferred buffers);
- whole-file sha256 hashing for drawing identity, if it moves off the render worker;
- any job measured above about 100 ms per page that would delay the next page's tiles.

At that point the render worker keeps reading pdf.js (operator lists, text) and hands transferred
buffers to `engine.worker`; snap index building may move with them if profiling shows tiles
waiting behind it. Revisit this decision when Story 4.10 (dynamic fill) or Epic 9 (4541 layout engine) starts.
