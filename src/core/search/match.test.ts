import { describe, expect, it } from "vitest";

import { MAX_MATCHES_PER_PAGE, boundsOf, findMatches, matchQuads, sliceQuad, snippetOf } from "./match";
import { buildPageText, normalizeQuery, type TextItem } from "./page-text";

function item(str: string, x: number, y: number, width = str.length * 6, eol = false): TextItem {
  return { str, x, y, width, fontSize: 10, quad: [x, y + 2, x + width, y + 2, x + width, y - 8, x, y - 8], eol };
}

const ANY = { matchCase: false, wholeWord: false };
const find = (items: TextItem[], query: string, options = ANY) => findMatches(buildPageText(items), normalizeQuery(query), options);

describe("findMatches", () => {
  const items = [
    item("CH +2700", 0, 100, 48),
    item("Room", 0, 120, 24),
    item("101", 30, 120, 18),
    item("ch", 0, 140, 12),
    item("+2700", 15, 140, 30),
    item("D1", 0, 160, 12),
    item("D10", 20, 160, 18),
    item("FD1", 50, 160, 18),
  ];

  it("is case-insensitive and whitespace-tolerant by default, across items", () => {
    expect(find(items, "ch +2700")).toHaveLength(2);
    expect(find(items, "ROOM  101")).toHaveLength(1);
    expect(find(items, "room\n101")).toHaveLength(1);
  });

  it("Match case and Whole word", () => {
    expect(find(items, "ch +2700", { matchCase: true, wholeWord: false })).toEqual([{ start: 18, end: 26 }]);
    expect(find(items, "D1")).toHaveLength(3); // D1, D10, FD1
    expect(find(items, "D1", { matchCase: false, wholeWord: true })).toHaveLength(1);
    // An edge that is not a word character needs no boundary: "+2700" inside "CH +2700".
    expect(find(items, "+2700", { matchCase: false, wholeWord: true })).toHaveLength(2);
  });

  it("finds nothing for an empty query, and caps a page's matches", () => {
    expect(find(items, "   ")).toEqual([]);
    const dense = buildPageText([item("a".repeat(MAX_MATCHES_PER_PAGE + 10), 0, 100)]);
    expect(findMatches(dense, normalizeQuery("a"), ANY)).toHaveLength(MAX_MATCHES_PER_PAGE);
  });

  it("matches do not overlap", () => {
    const page = buildPageText([item("aaaa", 0, 100)]);
    expect(findMatches(page, normalizeQuery("aa"), ANY)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("snippetOf", () => {
  it("gives the words around a match, with ellipses where cut", () => {
    const page = buildPageText([item("THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AND THEN SOME MORE WORDS", 0, 100)]);
    const [m] = findMatches(page, normalizeQuery("lazy"), ANY);
    const s = snippetOf(page, m, 12);
    expect(s.match).toBe("LAZY");
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.before.endsWith("THE ")).toBe(true);
    expect(s.after.startsWith(" DOG")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
    const whole = buildPageText([item("D1 here", 0, 100)]);
    expect(snippetOf(whole, { start: 0, end: 2 })).toEqual({ before: "", match: "D1", after: " here" });
  });
});

describe("matchQuads", () => {
  it("cuts each touched item's quad to the matched characters", () => {
    const items = [item("SPRINK", 0, 100, 36), item("LER", 36, 100, 18), item("VALVE", 60, 100, 30)];
    const page = buildPageText(items);
    const [m] = findMatches(page, normalizeQuery("inkler val"), ANY);
    const quads = matchQuads(items, page, m);
    expect(quads).toHaveLength(3);
    // "INK" of "SPRINK": characters 3..6 of 6 -> x 18..36.
    expect(quads[0]).toEqual([18, 102, 36, 102, 36, 92, 18, 92]);
    expect(quads[1]).toEqual([36, 102, 54, 102, 54, 92, 36, 92]);
    // "VAL" of "VALVE": 0..3 of 5 -> x 60..78.
    expect(quads[2][0]).toBeCloseTo(60);
    expect(quads[2][2]).toBeCloseTo(78);
    expect(boundsOf(quads)).toEqual({ x: 18, y: 92, width: 60, height: 10 });
    expect(boundsOf([])).toBeNull();
  });

  it("slices rotated quads along their own baseline", () => {
    // A quad running down the page.
    const q = [0, 0, 0, 100, -10, 100, -10, 0] as const;
    expect(sliceQuad(q, 0.5, 1)).toEqual([0, 50, 0, 100, -10, 100, -10, 50]);
  });
});
