import { describe, expect, it } from "vitest";

import { NEARBY_MAX_LENGTH, nearbyText, sortByPosition } from "./context";
import { boundsOf, findMatches, matchQuads } from "./match";
import { buildPageText, normalizeQuery, type TextItem } from "./page-text";

/** An item with its baseline at y, 10 pt text: box from y - 8 to y + 2. */
function item(str: string, x: number, y: number, width = str.length * 6): TextItem {
  return { str, x, y, width, fontSize: 10, quad: [x, y + 2, x + width, y + 2, x + width, y - 8, x, y - 8], eol: false };
}

const placed = (id: string, x: number, y: number, h = 10) => ({ id, bounds: { x, y, width: 40, height: h }, textHeight: h });

describe("sortByPosition", () => {
  it("orders hits top to bottom, and left to right within a line", () => {
    const hits = [placed("c", 300, 100), placed("d", 10, 400), placed("a", 10, 102), placed("b", 150, 97), placed("e", 200, 400)];
    expect(sortByPosition(hits).map((h) => h.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps lines apart that are more than half a text height apart, and is stable for equal positions", () => {
    const hits = [placed("low", 0, 108), placed("high", 100, 100), placed("same1", 50, 200), placed("same2", 50, 200)];
    expect(sortByPosition(hits).map((h) => h.id)).toEqual(["high", "low", "same1", "same2"]);
    expect(sortByPosition([])).toEqual([]);
  });
});

describe("nearbyText", () => {
  // Two "CH +2700" labels, each above its own ceiling-type tag, far apart on the sheet.
  const items = [
    item("CH +2700", 100, 100, 48),
    item("CT.02", 105, 115, 30),
    item("D1", 60, 100, 12),
    item(" ", 160, 100, 6),
    item("CH +2700", 600, 500, 48),
    item("CT.03", 605, 515, 30),
    item("CH +2700", 600, 470, 48),
    item("A VERY LONG ROOM NAME FOR A LABEL", 560, 530, 200),
  ];
  const page = buildPageText(items);
  const hits = findMatches(page, normalizeQuery("ch +2700"), { matchCase: false, wholeWord: false }).map((m) => {
    const quads = matchQuads(items, page, m);
    return { m, bounds: boundsOf(quads)!, height: 10 };
  });

  it("names the nearest other text, nearest first; not blanks, not the hit's own items", () => {
    expect(nearbyText(items, page, hits[0].m, hits[0].bounds, hits[0].height)).toEqual(["CT.02", "D1"]);
  });

  it("skips other copies of the matched text and cuts long labels", () => {
    const near = nearbyText(items, page, hits[1].m, hits[1].bounds, hits[1].height);
    expect(near[0]).toBe("CT.03");
    expect(near[1]).toHaveLength(NEARBY_MAX_LENGTH);
    expect(near[1].endsWith("…")).toBe(true);
    expect(near).not.toContain("CH +2700");
  });

  it("finds nothing beyond the radius, and lists a repeated label once", () => {
    const lonely = [item("CH +2700", 0, 0, 48), item("FAR", 1000, 1000, 18)];
    const p = buildPageText(lonely);
    const [m] = findMatches(p, normalizeQuery("ch"), { matchCase: false, wholeWord: false });
    expect(nearbyText(lonely, p, m, boundsOf(matchQuads(lonely, p, m))!, 10)).toEqual([]);

    const twice = [item("EQ", 0, 100, 12), item("EQ", 20, 100, 12), item("X", 40, 100, 6), item("EQ", 60, 100, 12)];
    const q = buildPageText(twice);
    const [x] = findMatches(q, normalizeQuery("x"), { matchCase: false, wholeWord: false });
    expect(nearbyText(twice, q, x, boundsOf(matchQuads(twice, q, x))!, 10, 3)).toEqual(["EQ"]);
  });
});
