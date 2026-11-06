# Story 6.3: Offline queue and save status

Status: review

## Story

As a drafter,
I want to keep working when the network drops and always see whether my work is saved,
so that I never lose markups.

## Acceptance Criteria

1. **Queue:** changes are stored in an IndexedDB queue (`idb`) before sending and sent in order on reconnect, with exponential backoff capped at 30 s and resume on `online`; each op is re-based on the markup's latest known server version when sent (the RPC's LWW never returns CONFLICT: re-basing is how a conflict resolves) (NFR37, AR10).
2. **SaveIndicator:** `✓ Saved`, `Saving…`, `⚠ Offline — n changes waiting`, `✕ Not synced — Retry` and `Local only — Sign in to save` (session expired; re-auth keeps the queue), with a details popover (last saved, waiting count, Retry) (UX-DR10).
3. **Undo:** undo of an already-synced change is sent as a compensating op (A4).
4. **Reload:** a Playwright test edits offline, reloads the page and confirms nothing is lost after reconnect.
5. **Ctrl+S** sends now instead of opening the browser save dialog.
6. `npm run typecheck`, `lint`, `test`, `build`, `db:test` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Queue storage** — `src/lib/idb/op-queue.ts`: per-user queue (`pm-sync` database: queue, docs, versions), memory fallback.
- [x] **Task 2: Sync** — `features/markup-set/sync.ts` rewritten: diff → queue → send in order; calibrations through the queue; set input recorded for offline first edits; snapshot of hashes in sessionStorage; backoff, `online`, Ctrl+S, `pagehide`; status store.
- [x] **Task 3: SaveIndicator** — `features/markup-set/save-indicator.tsx` in the status bar slot; popover with Retry.
- [x] **Task 4: Tests** — unit (sync 21, indicator 2); `e2e/offline-queue.spec.ts`; dedicated seed users for the save e2e.

## Dev Notes

- The diff of Story 6.2 now runs against "what was queued" instead of "what was saved": once queued, a change is durable on the computer. The snapshot is kept as hashes per markup (`cyrb53` of the stable JSON of each field) in sessionStorage under `pm.sync.v1.<user>.<sha256>`, so it lives exactly as long as the editor session it describes: a new browser tab starts with neither, and never sends deletes for markups it does not have.
- Queue entries keep the client page key (`<sha256>:<index>`); the server page id and the base version are set when sent. What the set is made from (hash, filename, pages) is stored beside the queue, so the first edit of a file made offline still makes the set later.
- A request carries consecutive ops of one document with each markup at most once (the second op of a markup waits for the first one's version), about 4 MB at most; a calibrations entry goes alone.
- States: a thrown call (no network) or `navigator.onLine` false → offline; `UNAUTHENTICATED` → local only; any other failure → not synced. Every failure retries on the backoff (1, 2, 4 … 30 s); Retry, Ctrl+S and `online` retry at once.
- Since 6.2 every e2e that edits saves to the server; the save e2e read rows back, so they use their own seed users (`sync@`, `offline@`). The ≤500 ms p95 budget is asserted on the production build only (E2E_PROD=1; `next dev` compiles on demand).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3], A4, AR10, NFR3, NFR37, UX-DR10
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#F2, #SaveIndicator]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Unit: 1948 pass (full run) + indicator; e2e (dev): markup-set, markup-ops, offline-queue, measure-length, calibrate, line-tools pass in parallel; e2e (prod build): the three save specs pass.

### File List

- src/lib/idb/op-queue.ts (new)
- src/core/markup-set/markup-ops.ts (hash snapshot entries)
- src/features/markup-set/sync.ts (rewritten), sync.test.ts (rewritten), save-indicator.tsx (new), save-indicator.test.tsx (new)
- src/features/workspace/workspace-shell.tsx, workspace-status-bar.tsx
- supabase/seed.sql (sync@, offline@)
- e2e/offline-queue.spec.ts (new), e2e/markup-ops.spec.ts, e2e/markup-set.spec.ts
