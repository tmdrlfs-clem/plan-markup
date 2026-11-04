import { describe, expect, it } from "vitest";

import { buildPageText, type TextItem } from "@/core/search/page-text";

import { charNear, decorationLines, selectionQuads, selectionText, wordSelection, type PageText } from "./text-select";

/** An item on baseline y (user space, y up), 6 units a character, 10 tall (2 below the baseline). */
function item(str: string, x: number, y: number, eol = false): TextItem {
  const w = str.length * 6;
  return { str, x, y, width: w, fontSize: 10, quad: [x, y - 2, x + w, y - 2, x + w, y + 8, x, y + 8], eol };
}

function page(items: TextItem[]): PageText {
  return { items, index: buildPageText(items) };
}

// "ROOM 101 MEETING" on one line, "CH +2700" on the next.
const text = page([item("ROOM 101 MEETING", 0, 100, true), item("CH +2700", 0, 80)]);

describe("charNear (Story 5.9)", () => {
  it("finds the character under the point, or the nearest within the tolerance", () => {
    expect(text.index.text).toBe("ROOM 101 MEETING CH +2700");
    // x 33: the 6th character ("1" of 101, offset 5).
    expect(charNear(text, { x: 33, y: 103 }, 0)).toBe(5);
    expect(charNear(text, { x: 33, y: 112 }, 1)).toBeNull();
    expect(charNear(text, { x: 33, y: 112 }, 5)).toBe(5);
    // The second item: "C" is code unit 17.
    expect(charNear(text, { x: 1, y: 82 }, 0)).toBe(17);
    expect(charNear(page([]), { x: 0, y: 0 }, 100)).toBeNull();
  });
});

describe("wordSelection", () => {
  it("extends to whole words, in reading order, either direction, across lines", () => {
    expect(selectionText(text.index, wordSelection(text.index, 1, 6))).toBe("ROOM 101");
    expect(selectionText(text.index, wordSelection(text.index, 6, 1))).toBe("ROOM 101");
    expect(selectionText(text.index, wordSelection(text.index, 12, 18))).toBe("MEETING CH");
    // Only a space: nothing; from a word to a space: that word.
    expect(selectionText(text.index, wordSelection(text.index, 4, 4))).toBe("");
    expect(selectionText(text.index, wordSelection(text.index, 3, 4))).toBe("ROOM");
  });
});

describe("selectionQuads and decorationLines", () => {
  it("slices each item's quad to the selected characters; the lines run along them", () => {
    const quads = selectionQuads(text, wordSelection(text.index, 12, 18));
    // "MEETING" (offsets 9–16 of the first item) and "CH" (0–2 of the second).
    expect(quads).toHaveLength(8);
    expect(quads[0]).toEqual({ x: 54, y: 98 });
    expect(quads[1]).toEqual({ x: 96, y: 98 });
    expect(quads[5]).toEqual({ x: 12, y: 78 });
    const under = decorationLines(quads, "underline");
    expect(under).toHaveLength(2);
    expect(under[0][0].y).toBeCloseTo(98 + 10 * 0.12);
    expect(decorationLines(quads, "strikethrough")[0][0].y).toBeCloseTo(98 + 10 * 0.45);
  });
});
