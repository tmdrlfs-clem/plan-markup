// AC 4: the flattened export renders like the native export drawn with its
// appearance streams (pdf.js, annotations enabled). Skipped automatically when
// the native canvas cannot load on this machine.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { exportPdf } from "@/core/export/export";
import { SAMPLE_DATE, sampleDocument } from "@/core/export/sample-set";

let canvasOk = true;
try {
  const { createCanvas } = await import("@napi-rs/canvas");
  createCanvas(1, 1).getContext("2d");
} catch {
  canvasOk = false;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = path.join(ROOT, "fixtures/pdf/export-sample.pdf");
const base = () => new Uint8Array(readFileSync(SAMPLE));

describe.skipIf(!canvasOk)("export spike: flattened vs native render", () => {
  it("matches within the documented threshold, and the diff notices a missing markup", async () => {
    const { renderPdf } = await import("../spike-btx/render.mjs");
    const { DIFF_SCALE, diffPages } = await import("./diff.mjs");
    const native = await exportPdf(base(), sampleDocument(), { kind: "native", date: SAMPLE_DATE });
    const flat = await exportPdf(base(), sampleDocument(), { kind: "flattened", date: SAMPLE_DATE });
    const nativeImg = await renderPdf(native.bytes, { scale: DIFF_SCALE });
    const flatImg = await renderPdf(flat.bytes, { scale: DIFF_SCALE });
    const d = diffPages(flatImg, nativeImg);
    expect(d.pass).toBe(true);
    expect(d.diffPercent).toBeLessThan(0.5);

    // Sanity: dropping one markup from the flattened file must fail the diff.
    const model = sampleDocument();
    model.markups = model.markups.filter((m) => m.id !== "pm-area");
    const missing = await exportPdf(base(), model, { kind: "flattened", date: SAMPLE_DATE });
    const bad = diffPages(await renderPdf(missing.bytes, { scale: DIFF_SCALE }), nativeImg);
    expect(bad.pass).toBe(false);
  }, 60_000);

  it("draws annotations in the native and appearance-only renders (the page alone has less ink)", async () => {
    const { renderPdf } = await import("../spike-btx/render.mjs");
    const { countInk } = await import("../spike-btx/image.mjs");
    const page = countInk(await renderPdf(base(), { scale: 0.5 }));
    for (const kind of ["native", "appearance-only"]) {
      const r = await exportPdf(base(), sampleDocument(), { kind, date: SAMPLE_DATE });
      expect(countInk(await renderPdf(r.bytes, { scale: 0.5 }))).toBeGreaterThan(page * 1.1);
    }
  }, 60_000);
});

describe("export sample drawing", () => {
  it("is up to date with its generator and has no annotations", async () => {
    const out = execFileSync(process.execPath, ["--import", "./scripts/spike-btx/ts-hooks.mjs", "scripts/spike-export/make-sample.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/up to date/);
    const doc = await PDFDocument.load(base());
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([1191, 842]);
  }, 30_000);
});
