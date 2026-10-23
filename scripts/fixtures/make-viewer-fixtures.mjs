// Story 3.1 viewer fixtures (committed in fixtures/pdf/, all synthetic, no
// client content):
//   vector-a3.pdf    the Story 2.4 export sample (A3 vector plan with text), copied
//   image-only.pdf   one A4 page with a single raster image and nothing else (a "scan")
//   corrupt.pdf      a %PDF header followed by bytes that are not a PDF
//   password.pdf     one page encrypted with a user password (AES-256)
//   multi-page.pdf   4 pages of mixed sizes / orientations (Story 3.3): page 1 has a
//                    title block with the sheet number S-101 and no page label, pages
//                    2 and 3 carry page labels (FP-201, "FP-202 - SPRINKLER LAYOUT";
//                    page 3 also has /Rotate 90), page 4 is plain
//   search.pdf       3 pages with known text (Story 3.6): page 1 has "CH +2700" twice, the
//                    phrase "SPRINKLER VALVE" written as two runs split inside the word
//                    ("SPRINK" + "LER VALVE", two fonts so pdf.js keeps two items),
//                    "LEVEL" and "17" as two runs a space apart, and D1 / D10;
//                    page 2 is image-only; page 3 (/Rotate 90) has "CH +2700" once and
//                    "SPRINKLER VALVE" as one run. "ch +2700" -> 3 results on 2 pages.
// The wasm-decoder fixture (JPX + CCITT images) comes from make-wasm-images.py.
//
//   node scripts/fixtures/make-viewer-fixtures.mjs
// image-only.pdf and corrupt.pdf are deterministic; password.pdf is not (random
// encryption salts), so it is only rewritten when missing or with --force.
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from "@cantoo/pdf-lib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "fixtures", "pdf");
const DATE = new Date("2026-10-22T00:00:00Z");
const force = process.argv.includes("--force");

