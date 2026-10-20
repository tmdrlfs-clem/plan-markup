// Story 2.1 spike harness (not part of CI: it needs the founder's private files).
//   npm run spike:btx               → the three private sets, writes docs/spikes/2-1-btx-report.md
//   npm run spike:btx -- --self-test → synthetic set against a reference PDF we generate
//                                      ourselves (exercises the reference intake end to end)
// Renders every item to fixtures/private/btx/out/<set>/<nnn>-<slug>.png plus a
// contact sheet, diffs against Revu references when present, writes the report.
// Exit 0 even when items fail (it is a measurement); non-zero only on crashes.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasAppearance } from "@/core/btx/appearance";
import { parseBtx } from "@/core/btx/parse";
import { buildItemPdf, buildPdf, itemBounds } from "@/core/btx/to-pdf";

import { PASS_DIFF_PERCENT, PIXELMATCH_THRESHOLD, compare, contactSheet, countInk, decodePng, encodePng } from "./image.mjs";
import { matchUnits, readReferenceUnits, renderReferenceUnit } from "./reference.mjs";
import { SCALE, renderPdf } from "./render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRIVATE = path.join(ROOT, "fixtures/private/btx");
const OUT = path.join(PRIVATE, "out");
const REPORT = path.join(ROOT, "docs/spikes/2-1-btx-report.md");
const PRIVATE_SETS = ["sprinkler-tools", "fire-alarm-tools", "my-tools"];
const BEGIN = "<!-- harness:begin -->";
const END = "<!-- harness:end -->";

