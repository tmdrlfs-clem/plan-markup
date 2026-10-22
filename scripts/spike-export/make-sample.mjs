// Story 2.4 spike: writes the synthetic sample drawing fixtures/pdf/export-sample.pdf
// (A3 landscape, 1:100; a simple vector floor plan with a ceiling grid, rooms and
// the numbered cells of the markup set). No client content. Deterministic.
//   node --import ./scripts/spike-btx/ts-hooks.mjs scripts/spike-export/make-sample.mjs [--check]
// --check exits non-zero when the committed file differs from a fresh build.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

import {
  CELL_LABELS,
  GRID,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PLAN_BOX,
  SAMPLE_DATE,
  TEXT_RUNS,
  cellBox,
  cellCaption,
} from "@/core/export/sample-set";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SAMPLE_PATH = path.join(ROOT, "fixtures/pdf/export-sample.pdf");

/** Ceiling grid 1200 × 600 mm at 1:100 = 12 × 6 mm on paper. */
const MM = 72 / 25.4;
const GRID_X = 12 * MM;
const GRID_Y = 6 * MM;
const WALL = 2 * MM; // 200 mm walls at 1:100

export async function buildSample() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Plan Markup export sample (synthetic)", { showInWindowTitleBar: false });
  doc.setProducer("plan-markup scripts/spike-export/make-sample.mjs");
  doc.setCreationDate(SAMPLE_DATE);
  doc.setModificationDate(SAMPLE_DATE);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [px0, py0, px1, py1] = PLAN_BOX;

  const line = (x0, y0, x1, y1, thickness, gray, dash) =>
    page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness, color: rgb(gray, gray, gray), dashArray: dash });

  // Ceiling grid (light, clipped to the plan by construction).
  for (let x = px0 + WALL + GRID_X; x < px1 - WALL; x += GRID_X) line(x, py0 + WALL, x, py1 - WALL, 0.3, 0.78);
  for (let y = py0 + WALL + GRID_Y; y < py1 - WALL; y += GRID_Y) line(px0 + WALL, y, px1 - WALL, y, 0.3, 0.78);

  // Outer walls: two outlines a wall thickness apart.
  for (const inset of [0, WALL]) {
    page.drawRectangle({
      x: px0 + inset,
      y: py0 + inset,
      width: px1 - px0 - 2 * inset,
      height: py1 - py0 - 2 * inset,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1.2,
    });
  }

  // Interior walls along some cell borders, with door gaps.
  const colX = (c) => GRID.left + c * GRID.cellWidth;
  const rowY = (r) => GRID.top - r * GRID.cellHeight;
  const DOOR = 9 * MM; // 900 mm door
  const wall = (x0, y0, x1, y1) => line(x0, y0, x1, y1, WALL, 0.35);
  wall(colX(2), py1 - WALL, colX(2), rowY(1) + DOOR / 2);
  wall(colX(2), rowY(1) - DOOR / 2, colX(2), rowY(2));
  wall(px0 + WALL, rowY(2), colX(1) - DOOR / 2, rowY(2));
  wall(colX(1) + DOOR / 2, rowY(2), colX(4), rowY(2));
  wall(colX(5), rowY(1), colX(5), rowY(3) + DOOR / 2);
  wall(colX(5), rowY(3) - DOOR / 2, colX(5), rowY(4));
  wall(colX(4), rowY(4), colX(6) - DOOR / 2, rowY(4));
  wall(colX(6) + DOOR / 2, rowY(4), px1 - WALL, rowY(4));

  // Cell outlines and captions (the checklist numbers).
  for (let i = 0; i < CELL_LABELS.length; i++) {
    const [x0, y0, x1, y1] = cellBox(i);
    page.drawRectangle({ x: x0 + 2, y: y0 + 2, width: x1 - x0 - 4, height: y1 - y0 - 4, borderColor: rgb(0.55, 0.7, 0.9), borderWidth: 0.4, borderDashArray: [2, 2] });
    const c = cellCaption(i);
    page.drawText(c.text, { x: c.x, y: c.y, size: c.size, font: bold, color: rgb(0.2, 0.35, 0.6) });
  }

  // Text the text markups refer to.
  for (const run of Object.values(TEXT_RUNS)) {
    page.drawText(run.text, { x: run.x, y: run.y, size: run.size, font, color: rgb(0, 0, 0) });
  }

  // Title block.
  const tx = px1 + 15;
  const tw = PAGE_WIDTH - tx - 20;
  page.drawRectangle({ x: tx, y: py0, width: tw, height: py1 - py0, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const lines = [
    ["PLAN MARKUP", bold, 14],
    ["Export round-trip sample", font, 10],
    ["", font, 10],
    ["Synthetic drawing - no client content", font, 8],
    ["Level 1 reflected ceiling plan", font, 8],
    ["Ceiling grid 1200 x 600", font, 8],
    ["Scale 1:100 at A3", font, 8],
    ["Story 2.4 spike", font, 8],
  ];
  let y = py1 - 30;
  for (const [text, f, size] of lines) {
    if (text) page.drawText(text, { x: tx + 10, y, size, font: f, color: rgb(0, 0, 0) });
    y -= size + 8;
  }
  // Scale bar: 0-5 m.
  const barY = py0 + 40;
  for (let m = 0; m < 5; m++) {
    page.drawRectangle({ x: tx + 10 + m * 10 * MM, y: barY, width: 10 * MM, height: 4, color: m % 2 === 0 ? rgb(0, 0, 0) : rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  }
  page.drawText("0", { x: tx + 8, y: barY + 8, size: 7, font });
  page.drawText("5 m", { x: tx + 10 + 50 * MM - 6, y: barY + 8, size: 7, font });

  return doc.save({ useObjectStreams: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await buildSample();
  if (process.argv.includes("--check")) {
    const same = Buffer.compare(Buffer.from(bytes), readFileSync(SAMPLE_PATH)) === 0;
    console.log(same ? "export-sample.pdf is up to date" : "export-sample.pdf differs from the generator");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(SAMPLE_PATH, bytes);
  console.log(`${path.relative(ROOT, SAMPLE_PATH)} (${bytes.length} bytes)`);
}
