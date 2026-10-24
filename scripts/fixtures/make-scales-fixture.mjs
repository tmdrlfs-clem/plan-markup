// Story 4.2 printed-scale fixture (committed as fixtures/pdf/scales.pdf, synthetic).
//
//   page 1  A1 landscape: title block "SCALE 1:100 @ A1"            -> Scale 1:100 @ A1 detected
//   page 2  A3 landscape: the same title block                     -> 1:200 on this A3 page
//   page 3  A1 landscape: viewport labels "PLAN 1:50", "SECTION A 1:100",
//           and "SECTION B 1:100" (the same scale again)            -> 2 scales on page
//   page 4  A3 landscape: "SCALE: As indicated", "FALLS 1:40 TO OUTLET",
//           "DATE 12/10/2026 1:30 PM", "1:100 YEAR FLOOD LEVEL"     -> Scale not set
//   page 5  A1 landscape: a view title stating two sheets that disagree,
//           "PLAN VIEW 1 : 75 @ A1 1 : 200 @ A3" (as on L21; 1:75 @ A1
//           is 1:150 @ A3)                                       -> Scales disagree (4.2 review D1)
//
//   node scripts/fixtures/make-scales-fixture.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "fixtures", "pdf", "scales.pdf");
const DATE = new Date("2026-10-24T00:00:00Z");
const MM = 72 / 25.4;
const A1 = [841 * MM, 594 * MM];
const A3 = [420 * MM, 297 * MM];

const doc = await PDFDocument.create();
doc.setCreationDate(DATE);
doc.setModificationDate(DATE);
doc.setTitle("Plan Markup printed-scale fixture");
doc.setProducer("plan-markup fixtures");
doc.setCreator("plan-markup fixtures");
const font = await doc.embedFont(StandardFonts.Helvetica);

/** A page with a border, a title block box and the given texts ([text, x, y, size]). */
function page(size, texts) {
  const p = doc.addPage(size);
  const [w, h] = size;
  p.drawRectangle({ x: 20, y: 20, width: w - 40, height: h - 40, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  p.drawRectangle({ x: w - 260, y: 20, width: 240, height: 90, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  for (const [text, x, y, s] of texts) p.drawText(text, { x, y, size: s, font });
  return p;
}

const title = (size) => [["SCALE 1:100 @ A1", size[0] - 250, 40, 12]];
page(A1, title(A1));
page(A3, title(A3));
page(A1, [
  ["PLAN 1:50", 200, 900, 14],
  ["SECTION A 1:100", 1200, 900, 14],
  ["SECTION B 1:100", 1200, 400, 14],
]);
page(A3, [
  ["SCALE: As indicated", A3[0] - 250, 40, 10],
  ["FALLS 1:40 TO OUTLET", 100, 500, 10],
  ["DATE 12/10/2026 1:30 PM", A3[0] - 250, 60, 8],
  ["1:100 YEAR FLOOD LEVEL", 100, 400, 10],
]);
page(A1, [["PLAN VIEW 1 : 75 @ A1 1 : 200 @ A3", 200, 300, 14]]);

writeFileSync(OUT, await doc.save({ useObjectStreams: false }));
process.stdout.write(`wrote ${path.relative(ROOT, OUT)}\n`);
