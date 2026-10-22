// Story 2.4 spike harness (not in CI; its output is kept out of git).
//   npm run spike:export                    → PDFs + pdf.js renders + flatten diff + Chrome screenshots
//   npm run spike:export -- --no-chrome     → skip the Chrome screenshots
//   npm run spike:export -- --browser=chrome  use the installed Google Chrome instead of
//                                             Playwright's bundled Chromium
// Writes fixtures/private/export/{native,native-revu,appearance-only,flattened}.pdf,
// png/<file>.png (pdf.js, annotations enabled), png/flattened-vs-native-diff.png,
// chrome/<file>.png and summary.json. Synthetic content only. One browser at a time,
// closed before exit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exportPdf } from "@/core/export/export";
import { SAMPLE_DATE, sampleDocument } from "@/core/export/sample-set";

import { encodePng } from "../spike-btx/image.mjs";
import { renderPdf } from "../spike-btx/render.mjs";
import { DIFF_SCALE, FLATTEN_MAX_DIFF_PERCENT, diffPages } from "./diff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = path.join(ROOT, "fixtures/pdf/export-sample.pdf");
const OUT = path.join(ROOT, "fixtures/private/export");

/** The files the founder checks. */
export const VARIANTS = [
  { file: "native.pdf", kind: "native", revuKeys: false, what: "(a) native annotations, ISO 32000 keys only" },
  { file: "native-revu.pdf", kind: "native", revuKeys: true, what: "(a') native + Revu-observed measurement keys" },
  { file: "appearance-only.pdf", kind: "appearance-only", revuKeys: false, what: "(b) /Stamp annotations with /AP only" },
  { file: "flattened.pdf", kind: "flattened", revuKeys: false, what: "(c) appearances drawn into the page, annotations removed" },
];

const args = process.argv.slice(2);
const withChrome = !args.includes("--no-chrome");
const browserArg = args.find((a) => a.startsWith("--browser="))?.split("=")[1] ?? "chromium";

async function chromeScreenshots(files, outDir) {
  const { chromium } = await import("@playwright/test");
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: false, ...(browserArg === "chrome" ? { channel: "chrome" } : {}) });
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: false });
    const page = await context.newPage();
    const version = browser.version();
    for (const file of files) {
      const out = path.join(outDir, file.replace(/\.pdf$/, ".png"));
      const errors = [];
      page.removeAllListeners("pageerror");
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(pathToFileURL(path.join(OUT, file)).href, { waitUntil: "load", timeout: 20_000 });
      } catch (e) {
        errors.push(`goto: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
      // The PDF viewer renders asynchronously after load.
      await page.waitForTimeout(3500);
      await page.screenshot({ path: out });
      results.push({ file, screenshot: path.relative(ROOT, out), errors });
    }
    await context.close();
    return { browser: `${browserArg} ${version}`, results };
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(path.join(OUT, "png"), { recursive: true });
  const base = new Uint8Array(readFileSync(SAMPLE));
  const summary = { generated: new Date().toISOString(), files: [], diff: null, chrome: null };
  const renders = {};
  for (const v of VARIANTS) {
    const r = await exportPdf(base, sampleDocument(), { kind: v.kind, revuKeys: v.revuKeys, date: SAMPLE_DATE });
    const pdfPath = path.join(OUT, v.file);
    writeFileSync(pdfPath, r.bytes);
    const img = await renderPdf(r.bytes, { scale: DIFF_SCALE });
    const png = path.join(OUT, "png", v.file.replace(/\.pdf$/, ".png"));
    writeFileSync(png, await img.canvas.encode("png"));
    renders[v.file] = img;
    summary.files.push({ file: path.relative(ROOT, pdfPath), bytes: r.bytes.length, annotations: r.annotations, flatten: r.flatten ?? null, render: path.relative(ROOT, png), what: v.what });
    console.log(`${path.relative(ROOT, pdfPath)}  ${r.bytes.length} B, ${r.annotations} annotations${r.flatten ? `, flattened ${r.flatten.flattened} / dropped ${r.flatten.dropped} / kept ${r.flatten.kept}` : ""}`);
  }

  const d = diffPages(renders["flattened.pdf"], renders["native.pdf"]);
  const d2 = diffPages(renders["appearance-only.pdf"], renders["native.pdf"]);
  const diffPng = path.join(OUT, "png", "flattened-vs-native-diff.png");
  if (d.diffImage) writeFileSync(diffPng, await encodePng(d.diffImage));
  summary.diff = {
    scale: DIFF_SCALE,
    maxPercent: FLATTEN_MAX_DIFF_PERCENT,
    flattenedVsNative: { diffPixels: d.diffPixels, diffPercent: d.diffPercent, pass: d.pass },
    appearanceOnlyVsNative: { diffPixels: d2.diffPixels, diffPercent: d2.diffPercent, pass: d2.pass },
  };
  console.log(`flattened vs native: ${d.diffPixels} px (${d.diffPercent?.toFixed(3)} % of ink, max ${FLATTEN_MAX_DIFF_PERCENT} %) → ${d.pass ? "PASS" : "FAIL"}`);
  console.log(`appearance-only vs native: ${d2.diffPixels} px (${d2.diffPercent?.toFixed(3)} %)`);

  if (withChrome) {
    summary.chrome = await chromeScreenshots(VARIANTS.map((v) => v.file), path.join(OUT, "chrome"));
    for (const r of summary.chrome.results) console.log(`chrome: ${r.screenshot}${r.errors.length ? `  errors: ${r.errors.join("; ")}` : ""}`);
  }
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`summary: ${path.relative(ROOT, path.join(OUT, "summary.json"))}`);
}

await main();
