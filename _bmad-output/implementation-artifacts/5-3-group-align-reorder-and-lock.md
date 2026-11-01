# Story 5.3: Group, align, reorder and lock

Status: ready-for-dev

## Story

As a drafter,
I want to group, align, reorder and lock markups,
so that complex markups stay tidy and safe.

## Acceptance Criteria

1. **Group:** `Ctrl+G` groups the selection (2 or more markups) into one group; `Ctrl+Shift+G` ungroups the selected groups. A click, marquee, lasso or `Ctrl+A` that selects one member selects the whole group, and the group moves, resizes, rotates, copies and deletes as one. Copies and pastes of a group form a new group. One undo step each ("Group markups", "Ungroup markups").
2. **Align (6 directions):** with 2 or more units selected (a group is one unit), Align left / centre / right / top / middle / bottom lines the units up with the selection's box as the screen shows it (view and page rotation included). One undo step ("Align markups").
3. **Reorder:** `Ctrl+Shift+]` brings the selection to the front, `Ctrl+]` forward one step, `Ctrl+[` backward one step, `Ctrl+Shift+[` to the back, within the page's drawing order (what is on top paints last and is hit first). One undo step ("Bring to front", "Bring forward", "Send backward", "Send to back"); nothing happens (no step) when the order would not change.
4. **Lock:** Lock / Unlock from the context menu. Locked markups can be selected but not moved, resized, rotated, nudged, vertex-edited or deleted until unlocked; in a mixed selection only the unlocked ones change (a deletion that kept locked ones says so). Over a locked markup the cursor is `not-allowed` with a tooltip ("Locked: right-click to unlock") instead of failing silently. Copies are unlocked. One undo step ("Lock markup(s)", "Unlock markup(s)").
5. **Context menu:** right-click on the canvas with Select selects the markup under the pointer (its group) unless it is already selected, then opens a menu: Copy, Paste, Delete; Group, Ungroup; Arrange ▸ (the 4 orders); Align ▸ (the 6 directions); Lock / Unlock; Select all. Items that cannot act are disabled. `Shift+F10` / the menu key open it for the selection. `Esc` closes it and focus goes back to the canvas. The Edit menu gets Copy, Paste, Delete, Select all, Group and Ungroup wired to the same commands.
6. **Model:** markups carry an optional `groupId` (uuid) and `locked` flag; a new `markups.reorder` op (ids, positions before and after) inverts by swapping; all ops serialise with the history (UX-DR36).
7. **Core:** order steps, align deltas and group expansion in `src/core/markup`, unit-tested.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf` at 1:100: two areas grouped with Ctrl+G move together and ungroup; reorder flips which is hit first; align left lines them up; Lock from the context menu keeps a markup from moving and Delete, Unlock frees it; each step one undo.

## Tasks / Subtasks

- [ ] **Task 1: Core** — schema `groupId` / `locked`; `markups.reorder` op; `src/core/markup/arrange.ts` (expand to groups, units, order steps, align deltas); unit tests.
- [ ] **Task 2: Viewer** — selection keys for group / ungroup / the 4 orders / align / lock / unlock (keys and `viewerCommands.selection`); the `view` in the selection key's context; `contextmenu` on the canvas with Select (painter `contextMenu`); the lock tooltip.
- [ ] **Task 3: Editor** — group expansion in the select tool, lock rules, the commands, the context menu (`markup-context-menu.tsx`), the Edit menu items; unit tests.
- [ ] **Task 4: Tests** — `e2e/group-align-lock.spec.ts` (AC 8).

## Dev Notes

- Builds on 5.1 / 5.2 (`select-tool.ts`, handles, preview). The drawing order is the document's markup list; reorder moves ids within the page's slots of that list.
- Defaults chosen here, to confirm with the founder: groups do not nest (grouping grouped markups makes one new group, D1); align uses the selection's box, locked units stay where they are but count for the box (D2); forward / backward step past the next markup on the page whether or not it overlaps (D3); locked markups can be selected, copied and reordered (D4); copies and pastes are unlocked and get a new group (D5); right-click on empty space clears the selection and offers Paste / Select all (D6).
- Revu behaviour (official help: Group, Arrange, Align, Lock markups): the same commands from the context menu and Ctrl+G / Ctrl+Shift+G / Ctrl+[ / Ctrl+].
- Layers (FR67, show / hide / lock a layer) are a later story; this is per-markup lock.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3], FR33, UX-DR13
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Keyboard Shortcuts, #Selection and editing (canvas)]
- [Source: _bmad-output/implementation-artifacts/5-2-resize-rotate-copy-and-paste.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
