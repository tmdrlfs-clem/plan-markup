# Story 7.6: Export and import tool sets in our format

Status: review

## Story

As a drafter,
I want to back up and share tool sets as files,
so that I can move them between accounts.

## Acceptance Criteria

1. **Export (FR43):** each set's Export button (Download icon, "Export <set>") saves `<set>.tools.json` locally: a versioned JSON document (`format: "plan-markup.tool-set"`, `version: 1`, `exportedAt`) with the set's name and its tools in order, each with its content (Story 7.2), device type and image embedded (base64 PNG/JPEG, fetched by its signed URL). Toast "Exported “<set>” — n tools"; a tool that cannot be read (or whose image cannot be fetched) is left out and named in the toast.
2. **Import:** the Tool Chest's Import… button takes `.btx` (Story 7.4/7.5) and `.json` (ours, by extension). Our file is checked for size (64 MB) before it is read, then validated with Zod with a tool's own limits (name, content ≤ 256 KB, ≤ 200 markups, image ≤ 8 MB, image present exactly when an image markup is, the image's bytes must be its type's signature, ≤ 1000 tools); another version is refused by number. A valid file adds a new set (its name from the file) with every tool, device and image; F7 outcomes as Story 7.4 (toast, or the report for tools that could not be saved).
3. **Invalid files change nothing:** not JSON, not ours, another version or any invalid tool → "Not a Plan Markup tool set file" with the reason (which tool), and no set is created.
4. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Format** — `core/tools/tool-file.ts` (`toolFileSchema`, `toolFileOf`, `readToolFile`, `toolFileName`, `imageMatches`, limits, `NOT_OUR_TOOL_SET`).
- [x] **Task 2: Client** — `features/tool-chest/tool-file.ts` (`exportToolSet`, `saveBlob`, `exportedText`, `importToolFile`); `ImportOutcome` invalid carries an optional title.
- [x] **Task 3: UI** — Export icon button per set; Import… (was Import .btx) accepts `.btx,.json` and routes by extension.
- [x] **Task 4: Tests** — core format 4, client 4; panel/import UI tests updated; e2e `tool-file.spec.ts` (export → delete → refuse a foreign file → import back: 5 tools, all drawn); `tool-chest.spec.ts` label.

## Dev Notes

- Defaults taken (D questions in the report):
  - one Import… button for both formats (the label changed from "Import .btx");
  - file name `<set>.tools.json` (unsafe characters removed);
  - an import always makes a new set with the file's name (even when a set of that name exists);
  - a tool whose image cannot be fetched at export is left out and named, rather than failing the export;
  - 64 MB file limit (a set of large images), 1000 tools (a set's limit).
- No server change: import reuses `createToolSet` and `addTool` (each validated server-side again).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.6], FR43, UX-DR19 (F7)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 205 files / 2061 tests pass; build ok; check:* pass; e2e tool-file, tool-chest, import-btx (incl. private) pass.

### File List

- src/core/tools/tool-file.ts (new), tool-file.test.ts (new)
- src/features/tool-chest/tool-file.ts (new), tool-file.test.ts (new), import-btx.ts, import-btx-ui.tsx, import-btx-ui.test.tsx, tool-chest-panel.tsx, tool-chest-panel.test.tsx
- e2e/tool-file.spec.ts (new), e2e/tool-chest.spec.ts
