// Story 3.1 viewer fixtures (committed in fixtures/pdf/, all synthetic, no
// client content):
//   vector-a3.pdf    the Story 2.4 export sample (A3 vector plan with text), copied
//   image-only.pdf   one A4 page with a single raster image and nothing else (a "scan")
//   corrupt.pdf      a %PDF header followed by bytes that are not a PDF
//   password.pdf     one page encrypted with a user password (AES-256)
// The wasm-decoder fixture (JPX + CCITT images) comes from make-wasm-images.py.
//
//   node scripts/fixtures/make-viewer-fixtures.mjs
// image-only.pdf and corrupt.pdf are deterministic; password.pdf is not (random
// encryption salts), so it is only rewritten when missing or with --force.
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

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
const pw = path.join(OUT, "password.pdf");
const writePassword = force || !existsSync(pw);
if (writePassword) writeFileSync(pw, await password());
console.log(`fixtures/pdf: vector-a3, image-only, corrupt${writePassword ? ", password" : ""}`);
