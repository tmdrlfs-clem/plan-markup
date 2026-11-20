// Synthetic export sample (Story 2.4): the page layout shared with the sample
// drawing generator (scripts/spike-export/make-sample.mjs) and one markup of
// every MVP type, in PDF user space of that page. No client content.
//
// The page is A3 landscape at 1:100 (mm): a floor plan with a ceiling grid and
// rooms, overlaid by a 7 × 5 grid of numbered cells, one markup type per cell.

import { textBlockSize } from "./appearance";
import { HELVETICA_ASCENT, HELVETICA_DESCENT, helveticaWidth } from "../pdf/helvetica";
import type { Box, Calibration, ExportDocument, Markup, Pt, Rgb } from "./model";

export const PAGE_WIDTH = 1190.55; // 420 mm
export const PAGE_HEIGHT = 841.89; // 297 mm

export const GRID = { left: 45, top: 790, cellWidth: 125, cellHeight: 144, columns: 7, rows: 5 } as const;
/** Plan outline (outer wall centre line). */
export const PLAN_BOX: Box = [GRID.left - 5, GRID.top - GRID.rows * GRID.cellHeight - 5, GRID.left + GRID.columns * GRID.cellWidth + 5, GRID.top + 5];

export const CALIBRATION: Calibration = {
  label: "1:100",
  unit: "m",
  unitsPerPoint: (0.0254 / 72) * 100,
  decimals: 2,
};

export const AUTHOR = "Plan Markup spike";
export const SAMPLE_DATE = new Date(Date.UTC(2026, 9, 22, 9, 0, 0));

/** Checklist row name of each cell, in order. */
export const CELL_LABELS = [
  "line",
  "arrow",
  "polyline",
  "polygon",
  "rectangle",
  "ellipse",
  "arc",
  "cloud",
  "cloud+",
  "callout",
  "text box",
  "typewriter",
  "note",
  "highlight",
  "pen",
  "underline",
  "strikethrough",
  "stamp (vector)",
  "image stamp",
  "dimension",
  "hyperlink",
  "flag",
  "length",
  "polylength",
  "area",
  "perimeter",
  "count",
  "angle",
  "radius",
  "diameter",
  "dynamic fill",
  "white-out",
  "device stamp",
  "group of three",
  "two layers",
] as const;

export function cellBox(i: number): Box {
  const col = i % GRID.columns;
  const row = Math.floor(i / GRID.columns);
  const x0 = GRID.left + col * GRID.cellWidth;
  const y1 = GRID.top - row * GRID.cellHeight;
  return [x0, y1 - GRID.cellHeight, x0 + GRID.cellWidth, y1];
}

/** Drawing area of a cell (below the caption). */
export function innerBox(i: number): Box {
  const [x0, y0, x1, y1] = cellBox(i);
  return [x0 + 14, y0 + 12, x1 - 14, y1 - 22];
}

/** Point at fractions (fx, fy) of a cell's inner box. */
export function at(i: number, fx: number, fy: number): Pt {
  const [x0, y0, x1, y1] = innerBox(i);
  return [round(x0 + (x1 - x0) * fx), round(y0 + (y1 - y0) * fy)];
}