const pad3 = (n) => String(n).padStart(3, "0");
const slug = (s) => (s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
const cellText = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const pct = (n) => (n === null || n === undefined ? "–" : `${n.toFixed(2)} %`);

function summarizeItem(item) {
  const root = item.annotations[0];
  const subtypes = [...new Set(item.annotations.map((a) => a.subtype ?? "?"))].join("+");
  const apStates = item.annotations.map((a) => hasAppearance(a.dict));
  const ap = apStates.every(Boolean) ? "yes" : apStates.some(Boolean) ? "partial" : "no (generated)";
  return {
    subject: root.subject ?? item.name,
    subtype: root.subtype,
    subtypes,
    members: item.annotations.length,
    ap,
    missingRefs: item.missingRefs.length,
  };
}

async function renderSet(setName, toolSet, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  const cells = [];
  for (let i = 0; i < toolSet.items.length; i++) {
    const item = toolSet.items[i];
    const row = { set: setName, index: i, ...summarizeItem(item), issues: [], image: null };
    try {
      const built = await buildItemPdf(item);
      for (const w of built.warnings) if (/no generator/.test(w)) row.issues.push("no appearance generator");
      const img = await renderPdf(built.bytes);
      row.image = img;
      row.ink = countInk(img);
      if (row.ink === 0) row.issues.push("render is blank");
      writeFileSync(path.join(outDir, `${pad3(i)}-${slug(row.subject)}.png`), await img.canvas.encode("png"));
    } catch (e) {
      row.issues.push(`render error (${e instanceof Error ? e.name : typeof e})`);
    }
    if (row.missingRefs > 0) row.issues.push(`${row.missingRefs} referenced resource(s) missing in .btx`);
    rows.push(row);
    cells.push({ label: `${pad3(i)} ${row.subject}`, image: row.image });
  }
  writeFileSync(path.join(OUT, `${setName}-sheet.png`), await contactSheet(cells));
  return rows;
}

/** Reference images per item index (PNG override wins), or null when none exist. */
async function loadReferences(setName, rows, refPdfPath, refPngDir) {
  const hasPdf = existsSync(refPdfPath);
  const hasPngs = existsSync(refPngDir);
  if (!hasPdf && !hasPngs) return null;
  const refs = new Map();
  let note = null;
  if (hasPdf) {
    const pdfBytes = readFileSync(refPdfPath);
    const units = await readReferenceUnits(pdfBytes);
    const match = matchUnits(rows, units);
    note = match.note;
    for (let i = 0; i < rows.length; i++) {
      const k = match.pairs[i];
      if (k === null || k === undefined) continue;
      if (units[k].members !== rows[i].members) {
        rows[i].issues.push(`reference unit has ${units[k].members} member(s), item has ${rows[i].members}`);
      }
      refs.set(i, { image: await renderReferenceUnit(pdfBytes, units[k]), source: "pdf" });
    }
  }
  if (hasPngs) {
    for (let i = 0; i < rows.length; i++) {
      const p = path.join(refPngDir, `${pad3(i)}.png`);
      if (existsSync(p)) refs.set(i, { image: await decodePng(readFileSync(p)), source: "png" });
    }
  }
  return { refs, note };
}

async function diffSet(setName, rows, references, outDir) {
  const diffDir = path.join(outDir, "diff");
  mkdirSync(diffDir, { recursive: true });
  for (const row of rows) {
    const ref = references.refs.get(row.index);
    if (!ref) {
      row.pass = false;
      row.reason = "no reference matched";
      continue;
    }
    if (!row.image) {
      row.pass = false;
      row.reason = row.issues.join("; ") || "not rendered";
      continue;
    }
    const r = compare(row.image, ref.image);
    row.diffPercent = r.diffPercent;
    row.pass = r.pass;
    row.reason = r.reason ?? "";
    writeFileSync(path.join(diffDir, `${pad3(row.index)}-ref.png`), await encodePng(ref.image));
    if (r.diffImage) writeFileSync(path.join(diffDir, `${pad3(row.index)}-diff.png`), await encodePng(r.diffImage));
    console.log(`  ${setName} ${pad3(row.index)} ${row.pass ? "pass" : "FAIL"} ${pct(row.diffPercent)} ${row.reason}`);
  }
}

function harnessSection(results, generatedAt) {
  const L = [];
  L.push(`_Generated by \`npm run spike:btx\` on ${generatedAt}. Render: pdf.js 6.4.299 (legacy build, Node), @napi-rs/canvas, ${SCALE} px/pt, annotations enabled, \`isEvalSupported: false\`. Diff: pixelmatch threshold ${PIXELMATCH_THRESHOLD}, anti-aliasing ignored, both images trimmed to their non-white box and the render scaled to the reference; pass = diff ≤ ${PASS_DIFF_PERCENT} % of the reference's non-white pixels._`);
  L.push("");
  L.push("### Summary");
  L.push("");
  L.push("| Set | Items | Members | /AP in .btx | Generated AP | Missing refs | Blank renders | References | Pass rate |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  let allItems = 0;
  let allPass = 0;
  let allMeasured = 0;
  for (const r of results) {
    if (r.error) {
      L.push(`| ${r.set} | – | – | – | – | – | – | – | parse failed: ${cellText(r.error)} |`);
      continue;
    }
    const rows = r.rows;
    const members = rows.reduce((n, x) => n + x.members, 0);
    const withAp = rows.filter((x) => x.ap === "yes").length;
    const generated = rows.filter((x) => x.ap !== "yes").length;
    const missing = rows.filter((x) => x.missingRefs > 0).length;
    const blank = rows.filter((x) => x.issues.includes("render is blank")).length;
    allItems += rows.length;
    let rate = "references missing";
    if (r.references) {
      const passed = rows.filter((x) => x.pass).length;
      allPass += passed;
      allMeasured += rows.length;
      rate = `${passed}/${rows.length} = ${((passed / rows.length) * 100).toFixed(1)} %`;
    }
    L.push(`| ${r.set} | ${rows.length} | ${members} | ${withAp} | ${generated} | ${missing} | ${blank} | ${r.references ? "yes" : "missing"} | ${rate} |`);
  }
  L.push("");
  if (allMeasured === 0) {
    L.push(`**Overall: references missing** (${allItems} items rendered; no pass rate until the Revu reference PDFs exist, see "Reference capture").`);
  } else {
    const rate = (allPass / allMeasured) * 100;
    L.push(`**Overall: ${allPass}/${allMeasured} = ${rate.toFixed(1)} %** against the ≥ 95 % target (NFR10): **${rate >= 95 ? "met" : "not met"}**.`);
  }
  for (const r of results) if (r.references?.note) L.push(`\n- ${r.set}: ${r.references.note}`);
  L.push("");
  L.push("### Per item");
  L.push("");
  L.push("| Set | # | Subject | Type | Members | Has AP | Result | Diff | Reason / observations |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    for (const x of r.rows ?? []) {
      const result = r.references ? (x.pass ? "pass" : "fail") : "–";
      const reason = [x.reason, ...x.issues].filter(Boolean).join("; ");
      L.push(`| ${r.set} | ${x.index} | ${cellText(x.subject)} | ${x.subtypes} | ${x.members} | ${x.ap} | ${result} | ${pct(x.diffPercent)} | ${cellText(reason)} |`);
    }
  }
  L.push("");
  L.push("### Failing / flagged items");
  L.push("");
  const flagged = results.flatMap((r) => (r.rows ?? []).filter((x) => (r.references && !x.pass) || x.issues.length > 0).map((x) => ({ ...x, measured: Boolean(r.references) })));
  if (flagged.length === 0) L.push("None.");
  for (const x of flagged) {
    const why = [x.measured && !x.pass ? `fail ${pct(x.diffPercent)} ${x.reason ?? ""}`.trim() : null, ...x.issues].filter(Boolean).join("; ");
    L.push(`- ${x.set} #${x.index} (${cellText(x.subject)}, ${x.subtypes}): ${cellText(why)}`);
  }
  return L.join("\n");
}

function writeReport(file, section) {
  let doc = existsSync(file) ? readFileSync(file, "utf8") : `# Spike 2.1 — .btx parse and render\n\n## Results\n\n${BEGIN}\n${END}\n`;
  if (!doc.includes(BEGIN) || !doc.includes(END)) doc += `\n## Results\n\n${BEGIN}\n${END}\n`;
  const start = doc.indexOf(BEGIN) + BEGIN.length;
  const end = doc.indexOf(END);
  doc = `${doc.slice(0, start)}\n${section}\n${doc.slice(end)}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, doc);
}

/** Lays the synthetic items out in a row and saves the page as a Revu-style placement PDF. */
async function makeSelfReference(toolSet, file) {
  const placements = [];
  let x = 0;
  for (const item of toolSet.items) {
    const b = itemBounds(item);
    placements.push({ item, dx: x - b[0], dy: -b[1] });
    x += b[2] - b[0] + 20;
  }
  const built = await buildPdf(placements, { linkGroups: true, margin: 20 });
  writeFileSync(file, built.bytes);
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  mkdirSync(OUT, { recursive: true });
  const sets = selfTest
    ? [{ name: "synthetic", file: path.join(ROOT, "fixtures/btx/synthetic.btx") }]
    : PRIVATE_SETS.map((name) => ({ name, file: path.join(PRIVATE, `${name}.btx`) }));
  const results = [];
  for (const set of sets) {
    console.log(`${set.name}:`);
    if (!existsSync(set.file)) {
      results.push({ set: set.name, error: "file not found" });
      continue;
    }
    let toolSet;
    try {
      toolSet = await parseBtx(new Uint8Array(readFileSync(set.file)));
    } catch (e) {
      results.push({ set: set.name, error: e instanceof Error ? `${e.name} ${e.code ?? ""}`.trim() : typeof e });
      continue;
    }
    const outDir = path.join(OUT, set.name);
    const rows = await renderSet(set.name, toolSet, outDir);
    console.log(`  rendered ${rows.length} items → ${path.relative(ROOT, outDir)}`);
    let refPdf = path.join(PRIVATE, "reference", `${set.name}.pdf`);
    const refPngDir = path.join(PRIVATE, "reference", set.name);
    if (selfTest) {
      refPdf = path.join(OUT, "synthetic-reference.pdf");
      await makeSelfReference(toolSet, refPdf);
    }
    const references = await loadReferences(set.name, rows, refPdf, refPngDir);
    if (references) await diffSet(set.name, rows, references, outDir);
    else console.log("  references missing");
    results.push({ set: set.name, rows, references });
  }
  const section = harnessSection(results, new Date().toISOString().slice(0, 10));
  const reportFile = selfTest ? path.join(OUT, "synthetic-self-test-report.md") : REPORT;
  writeReport(reportFile, section);
  console.log(`Report: ${path.relative(ROOT, reportFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
