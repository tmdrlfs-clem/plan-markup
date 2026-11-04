# Story 5.6: Text box, callout, typewriter, note and cloud+

Status: in-progress

## Story

As a drafter,
I want text markups,
so that I can annotate changes in words.

## Acceptance Criteria

1. **Tools and keys:** Text box (`T`), Callout (`Q`) and Cloud+ (`K`) arm from the keyboard (canvas focused); Typewriter and Note have no default key (D5); all five arm from the Tool rail: the Cloud slot becomes a menu of Cloud and Cloud+, the Text box slot a menu of Text box, Callout, Typewriter and Note (D4). The HintBar says how each works.
2. **Placing:** Text box: drag or click two corners (as Rectangle). Callout: click the point the leader points to, then where the text goes. Typewriter and Note: one click. Cloud+: draw the cloud as Cloud (closed on its first corner, Enter or a double-click), then click where the text goes. Points snap as the other markup tools do; Esc before the text cancels.
3. **Typing:** once placed, a DOM text editor overlays the canvas at the text's place (its size, colour and zoom); single-letter shortcuts are ignored while typing (focus is in the editor); Enter is a new line; Esc, Ctrl+Enter or a click elsewhere ends editing and adds the markup as one undo step ("Add text box", "Add callout", "Add typewriter", "Add note", "Add cloud+"); with no text nothing is added (D2). Ctrl+Z in the editor is the editor's own.
4. **Markups and rendering:** Zod schemas `text`, `typewriter` (the box's 4 corners, ordered from the screen's top left at creation so the text stays upright on rotated sheets), `note` (1 point), `callout` (box corners + leader tip), `cloudplus` (cloud corners + box corners); each has `text`, plain text up to 10 000 characters, stored and rendered as plain text, never HTML (NFR27). The canvas wraps the text to the box (a typewriter only at its line breaks), red 10 pt with the box's 1 pt red border (D1; a typewriter has none); a box grows down to fit its text when added (D3: Callout / Cloud+ boxes are 144 pt wide). A callout's leader runs from the box's nearer side to its tip with an arrow head; a Cloud+'s from the box to the cloud's nearest corner. A note is a 16 pt note icon (D7; its text is not drawn). Layer 2 lists them as "Text box: …", "Callout: …", "Typewriter: …", "Note: …", "Cloud+: …".
5. **Editing:** the new markups work with Select (hit on the box, icon, cloud or leader), move, nudge, delete, resize / rotate (the text turns with its box), copy / paste, group, order, align, lock; vertex handles only on a callout's tip and a Cloud+'s cloud corners. Editing the text of an existing markup is a later story (D6).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: `T` drags a box and types two words then Esc; `Q` a callout ended by a click elsewhere; `K` a Cloud+ ended with Ctrl+Enter; Typewriter and Note from the rail menu; letters typed in the editor arm no tool; each one undo step; an empty text adds nothing.

## Tasks / Subtasks

- [ ] **Task 1: Core** — schemas; text geometry (box of a markup, leader, orientation, growth, wrapping); hits; unit tests.
- [ ] **Task 2: Viewer** — tools `text`, `callout`, `typewriter`, `note`, `cloudplus`; keys `T`, `Q`, `K`; an overlay slot in the canvas viewport.
- [ ] **Task 3: Editor** — placing, the text editor overlay, committing, painting (wrapped text, borders, leaders, cloud, note icon); handles; rail menus and hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/text-tools.spec.ts` (AC 6).

## Dev Notes

- The text editor is a `<textarea>` positioned over the canvas from the frame the painter last drew (CSS px in the viewport), so it follows zoom and pan; its keydown stops at the field (Esc never reaches the viewer's window listener).
- A box's corner order carries its text direction: p0→p1 is the first line's direction, p0→p3 down the lines. It is set from the screen at creation (the page's last painted view), so text is upright on a sheet shown rotated; resize and rotation keep it through the point transforms.
- Defaults chosen here, to confirm with the founder: text and border red, 10 pt text, 1 pt border, 3 pt padding, no fill (D1); empty text adds nothing (D2); Callout / Cloud+ boxes 144 pt wide from the click, every box grows down to fit its text when added (D3); Cloud and Cloud+ share a slot, Text box / Callout / Typewriter / Note another (D4); no keys for Typewriter and Note (D5, none in the UX table); editing existing text later (D6, with Properties); a note is a 16 pt icon, its text shown only in the editor and lists (D7).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.6], FR31, NFR27
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Keyboard Shortcuts]
- [Source: _bmad-output/implementation-artifacts/5-5-rectangle-ellipse-and-cloud-tools.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
