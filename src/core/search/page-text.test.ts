import { describe, expect, it } from "vitest";

import { DEFAULT_ASCENT, DEFAULT_DESCENT, buildPageText, foldChar, joinsWithoutGap, normalizeQuery, textItemOf, type TextItem } from "./page-text";

/** A horizontal item at (x, y) baseline, `width` advance, size 10, as page space (y down). */
function item(str: string, x: number, y: number, width = str.length * 6, eol = false): TextItem {
  return { str, x, y, width, fontSize: 10, quad: [x, y + 2, x + width, y + 2, x + width, y - 8, x, y - 8], eol };
}

const identityFlip = (x: number, y: number) => [x, 1000 - y];

describe("textItemOf", () => {
  it("boxes a horizontal item from the descent to the ascent, in page space (y down)", () => {
    const it = textItemOf({ str: "CH", transform: [10, 0, 0, 10, 100, 900], width: 14, hasEOL: true }, { ascent: 0.75, descent: -0.25 }, identityFlip);
    expect(it).toMatchObject({ str: "CH", x: 100, y: 100, width: 14, fontSize: 10, eol: true });
    // bl, br, tr, tl: descent 2.5 below the baseline (y + 2.5 in page space), ascent 7.5 above.
    expect(it.quad).toEqual([100, 102.5, 114, 102.5, 114, 92.5, 100, 92.5]);
  });

  it("follows rotated text and uses default metrics when the font gives none", () => {
    // Text running up the page (90° in PDF user space).
    const up = textItemOf({ str: "A", transform: [0, 10, -10, 0, 50, 50], width: 20 }, {}, (x, y) => [x, y]);
    const [blx, bly, brx, bry, trx, try_, tlx, tly] = up.quad;
    expect(blx).toBeCloseTo(50 - DEFAULT_DESCENT * 10); // the descent is to the right of a text running up
    expect(bly).toBeCloseTo(50);
    expect(brx).toBeCloseTo(52);
    expect(bry).toBeCloseTo(70);
    expect(trx).toBeCloseTo(50 - DEFAULT_ASCENT * 10);
    expect(try_).toBeCloseTo(70);
    expect(tlx).toBeCloseTo(42);
    expect(tly).toBeCloseTo(50);
    expect(up.fontSize).toBeCloseTo(10);
  });
});

describe("buildPageText", () => {
  it("joins items on a line with spaces where there is a gap, and none inside a split word", () => {
    const items = [item("SPRINK", 0, 100, 36), item("LER", 36, 100, 18), item("VALVE", 60, 100, 30), item("LEVEL", 0, 130, 30), item("17", 34, 130, 12)];
    const page = buildPageText(items);
    expect(page.text).toBe("SPRINKLER VALVE LEVEL 17");
    expect(page.folded).toBe("sprinkler valve level 17");
    expect(page.charItem.length).toBe(page.text.length);
    // "LER" comes from item 1, offsets 0..2; the inserted space maps to no item.
    expect([...page.charItem.slice(6, 10)]).toEqual([1, 1, 1, -1]);
    expect([...page.charOffset.slice(6, 9)]).toEqual([0, 1, 2]);
  });

  it("collapses whitespace runs and line ends to one space, NFKC-normalises ligatures and trims", () => {
    const items = [item("  ROOM   1", 0, 100), item(" ", 80, 100, 3), item("eﬀect", 0, 120, 30, true), item("next", 0, 140)];
    const page = buildPageText(items);
    expect(page.text).toBe("ROOM 1 effect next");
    // The ligature's two letters both map to its one source character.
    const f = page.text.indexOf("ff");
    expect([page.charItem[f], page.charOffset[f], page.charItem[f + 1], page.charOffset[f + 1]]).toEqual([2, 1, 2, 1]);
  });

  it("an item ending a line (eol) is never joined to the next one", () => {
    const a = item("FD", 0, 100, 12, true);
    const b = item("1", 12, 100, 6);
    expect(joinsWithoutGap(a, b)).toBe(false);
    expect(joinsWithoutGap({ ...a, eol: false }, b)).toBe(true);
    // Another line, or a step backwards: separate.
    expect(joinsWithoutGap({ ...a, eol: false }, item("1", 12, 115, 6))).toBe(false);
    expect(joinsWithoutGap({ ...a, eol: false }, item("1", 0, 100, 6))).toBe(false);
  });

  it("keeps astral characters whole and folds case without changing the length", () => {
    const page = buildPageText([item("𝐀b İ", 0, 100)]);
    expect(page.folded.length).toBe(page.text.length);
    expect(page.charItem.length).toBe(page.text.length);
    expect(foldChar("İ")).toBe("İ"); // its lower case is two code units
    expect(foldChar("Q")).toBe("q");
  });

  it("an empty page has empty text", () => {
    expect(buildPageText([])).toMatchObject({ text: "", folded: "" });
  });
});

describe("normalizeQuery", () => {
  it("collapses and trims whitespace, applies NFKC, and folds case", () => {
    expect(normalizeQuery("  CH   +2700 \n")).toEqual({ text: "CH +2700", folded: "ch +2700" });
    expect(normalizeQuery("ﬁre")).toEqual({ text: "fire", folded: "fire" });
    expect(normalizeQuery("   ")).toEqual({ text: "", folded: "" });
  });
});