/** A grey "scanned sheet": paper texture, a title block box and hand-drawn-looking lines, as pixels. */
function scanPng() {
  const canvas = createCanvas(850, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, 850, 600);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(80,80,80,${0.05 + rand() * 0.1})`;
    ctx.fillRect(rand() * 850, rand() * 600, 1, 1);
  }
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, 770, 520);
  ctx.lineWidth = 2;
  for (let x = 100; x < 800; x += 70) {
    ctx.beginPath();
    ctx.moveTo(x, 60);
    ctx.lineTo(x + 3, 540);
    ctx.stroke();
  }
  ctx.fillStyle = "#222";
  ctx.fillRect(560, 470, 240, 80);
  return canvas.toBuffer("image/png");
}

async function imageOnly() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("plan-markup scripts/fixtures/make-viewer-fixtures.mjs");
  doc.setCreationDate(DATE);
  doc.setModificationDate(DATE);
  const page = doc.addPage([842, 595]); // A4 landscape
  const png = await doc.embedPng(scanPng());
  page.drawImage(png, { x: 0, y: 0, width: 842, height: 595 });
  return doc.save({ useObjectStreams: false });
}

async function multiPage() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("plan-markup scripts/fixtures/make-viewer-fixtures.mjs");
  doc.setCreationDate(DATE);
  doc.setModificationDate(DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const grid = (page, cols, rows) => {
    const { width, height } = page.getSize();
    for (let i = 1; i < cols; i++) page.drawLine({ start: { x: (width * i) / cols, y: 40 }, end: { x: (width * i) / cols, y: height - 40 }, thickness: 0.5 });
    for (let j = 1; j < rows; j++) page.drawLine({ start: { x: 40, y: (height * j) / rows }, end: { x: width - 40, y: (height * j) / rows }, thickness: 0.5 });
  };
  const notes = (page, title) => {
    const { height } = page.getSize();
    page.drawText(title, { x: 60, y: height - 70, size: 18, font: bold });
    for (let i = 0; i < 12; i++) page.drawText(`ROOM ${i + 1}  GRID ${String.fromCharCode(65 + i)}`, { x: 60, y: height - 110 - i * 14, size: 8, font });
  };
  // 1: A3 landscape with a title block (caption + sheet number bottom right), no page label.
  const p1 = doc.addPage([1191, 842]);
  grid(p1, 8, 6);
  notes(p1, "GROUND FLOOR PLAN");
  p1.drawRectangle({ x: 931, y: 30, width: 230, height: 110, borderWidth: 1.5, borderColor: rgb(0, 0, 0) });
  p1.drawText("PROJECT 205 QUEEN STREET", { x: 941, y: 120, size: 8, font });
  p1.drawText("DRAWING NO.", { x: 941, y: 80, size: 7, font });
  p1.drawText("S-101", { x: 941, y: 50, size: 22, font: bold });
  p1.drawText("REV A", { x: 1100, y: 50, size: 10, font });
  // 2: A4 portrait, page label FP-201.
  const p2 = doc.addPage([595, 842]);
  grid(p2, 4, 6);
  notes(p2, "SPRINKLER DETAILS");
  // 3: A3 portrait with /Rotate 90 (shown landscape), page label "FP-202 - SPRINKLER LAYOUT".
  const p3 = doc.addPage([842, 1191]);
  p3.setRotation(degrees(90));
  grid(p3, 6, 8);
  notes(p3, "SPRINKLER LAYOUT");
  // 4: A4 landscape, label "4" (just the page number), no title block.
  const p4 = doc.addPage([842, 595]);
  grid(p4, 6, 4);
  notes(p4, "SCHEDULE");
  doc.catalog.set(
    PDFName.of("PageLabels"),
    doc.context.obj({
      Nums: [
        0,
        { S: "D" },
        1,
        { P: PDFString.of("FP-201") },
        2,
        { P: PDFString.of("FP-202 - SPRINKLER LAYOUT") },
        3,
        { S: "D", St: 4 },
      ],
    }),
  );
  return doc.save({ useObjectStreams: false });
}

async function search() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("plan-markup scripts/fixtures/make-viewer-fixtures.mjs");
  doc.setCreationDate(DATE);
  doc.setModificationDate(DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // 1: A4 landscape with the searchable text.
  const p1 = doc.addPage([842, 595]);
  p1.drawText("LEVEL 17 CEILING PLAN", { x: 60, y: 540, size: 18, font: bold });
  p1.drawText("ROOM 101 MEETING", { x: 60, y: 480, size: 12, font });
  p1.drawText("CH +2700", { x: 300, y: 480, size: 12, font });
  p1.drawText("ROOM 102 STORE", { x: 60, y: 440, size: 12, font });
  p1.drawText("CH +2700", { x: 300, y: 440, size: 12, font });
  // A phrase split inside a word across two runs with no gap between them. The font changes,
  // so pdf.js keeps them as two text items (it merges same-font runs).
  p1.drawText("SPRINK", { x: 60, y: 380, size: 12, font });
  p1.drawText("LER VALVE", { x: 60 + font.widthOfTextAtSize("SPRINK", 12), y: 380, size: 12, font: bold });
  // Two runs one space apart (two items, no space character between them).
  p1.drawText("LEVEL", { x: 60, y: 340, size: 12, font: bold });
  p1.drawText("17", { x: 60 + bold.widthOfTextAtSize("LEVEL ", 12), y: 340, size: 12, font });
  p1.drawText("DOOR D1", { x: 60, y: 300, size: 12, font });
  p1.drawText("DOOR D10", { x: 200, y: 300, size: 12, font });
  // 2: a scan (image only).
  const p2 = doc.addPage([842, 595]);
  p2.drawImage(await doc.embedPng(scanPng()), { x: 0, y: 0, width: 842, height: 595 });
  // 3: A4 portrait shown landscape (/Rotate 90).
  const p3 = doc.addPage([595, 842]);
  p3.setRotation(degrees(90));
  p3.drawText("RISER ROOM", { x: 60, y: 760, size: 14, font: bold });
  p3.drawText("CH +2700", { x: 60, y: 720, size: 12, font });
  p3.drawText("SPRINKLER VALVE", { x: 60, y: 680, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

function corrupt() {
  // Looks like a PDF to a file picker, but nothing after the header parses.
  const lines = ["%PDF-1.7", "%âãÏÓ"];
  for (let i = 0; i < 64; i++) lines.push(`garbage ${i} ${"x".repeat(i % 17)} <<< not an object >>>`);
  lines.push("%%EOF", "");
  return Buffer.from(lines.join("\n"), "latin1");
}

async function password() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setCreationDate(DATE);
  doc.setModificationDate(DATE);
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Locked drawing (Plan Markup test fixture)", { x: 72, y: 760, size: 14, font });
  doc.encrypt({ userPassword: "plan-markup-test", ownerPassword: "plan-markup-owner" });
  return doc.save({ useObjectStreams: false });
}

copyFileSync(path.join(OUT, "export-sample.pdf"), path.join(OUT, "vector-a3.pdf"));
writeFileSync(path.join(OUT, "image-only.pdf"), await imageOnly());
writeFileSync(path.join(OUT, "corrupt.pdf"), corrupt());
writeFileSync(path.join(OUT, "multi-page.pdf"), await multiPage());
writeFileSync(path.join(OUT, "search.pdf"), await search());
const pw = path.join(OUT, "password.pdf");
const writePassword = force || !existsSync(pw);
if (writePassword) writeFileSync(pw, await password());
console.log(`fixtures/pdf: vector-a3, image-only, corrupt, multi-page, search${writePassword ? ", password" : ""}`);
