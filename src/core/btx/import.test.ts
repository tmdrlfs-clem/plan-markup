import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  REASON_BLANK,
  REASON_FAILED,
  REASON_TOO_LARGE,
  REASON_UNREADABLE,
  importItems,
  itemName,
  renderSize,
  type ItemRenderer,
} from "./import";
import { parseBtx } from "./parse";

const SYNTHETIC = new URL("../../../fixtures/btx/synthetic.btx", import.meta.url);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const synthetic = async () => parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));

describe(".btx import (Story 7.4)", () => {
  it("draws every item of the synthetic set at its paper size, named by its subject", async () => {
    const set = await synthetic();
    const render = vi.fn<ItemRenderer>(async () => PNG);
    const out = await importItems(set, render, 1024);
    expect(out.title).toBe("Synthetic Tools");
    expect(out.items.map((i) => i.ok)).toEqual([true, true, true, true, true]);
    // Story 7.5: only the stamp is drawn; the other four convert to markups.
    expect(out.items.map((i) => (i.ok ? i.kind : null))).toEqual(["image", "markups", "markups", "markups", "markups"]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(out.items.map((i) => i.name)).toEqual(set.items.map((item, n) => itemName(item, n)));
    for (const item of out.items) if (item.ok && item.kind === "image") expect(item.widthPt).toBeGreaterThan(0);
    // Each item is a one-page PDF, drawn at 4 px a point.
    const [pdf, size] = render.mock.calls[0]!;
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(size.scale).toBe(4);
  });

  it("reports an item that draws nothing, fails to draw or is too large; the others still import", async () => {
    const synth = await synthetic();
    // Five copies of the stamp (the only item drawn as an image).
    const set = { ...synth, items: Array.from({ length: 5 }, () => synth.items[0]!) };
    let n = 0;
    const render: ItemRenderer = async () => {
      n++;
      if (n === 1) return null;
      if (n === 2) throw new Error("pdf.js failed");
      if (n === 3) return new Uint8Array(2048);
      return PNG;
    };
    const out = await importItems(set, render, 1024);
    expect(out.items.map((i) => (i.ok ? "ok" : i.reason))).toEqual([REASON_BLANK, REASON_FAILED, REASON_TOO_LARGE, "ok", "ok"]);
  });

  it("an item the parser skipped is reported as unreadable", async () => {
    const set = await synthetic();
    const out = await importItems({ ...set, warnings: ["Item 3: missing <Type> (item skipped)", "Unknown element <X> ignored"] }, async () => PNG, 1024);
    expect(out.items.at(-1)).toEqual({ name: "Item 3", ok: false, reason: REASON_UNREADABLE });
    expect(out.warnings).toEqual(["Unknown element <X> ignored"]);
  });

  it("renders at 4 px a point, at most 2048 px on the long side", () => {
    expect(renderSize([0, 0, 20, 10])).toEqual({ widthPx: 80, heightPx: 40, scale: 4 });
    const big = renderSize([0, 0, 1024, 512]);
    expect(big.widthPx).toBe(2048);
    expect(big.heightPx).toBe(1024);
    expect(renderSize([0, 0, 0.1, 0.1]).widthPx).toBe(1);
  });
});
