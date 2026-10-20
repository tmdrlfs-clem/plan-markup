// Renders the synthetic items with pdf.js + @napi-rs/canvas and runs the
// reference intake against a placement PDF we generate ourselves. Skipped
// automatically when the native canvas cannot load on this machine.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBtx } from "@/core/btx/parse";
import { buildItemPdf, buildPdf, itemBounds } from "@/core/btx/to-pdf";

let canvasOk = true;
try {
  const { createCanvas } = await import("@napi-rs/canvas");
  createCanvas(1, 1).getContext("2d");
} catch {
  canvasOk = false;
}

const SYNTHETIC = new URL("../../fixtures/btx/synthetic.btx", import.meta.url);

describe.skipIf(!canvasOk)("spike harness on the synthetic set", () => {
  it("renders every synthetic item to non-empty pixels", async () => {
    const { renderPdf } = await import("./render.mjs");
    const { countInk } = await import("./image.mjs");
    const set = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    for (const item of set.items) {
      const img = await renderPdf((await buildItemPdf(item)).bytes);
      expect(countInk(img), item.name).toBeGreaterThan(100);
    }
  }, 30_000);

  it("reads a placement PDF back as one unit per item (group = one unit) and diffs at 0 %", async () => {
    const { renderPdf } = await import("./render.mjs");
    const { compare } = await import("./image.mjs");
    const { matchUnits, readReferenceUnits, renderReferenceUnit } = await import("./reference.mjs");
    const set = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    const placements = [];
    let x = 0;
    for (const item of set.items) {
      const b = itemBounds(item);
      placements.push({ item, dx: x - b[0], dy: -b[1] });
      x += b[2] - b[0] + 20;
    }
    const reference = (await buildPdf(placements, { linkGroups: true, margin: 20 })).bytes;
    const units = await readReferenceUnits(reference);
    expect(units.map((u) => u.members)).toEqual([1, 1, 2, 1, 1]);
    expect(units[1].subject).toBe("Synthetic sounder");
    const { pairs, note } = matchUnits(
      set.items.map((i) => ({ subject: i.annotations[0].subject, subtype: i.annotations[0].subtype })),
      units,
    );
    expect(note).toBeNull();
    for (let i = 0; i < set.items.length; i++) {
      const cand = await renderPdf((await buildItemPdf(set.items[i])).bytes);
      const ref = await renderReferenceUnit(reference, units[pairs[i]]);
      const r = compare(cand, ref);
      expect(r.pass, set.items[i].name).toBe(true);
      expect(r.diffPercent).toBeLessThan(0.5);
    }
  }, 60_000);

  it("matches by subject + type when the counts differ", async () => {
    const { matchUnits } = await import("./reference.mjs");
    const items = [
      { subject: "A", subtype: "Stamp" },
      { subject: "B", subtype: "Circle" },
    ];
    const units = [{ subject: "B", subtype: "Circle" }];
    const { pairs, note } = matchUnits(items, units);
    expect(pairs).toEqual([null, 0]);
    expect(note).toMatch(/count mismatch: 1 placed unit\(s\) vs 2 item\(s\)/);
  });

  it("compare fails a visibly different render", async () => {
    const { compare } = await import("./image.mjs");
    const img = (fill) => {
      const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
      for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) {
        const i = (y * 20 + x) * 4;
        data.set(fill(x, y), i);
      }
      return { width: 20, height: 20, data };
    };
    const solid = img(() => [0, 0, 0, 255]);
    const checker = img((x, y) => ((x + y) % 2 ? [0, 0, 0, 255] : [255, 0, 0, 255]));
    expect(compare(solid, solid).pass).toBe(true);
    expect(compare(checker, solid).pass).toBe(false);
  });
});
