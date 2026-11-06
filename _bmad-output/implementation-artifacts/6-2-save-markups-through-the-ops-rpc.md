# Story 6.2: Save markups through the ops RPC

Status: done

## Story

As a drafter,
I want every markup change saved to my account,
so that my work is safe without pressing Save.

## Acceptance Criteria

1. **Table:** a migration creates `markups` (client uuid v7 `id`, `drawing_id`, `page_id`, `type`, `geometry`/`style`/`props` jsonb, `z` drawing order, `version`, `field_versions`, `author_id`, `updated_by`, `created_at`, `updated_at`, `deleted_at`) with RLS through `app.fn_effective_access(drawing_id)` (owner only until Epic 8 shares). Users read only; every write goes through the RPC (FR49, AR6).
2. **RPC:** `apply_markup_ops(drawing_id, ops)` is SECURITY DEFINER, re-checks access (active user, edit access), rate-limits op writes per user (Postgres counter, `PT429`), and applies each op `{opId, markupId, kind: create|update|delete, type, pageId?, fields?, baseVersion, clientTs}` in order (AR10, NFR22):
   - field-level last-write-wins over `geometry`, `style`, `props`, `z`: a field another write changed after the op's `baseVersion` at a later (clamped) client time is kept;
   - tombstones win: an update or a create from a client that has not seen the delete is ignored (`deleted`); a create with `baseVersion` ≥ the tombstone's version restores it (undo of a delete, A4);
   - a replayed `opId` changes nothing; protected fields (id, drawing, author, versions, timestamps, deleted_at) cannot be set; another drawing's markup id or page is refused;
   - returns `{opId, markupId, status: applied|deleted|missing, version}` per op.
3. **Records:** author, creation and modification time (and who modified) are recorded for every markup (FR55).
4. **Validation:** the server action validates ops with the shared Zod schemas (each field against its markup type's part schema, NFR24); the RPC re-checks structure and sizes for direct callers.
5. **Client:** markup changes (do, undo, redo; compound ops) are diffed against the last saved state and sent batched (~300 ms), one request in flight per document; the UI never waits (NFR3); a failed batch is sent again with the next change (Story 6.3 queues it). Drawing order is saved as a fractional `z` (only moved markups change).
6. **Casing:** snake_case ↔ camelCase only in `src/lib/db/markups.ts` (AR7).
7. **Tests:** pgTAP covers RLS, LWW, tombstones, restore, replay, protected fields and IDOR (NFR21); unit tests cover the split/join, part validation, diff and z order, and the sync; e2e draws, edits, deletes and undoes on `scales.pdf` and reads the rows back, and measures the op round trip (≤500 ms p95 on the local stack, NFR4).
8. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:schema`, `check:types`, `check:rls` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Database** — migration `20261107090000_markups.sql` (`app.fn_effective_access`, `markups`, select policy, `public.apply_markup_ops`); `supabase/tests/markups_rls.test.sql`; schema.sql and types.gen.ts regenerated.
- [x] **Task 2: Core** — `core/markup-set/markup-ops.ts`: split/join a markup into type/page/geometry/style/props, per-type part schemas, op and input schemas, `diffMarkups` with fractional z; unit tests.
- [x] **Task 3: Server** — `lib/db/markups.ts` (casing, error codes); `features/markup-set/actions.ts` `applyMarkupOps`; `serverActions.bodySizeLimit` for image markups.
- [x] **Task 4: Client** — `features/markup-set/sync.ts`: markups ops mark the document dirty; diff, send, keep versions; one request in flight per document; unit tests.
- [x] **Task 5: Tests** — `e2e/markup-ops.spec.ts` (rows after draw/edit/delete/undo, op round trip p95).

## Dev Notes

- Fields are the three jsonb columns plus `z`. `geometry` holds `points`, `holes` and `captionOffset`; `props` everything else of the markup but `id`, `type`, `pageId` and `style` (including the client `createdAt`). `type` and `page_id` never change after create.
- `field_versions` = `{ field: { "v": version, "ts": clientTs ms } }`; client times are clamped to the server's now so a fast clock cannot win forever.
- The page id is mapped from the client key (`<sha256>:<index>`) by index, as in 6.1. A markup on a page the set does not know is not sent.
- Not in this story: layers (names/order) are local until a later story; restoring markups is Story 6.4; the IndexedDB queue and SaveIndicator are Story 6.3.
- The RPC is the only writer: users have SELECT on `markups` only. Direct callers bypass Zod, so the RPC checks types, keys and sizes; a malformed row only affects the caller's own set and is skipped on restore (Zod).
- Rate limit: 600 calls per user per minute through `public.consume_rate_limit` (called by the definer RPC).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2], A4, AR6, AR7, AR10, NFR3, NFR4, NFR21, NFR22, NFR24, FR49, FR55
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture, #API & Communication Patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `field_versions` holds `{v, ts}` per field; a field is kept only when another write changed it after the op's base at a later (clamped) client time. A create with `baseVersion` ≥ the tombstone's version restores (undo); otherwise the tombstone wins. Replays are recognised by `last_op_id`. pgTAP: 37 tests.
- Task 2: geometry = `points`, `holes`, `captionOffset`; props = the rest (incl. the client `createdAt`). Part schemas are derived from `markupSchema` (strict), so a props update carries the whole props.
- Task 4: only what the server confirmed becomes the saved state; a failed or partly sent batch is diffed again with the next change. Requests split at ~4 MB (`serverActions.bodySizeLimit` 16 MB for image markups).
- Local: unit 1941 pass; db:test 151 pass; e2e markup-ops + markup-set pass (dev server); op round trip median 57 ms, p95 80 ms (n=20).
- Local Docker note: after Docker Desktop starts, the Supabase containers can come up without published ports (API connection refused); `npm run db:stop && npm run db:start` fixes it.

### File List

- supabase/migrations/20261107090000_markups.sql (new), supabase/tests/markups_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/markup-set/markup-ops.ts (new), markup-ops.test.ts (new)
- src/lib/db/markups.ts (new)
- src/features/markup-set/actions.ts, actions.test.ts, sync.ts, sync.test.ts
- src/features/workspace/workspace-shell.test.tsx
- next.config.ts
- e2e/markup-ops.spec.ts (new)