function boxAt(i: number, fx0: number, fy0: number, fx1: number, fy1: number): Box {
  const a = at(i, fx0, fy0);
  const b = at(i, fx1, fy1);
  return [a[0], a[1], b[0], b[1]];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Caption text drawn by the sample generator at the top-left of each cell. */
export function cellCaption(i: number): { text: string; x: number; y: number; size: number } {
  const [x0, , , y1] = cellBox(i);
  return { text: `${String(i + 1).padStart(2, "0")} ${CELL_LABELS[i]}`, x: x0 + 5, y: y1 - 11, size: 7 };
}

/** A run of page text (Helvetica) that text markups (highlight, underline, …) refer to. */
export type TextRun = { text: string; x: number; y: number; size: number };

function runFor(i: number, str: string, size = 11, fy = 0.45): TextRun {
  const [x0, , x1] = innerBox(i);
  const w = helveticaWidth(str, size);
  const [, cy] = at(i, 0, fy);
  return { text: str, x: round(x0 + (x1 - x0 - w) / 2), y: cy, size };
}

/** Text the generator writes into the page so text markups and the white-out have a target. */
export const TEXT_RUNS = {
  highlight: runFor(13, "OFFICE 1"),
  underline: runFor(15, "MEETING ROOM"),
  // A squiggly underline shares the underline's cell, on a second line.
  squiggly: runFor(15, "CHECK", 11, 0.15),
  strikeout: runFor(16, "STORE 2"),
  whiteout: runFor(31, "TEMP NOTE", 10),
  hyperlink: runFor(20, "SPEC SHEET", 10),
} satisfies Record<string, TextRun>;

/** The quad (box) a text run occupies: baseline-relative ascent/descent. */
export function runQuad(run: TextRun): Box {
  const w = helveticaWidth(run.text, run.size);
  return [
    run.x,
    round(run.y + (HELVETICA_DESCENT / 1000) * run.size),
    round(run.x + w),
    round(run.y + (HELVETICA_ASCENT / 1000) * run.size),
  ];
}

/** A small deterministic RGB test image (red ring on a blue-white gradient). */
export function sampleImage(size = 48): { width: number; height: number; rgb: Uint8Array } {
  const rgb = new Uint8Array(size * size * 3);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const d = Math.hypot(x - c, y - c) / c;
      const ring = d > 0.62 && d < 0.9;
      rgb[i] = ring ? 210 : 230 - Math.round((y / size) * 90);
      rgb[i + 1] = ring ? 30 : 236 - Math.round((y / size) * 60);
      rgb[i + 2] = ring ? 30 : 255;
    }
  }
  return { width: size, height: size, rgb };
}

const RED: Rgb = [0.85, 0.1, 0.1];
const BLUE: Rgb = [0, 0.3, 0.85];
const GREEN: Rgb = [0, 0.55, 0.2];
const MAGENTA: Rgb = [0.7, 0, 0.7];

export const LAYERS = [
  { id: "measure", name: "Measurements", visible: true },
  { id: "fire", name: "Fire protection", visible: true },
];

const base = (id: string, subject: string): { id: string; subject: string; author: string } => ({ id, subject, author: AUTHOR });

