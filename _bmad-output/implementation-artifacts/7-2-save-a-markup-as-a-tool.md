# Story 7.2: Save a markup as a tool

Status: review

## Story

As a drafter,
I want to save any configured markup or symbol as a tool, optionally as a device,
so that I can reuse it and count it.

## Acceptance Criteria

1. **Add:** with markups selected, the markup context menu's "Add to Tool Chest…" opens a dialog: Name (suggested from the subject), Tool set (an existing set or a new one; a new set when there is none), "Count as a device" with Group, Label (required) and Description (FR40).
2. **Content:** the tool stores the selection's geometry and style (all selected markups, in drawing order), centred on the origin, off any page/layer/group, unlocked, with the source page's calibration and UserUnit (for Story 7.3's real-size placement).
3. **Images:** an image's pixels go to the private `tool-assets` bucket at `<owner_id>/<tool_set_id>/<tool_id>.png|jpg`; only the owner (active) reads or writes there, and only under their own set; one image per tool; bytes must match the claimed type (AR19).
4. **Tile:** each tool shows as a tile with its preview (canvas, its markups fitted) and name; a device shows its label. Images are fetched by signed URL (10 min) and drawn from a data URL (the CSP keeps img-src to self/blob/data).
5. **Persistence:** tools survive a reload; deleting a set deletes its tools and their images.
6. `npm run typecheck`, `lint`, `test`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Core** — `core/tools/tool.ts` (content schema v1, device schema, `addToolSchema`, `toolContentOf`, `toolMarkups`, `imageUpload`, `suggestedToolName`).
- [x] **Task 2: Storage** — migration `20261109100000_tool_assets.sql` (bucket 8 MB png/jpeg, `app.fn_owns_tool_asset_path`, policies); pgTAP `tool_assets_rls.test.sql` (9).
- [x] **Task 3: Server** — `lib/db/tool-sets.ts` `addTool` (magic-byte check, set resolve/create, per-set cap 1000, upload then insert, object removed if the insert fails), `listToolSets` with tools and signed URLs, `deleteToolSet` removes the set's images; action `addTool`.
- [x] **Task 4: UI** — `add-tool-store.ts`, `add-tool-dialog.tsx`, `tool-preview.tsx` (uses the editor's `paintMarkupsPreview`, a refactor of the static layer's paint loop, and `decodeMarkupImage`); context menu item; tiles in the panel; dialog mounted in the shell.
- [x] **Task 5: Tests** — unit: core tool 4, actions +2, dialog 5, preview 1, db imageMatches 1, context menu +1; e2e `save-tool.spec.ts` (rectangle as a device in a new set; an image tool after reload). e2e helper clears the isolated user's tool sets.

## Dev Notes

- Defaults taken (D questions in the report): "Add to Tool Chest…" in the context menu only (not the Edit menu yet); the whole selection becomes one tool; the name is suggested from the subject; a new set is named "My tools"; tiles 72 px wide with a 48 px preview.
- Placing a tool (click/drag on the canvas) and device counts are Story 7.3.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2], FR40, AR19, UX-DR19

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 2010 pass; db:test 185 pass; check:* pass; e2e save-tool (2) + tool-chest pass (dev).

### File List

- supabase/migrations/20261109100000_tool_assets.sql (new), supabase/tests/tool_assets_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/tools/tool.ts (new), tool.test.ts (new), tool-set.ts, tool-set.test.ts
- src/lib/db/tool-sets.ts, tool-sets.test.ts (new)
- src/features/tool-chest/actions.ts, actions.test.ts, tool-chest-panel.tsx, tool-chest-panel.test.tsx, add-tool-store.ts (new), add-tool-dialog.tsx (new), add-tool-dialog.test.tsx (new), tool-preview.tsx (new), tool-preview.test.ts (new)
- src/features/editor/measure-tool.ts, image-tool.ts, index.ts, markup-context-menu.tsx, markup-context-menu.test.tsx
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx
- e2e/save-tool.spec.ts (new), e2e/helpers.ts
