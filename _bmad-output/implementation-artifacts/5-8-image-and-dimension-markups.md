# Story 5.8: Image and dimension markups

Status: review

## Story

As a drafter,
I want to place images and dimension lines,
so that I can add photos and dimensioned notes.

## Acceptance Criteria

1. **Tools:** the rail's Image button (in the Freehand group) asks for a PNG or JPEG file; Dimension is in the line tools' menu. Neither has a key (D4, none in the UX table). The HintBar says how each works.
2. **Image, safely:** a file is refused, with a toast saying why, when it is over 10 MB, is not a PNG or JPEG by its signature (an SVG or anything else never reaches a decoder), or declares more than 50 megapixels in its header. An accepted file is decoded by the browser, scaled down to at most 2048 px on its longest side and re-encoded (its metadata dropped), and stored in the markup as a PNG or JPEG data URL (the schema accepts nothing else, NFR27).
3. **Image, placing:** with an image picked, Image is armed; a click places it centred there, upright on screen, at its natural size (96 px an inch) or smaller to fit in 40 % of the view (D1), as one undo step ("Add image"); Select then has it (D2) and its handles resize it (Shift keeps its aspect), rotate it and move it. Another tool or Esc drops the picked image. An image still decoding shows its box crossed out.
4. **Dimension:** click the two points to dimension, then a third for where the dimension line goes (points snap; Alt off). The line runs parallel to the measured points at the third point's offset, with extension lines from 2 pt off the points to 3 pt past the line and an arrow head at each end; its caption, above the line's middle and readable, is the calibrated length of the measured points (never stored), or "Scale not set" in the warning colour on an uncalibrated page. One undo step ("Add dimension"); the tool stays armed. While drawing it previews with the live length. Layer 2 lists "Image" and "Dimension: …".
5. **Editing:** both work with Select (an image hit inside its box, a dimension by its lines), move, nudge, delete, resize / rotate, copy / paste, group, order, align, lock; an image has no vertex handles, a dimension's three points do (D3).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: the rail's Image picks a 200 × 100 px PNG, a click places it at 150 × 75 pt (its pixels on the canvas) with Select; its corner handle with Shift doubles it; a Dimension along the rectangle's edge reads "Scale not set"; each one undo step.

## Tasks / Subtasks

- [x] **Task 1: Core** — `image` and `dimension` schemas; core/markup/image.ts (signature and declared size, refusals, fitting), core/markup/dimension.ts (line, outline); hits, bounds; unit tests.
- [x] **Task 2: Viewer** — tools `image`, `dimension` (markup tools; Dimension snaps).
- [x] **Task 3: Editor** — image-tool.ts (pick, check, decode, re-encode, place, decoded-image cache, paint); Dimension placing, preview, painting and caption; rail (Image button with its file input, Dimension in the line tools' menu) and hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/image-dimension.spec.ts` (AC 6), in CI.

## Dev Notes

- The image is checked before decoding from its first 64 KB (PNG IHDR; JPEG markers to the first SOF), so a small file declaring a huge image is refused before the browser allocates it. CSP `img-src` already allows `data:`.
- Images are stored inline as data URLs for now; Epic 6 (persistence) may move them to storage by reference.
- Defaults chosen here, to confirm with the founder: an image at its natural size or within 40 % of the view (D1); after placing, back to Select with the image selected (D2: one image per pick); a dimension's points keep vertex handles, an image none (D3); no keys for Image and Dimension, Image in the Freehand group, Dimension in the line tools' menu (D4); a dimension is a markup, not a measurement: it is not in the Measurements panel and its caption does not move (D5).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.8], FR31, NFR27
- [Source: _bmad-output/implementation-artifacts/5-7-pen-and-highlight-tools.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `imageMarkupSchema` (4 corners, `src` a PNG / JPEG base64 data URL, at most 12 M characters), `dimensionMarkupSchema` (3 points); `sniffImage`, `imageRefusal`, `fitSize`; `dimensionLine`, `dimensionOutline`; an image is hit inside its box, a dimension by its line and extension lines; bounds and marquee by its outline. Unit tests.
- Task 2: `image` and `dimension` join `MarkupTool`; Dimension is a snapping tool.
- Task 3: `pickImageFile` (refusals as toasts; the decoder injectable for tests), `imageMarkupAt` (centred, upright from the page's last painted view, fitted), the decoded-image cache (painted again when loaded; crossed-out box until then), `paintImage` (the image mapped onto its box). measure-tool: Image's click adds it and selects it with Select; leaving Image drops the pick; Dimension (3 fixed points), `paintDimension`, its preview with the live length; layer 2 labels. Rail: Image button and hidden file input; Dimension in the Lines menu; hints.
- Unit tests: 1863 pass. Local e2e not run (Docker off); CI runs `e2e/image-dimension.spec.ts`.

### File List

- src/core/schema/markup.ts, src/core/markup/image.ts (new), image.test.ts (new), dimension.ts (new), dimension.test.ts (new), geometry.ts
- src/features/viewer/viewer-store.ts, snap-controller.ts
- src/features/editor/image-tool.ts (new), image-dimension.test.ts (new), measure-tool.ts, text-tool.ts, handles.ts, undo-store.ts, index.ts
- src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/image-dimension.spec.ts (new)
