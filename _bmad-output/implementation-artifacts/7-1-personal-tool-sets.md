# Story 7.1: Personal tool sets

Status: review

## Story

As a drafter,
I want to create and organise my own tool sets,
so that my symbols are ready to place.

## Acceptance Criteria

1. **Data:** a migration creates `tool_sets` (owner, name, position) and `tools` (set, owner, name, `markup` jsonb, `device` jsonb, `asset_path` under `<owner_id>/<tool_set_id>/…`, position) with owner-only RLS for active users; a tool only goes into the caller's own set; deleting a set deletes its tools; pgTAP tests (FR39, AR19).
2. **Panel:** the Tool Chest (`Alt+X`) shows my sets as collapsible groups in my order, each with its tool count and tools, with instant search over set and tool names (UX-DR19).
3. **Organise:** Create set (named in place), rename (pencil or double-click on the header), move up / down, delete.
4. **Delete confirms** with the tool count ("“Sprinkler” and its 12 tools will be deleted.").
5. **Empty state:** "No tool sets yet" with Import .btx and Create set.
6. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Database** — migration `20261109090000_tool_sets.sql`; pgTAP `tool_sets_rls.test.sql` (20); `schema.sql`, `types.gen.ts`.
- [x] **Task 2: Server** — `core/tools/tool-set.ts` (schemas, `searchToolSets`, `deleteSetText`); `lib/db/tool-sets.ts`; actions `listToolSets`, `createToolSet`, `renameToolSet`, `moveToolSet`, `deleteToolSet`.
- [x] **Task 3: Panel** — `features/tool-chest/tool-chest-panel.tsx` (store loaded on first show, optimistic changes reverted on failure, reset for another user); the shell's Tool Chest body.
- [x] **Task 4: Tests** — unit (core 3, actions 4, panel 6); `e2e/tool-chest.spec.ts`.

## Dev Notes

- Import .btx is shown disabled ("coming soon") until Story 7.4, so the empty state matches the UX without a dead end that fails.
- Set names need not be unique (Revu allows the same name twice).
- Order: fractional `position`; a move swaps two sets' positions.
- At most 500 sets per user.
- Tool tiles (preview, arm, drag) come with Stories 7.2–7.3; 7.1 lists tool names.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1], FR39, UX-DR19, AR19, architecture §Data model

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- db:test 176 pass (tool_sets_rls 20); check:* pass; unit tool-chest/workspace/core tools pass; e2e tool-chest pass (dev).

### File List

- supabase/migrations/20261109090000_tool_sets.sql (new), supabase/tests/tool_sets_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/tools/tool-set.ts (new), tool-set.test.ts (new)
- src/lib/db/tool-sets.ts (new)
- src/features/tool-chest/actions.ts (new), actions.test.ts (new), tool-chest-panel.tsx (new), tool-chest-panel.test.tsx (new)
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx, panel-registry.ts
- e2e/tool-chest.spec.ts (new)