function markups(): Markup[] {
  const r = TEXT_RUNS;
  const cloudText = textBoxAt(8, 0.4, 0.92, "Check bulkhead", 7);
  const cloudTextX = round((cloudText[0] + cloudText[2]) / 2);
  return [
    { ...base("pm-line", "Line"), type: "line", from: at(0, 0.05, 0.2), to: at(0, 0.95, 0.8), color: RED, width: 1.5 },
    { ...base("pm-arrow", "Arrow"), type: "arrow", from: at(1, 0.05, 0.2), to: at(1, 0.95, 0.8), endings: ["None", "ClosedArrow"], color: RED, fill: RED, width: 1.5 },
    { ...base("pm-polyline", "Polyline"), type: "polyline", points: [at(2, 0.05, 0.1), at(2, 0.35, 0.9), at(2, 0.65, 0.15), at(2, 0.95, 0.85)], color: BLUE, width: 1.5 },
    { ...base("pm-polygon", "Polygon"), type: "polygon", points: [at(3, 0.1, 0.1), at(3, 0.9, 0.2), at(3, 0.75, 0.9), at(3, 0.2, 0.75)], color: BLUE, fill: [0.85, 0.9, 1], width: 1.5 },
    { ...base("pm-rectangle", "Rectangle"), type: "rectangle", rect: boxAt(4, 0.1, 0.15, 0.9, 0.85), color: RED, width: 2, dash: [4, 2] },
    { ...base("pm-ellipse", "Ellipse"), type: "ellipse", rect: boxAt(5, 0.05, 0.15, 0.95, 0.85), color: GREEN, fill: [0.85, 1, 0.85], width: 1.5, opacity: 0.8 },
    { ...base("pm-arc", "Arc"), type: "arc", center: at(6, 0.5, 0.15), radius: 40, startDeg: 15, sweepDeg: 150, color: MAGENTA, width: 1.5 },
    { ...base("pm-cloud", "Cloud"), type: "cloud", points: [at(7, 0.12, 0.15), at(7, 0.88, 0.15), at(7, 0.88, 0.85), at(7, 0.12, 0.85)], intensity: 1, color: RED, width: 1.2 },
    {
      ...base("pm-cloudplus", "Cloud+"),
      type: "cloudPlus",
      points: [at(8, 0.05, 0.05), at(8, 0.5, 0.05), at(8, 0.5, 0.45), at(8, 0.05, 0.45)],
      intensity: 1,
      textRect: cloudText,
      // Arrow at the cloud edge, knee below the text box, end on the box's bottom edge.
      leader: [at(8, 0.52, 0.3), [cloudTextX, at(8, 0, 0.55)[1]], [cloudTextX, cloudText[1]]],
      text: "Check bulkhead",
      fontSize: 7,
      textColor: RED,
      color: RED,
      width: 1.2,
    },
    {
      ...base("pm-callout", "Callout"),
      type: "callout",
      textRect: boxAt(9, 0.3, 0.6, 1, 0.98),
      leader: [at(9, 0.05, 0.1), at(9, 0.15, 0.75), at(9, 0.3, 0.75)],
      text: "Relocate head\n300 from light",
      fontSize: 7,
      textColor: [0, 0, 0],
      color: BLUE,
      fill: [1, 1, 0.85],
      width: 1,
    },
    {
      ...base("pm-textbox", "Text Box"),
      type: "textBox",
      rect: boxAt(10, 0.05, 0.25, 0.95, 0.75),
      text: "Existing pipe\nto be removed",
      fontSize: 9,
      textColor: BLUE,
      color: BLUE,
      width: 1,
    },
    { ...base("pm-typewriter", "Typewriter"), type: "typewriter", at: at(11, 0.05, 0.7), text: "FFL +3.150", fontSize: 10, textColor: [0, 0, 0] },
    { ...base("pm-note", "Note"), type: "note", at: at(12, 0.42, 0.35), text: "Confirm ceiling height with architect." },
    { ...base("pm-highlight", "Highlight"), type: "highlight", quads: [runQuad(r.highlight)], color: [1, 0.9, 0] },
    {
      ...base("pm-pen", "Pen"),
      type: "pen",
      strokes: [
        [at(14, 0.05, 0.4), at(14, 0.2, 0.7), at(14, 0.35, 0.45), at(14, 0.5, 0.75), at(14, 0.65, 0.4), at(14, 0.8, 0.7), at(14, 0.95, 0.5)],
        [at(14, 0.1, 0.15), at(14, 0.9, 0.2)],
      ],
      color: MAGENTA,
      width: 2,
    },
    { ...base("pm-underline", "Underline"), type: "underline", quads: [runQuad(r.underline)], color: GREEN },
    { ...base("pm-strikeout", "Strikethrough"), type: "strikeout", quads: [runQuad(r.strikeout)], color: RED },
    { ...base("pm-stamp", "Stamp"), type: "stamp", rect: boxAt(17, 0.02, 0.3, 0.98, 0.7), label: "APPROVED", color: [0.75, 0.1, 0.1] },
    { ...base("pm-image", "Image"), type: "imageStamp", rect: squareAt(18, 0.5, 0.5, 70), image: sampleImage() },
    { ...base("pm-dimension", "Dimension"), type: "dimension", from: at(19, 0.05, 0.25), to: at(19, 0.95, 0.25), leader: 30, leaderExtension: 4, color: BLUE, fill: BLUE, width: 0.8, layer: "measure" },
    { ...base("pm-hyperlink", "Hyperlink"), type: "hyperlink", rect: runQuadPadded(r.hyperlink, 3), uri: "https://example.com/spec-sheet" },
    { ...base("pm-flag", "Flag"), type: "flag", rect: boxAt(21, 0.35, 0.2, 0.7, 0.85), layer: "fire" },
    { ...base("pm-length", "Length Measurement"), type: "length", from: at(22, 0.05, 0.3), to: at(22, 0.95, 0.7), color: RED, width: 1, layer: "measure" },
    { ...base("pm-polylength", "Polylength Measurement"), type: "polylength", points: [at(23, 0.05, 0.1), at(23, 0.05, 0.7), at(23, 0.6, 0.7), at(23, 0.95, 0.2)], color: RED, width: 1, layer: "measure" },
    { ...base("pm-area", "Area Measurement"), type: "area", points: [at(24, 0.05, 0.1), at(24, 0.95, 0.1), at(24, 0.95, 0.9), at(24, 0.4, 0.9), at(24, 0.4, 0.55), at(24, 0.05, 0.55)], color: BLUE, fill: [0.3, 0.55, 1], width: 1, layer: "measure" },
    { ...base("pm-perimeter", "Perimeter Measurement"), type: "perimeter", points: [at(25, 0.1, 0.1), at(25, 0.9, 0.1), at(25, 0.9, 0.9), at(25, 0.1, 0.9)], color: GREEN, width: 1.2, layer: "measure" },
    { ...base("pm-count", "Count Measurement"), type: "count", points: [at(26, 0.15, 0.2), at(26, 0.5, 0.2), at(26, 0.85, 0.2), at(26, 0.3, 0.75), at(26, 0.7, 0.75)], color: GREEN, layer: "fire" },
    { ...base("pm-angle", "Angle Measurement"), type: "angle", vertex: at(27, 0.1, 0.15), a: at(27, 0.95, 0.15), b: at(27, 0.6, 0.95), color: MAGENTA, width: 1, layer: "measure" },
    { ...base("pm-radius", "Radius Measurement"), type: "radius", center: at(28, 0.5, 0.5), radius: 38, angleDeg: 30, color: BLUE, width: 1, layer: "measure" },
    { ...base("pm-diameter", "Diameter Measurement"), type: "diameter", center: at(29, 0.5, 0.5), radius: 38, angleDeg: 20, color: BLUE, width: 1, layer: "measure" },
    { ...base("pm-dynamicfill", "Dynamic Fill"), type: "dynamicFill", points: [at(30, 0, 0), at(30, 1, 0), at(30, 1, 1), at(30, 0, 1)], fill: [1, 0.6, 0.1], layer: "measure" },
    { ...base("pm-whiteout", "White-out"), type: "whiteout", rect: runQuadPadded(r.whiteout, 2), fill: [1, 1, 1] },
    {
      ...base("pm-device", "Sprinkler (pendent)"),
      type: "deviceStamp",
      center: at(32, 0.5, 0.5),
      size: 14,
      device: { kind: "Sprinkler", model: "Synthetic SP-80", kFactor: 80, temperatureC: 68, orientation: "Pendent" },
      layer: "fire",
    },
    { ...base("pm-group-root", "Group (rectangle)"), type: "rectangle", rect: boxAt(33, 0.05, 0.1, 0.95, 0.9), color: MAGENTA, width: 1.5, group: "g1" },
    { ...base("pm-group-ellipse", "Group (ellipse)"), type: "ellipse", rect: boxAt(33, 0.2, 0.2, 0.55, 0.8), color: MAGENTA, width: 1.5, group: "g1" },
    { ...base("pm-group-text", "Group (text)"), type: "textBox", rect: boxAt(33, 0.6, 0.35, 0.9, 0.65), text: "G1", fontSize: 9, textColor: MAGENTA, group: "g1" },
    { ...base("pm-layer-a", "Layer test (Measurements)"), type: "rectangle", rect: boxAt(34, 0.05, 0.3, 0.6, 0.9), color: BLUE, fill: [0.85, 0.9, 1], width: 1, layer: "measure" },
    { ...base("pm-layer-b", "Layer test (Fire protection)"), type: "ellipse", rect: boxAt(34, 0.4, 0.1, 0.95, 0.7), color: RED, fill: [1, 0.85, 0.85], width: 1, layer: "fire" },
    // Last, so the cells above keep their order: a squiggly underline in the underline's cell.
    { ...base("pm-squiggly", "Squiggly"), type: "squiggly", quads: [runQuad(r.squiggly)], color: GREEN },
    // Insert text, in the note's cell.
    { ...base("pm-caret", "Insert text"), type: "caret", at: at(12, 0.8, 0.8), text: "TYP." },
  ];
}

/** A text box whose top-left is at (fx, fy) of a cell, sized to its text. */
function textBoxAt(i: number, fx: number, fy: number, str: string, size: number): Box {
  const [x, y] = at(i, fx, fy);
  const [w, h] = textBlockSize(str, size);
  return [x, round(y - h), round(x + w), y];
}

function squareAt(i: number, fx: number, fy: number, size: number): Box {
  const [x, y] = at(i, fx, fy);
  return [x - size / 2, y - size / 2, x + size / 2, y + size / 2];
}

function runQuadPadded(run: TextRun, pad: number): Box {
  const q = runQuad(run);
  return [q[0] - pad, q[1] - pad, q[2] + pad, q[3] + pad];
}

/** The full sample set (a fresh copy on each call). */
export function sampleDocument(): ExportDocument {
  return { calibration: CALIBRATION, layers: LAYERS.map((l) => ({ ...l })), markups: markups() };
}
