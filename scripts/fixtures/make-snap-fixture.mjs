// Story 4.1 snap fixture (committed as fixtures/pdf/snap.pdf, synthetic).
//
// Page 1, A4 landscape (842 x 595 pt, user space origin at the corner):
//   - a stroked rectangle (100, 100)-(300, 250): corners are endpoints, (200, 100) a midpoint
//   - two stroked lines (400, 100)-(600, 300) and (400, 300)-(600, 100), crossing at (500, 200)
//   - a stroked circle centred (700, 200), radius 50 (four Béziers)
//   - a white-filled rectangle (100, 400)-(200, 500), no stroke: NOT a target
//   - a clip-only rectangle (300, 400)-(400, 500): NOT a target
//   - the text "SNAP" at (450, 450): NOT a target
//   - a form XObject (an embedded page holding the line (0, 0)-(100, 0)) drawn at
//     (600, 400) at half size: the line (600, 400)-(650, 400) under the form's matrix
// Page 2, A4 portrait with /Rotate 90 and its MediaBox off the origin
// ([-100, -50, 495, 792]): a stroked line (0, 0)-(200, 0) and a rectangle
// (-50, 100)-(50, 200).
//
//   node scripts/fixtures/make-snap-fixture.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PDFDocument,
  StandardFonts,
  clip,
  degrees,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from "@cantoo/pdf-lib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "fixtures", "pdf", "snap.pdf");
const DATE = new Date("2026-10-24T00:00:00Z");

const doc = await PDFDocument.create();
doc.setCreationDate(DATE);
doc.setModificationDate(DATE);
doc.setTitle("Plan Markup snap fixture");
doc.setProducer("plan-markup fixtures");
doc.setCreator("plan-markup fixtures");

const black = [setStrokingRgbColor(0, 0, 0), setLineWidth(1)];
const line = (x1, y1, x2, y2) => [moveTo(x1, y1), lineTo(x2, y2), stroke()];

// The form's content: a page that only draws (0, 0)-(100, 0).
const formSource = doc.addPage([200, 20]);
formSource.pushOperators(...black, ...line(0, 0, 100, 0));
const form = await doc.embedPage(formSource);
doc.removePage(0);

const p1 = doc.addPage([842, 595]);
p1.pushOperators(
  pushGraphicsState(),
  ...black,
  rectangle(100, 100, 200, 150),
  stroke(),
  ...line(400, 100, 600, 300),
  ...line(400, 300, 600, 100),
  // White-only fill: invisible on the sheet, not a target.
  setFillingRgbColor(1, 1, 1),
  rectangle(100, 400, 100, 100),
  fill(),
  // Clip only, never painted: not a target.
  rectangle(300, 400, 100, 100),
  clip(),
  endPath(),
  popGraphicsState(),
);
p1.drawCircle({ x: 700, y: 200, size: 50, borderColor: rgb(0, 0, 0), borderWidth: 1 });
p1.drawText("SNAP", { x: 450, y: 450, size: 24, font: await doc.embedFont(StandardFonts.Helvetica) });
p1.drawPage(form, { x: 600, y: 400, xScale: 0.5, yScale: 0.5 });

const p2 = doc.addPage([595, 842]);
p2.setMediaBox(-100, -50, 595, 842);
p2.setRotation(degrees(90));
p2.pushOperators(pushGraphicsState(), ...black, ...line(0, 0, 200, 0), rectangle(-50, 100, 100, 100), stroke(), popGraphicsState());

writeFileSync(OUT, await doc.save({ useObjectStreams: false }));
process.stdout.write(`wrote ${path.relative(ROOT, OUT)}\n`);
