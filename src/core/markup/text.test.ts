import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, isMeasureMarkup, isTextMarkup, markupSchema, MAX_TEXT_LENGTH, type Markup } from "@/core/schema/markup";

import { hitMarkup } from "./geometry";
import { MarkupIndex } from "./markup-index";
import { boxFrom, growBox, leaderOf, orientBox, screenAxes, textBoxOf, wrapText } from "./text";

const ID = "00000000-0000-7000-8000-000000000001";
// Screen: y down; the page unrotated (y up) and rotated 90° clockwise on screen.
const upright = (p: { x: number; y: number }) => ({ x: p.x, y: -p.y });
const turned = (p: { x: number; y: number }) => ({ x: p.y, y: p.x });
// A box (0, 0)-(100, 50) ordered from the screen's top left on an upright page.
const BOX = [
  { x: 0, y: 50 },
  { x: 100, y: 50 },
  { x: 100, y: 0 },
  { x: 0, y: 0 },
];

function make(type: Markup["type"], points: { x: number; y: number }[], text = "Hello"): Markup {
  return markupSchema.parse({ id: ID, pageId: "doc:0", createdAt: "2026-11-04T00:00:00.000Z", style: DEFAULT_MARKUP_STYLE, type, points, text });
}

describe("text markup schemas (Story 5.6)", () => {
  it("takes a text box and a typewriter as four corners, a note as a point, a callout as five, a Cloud+ as 3+ and 4", () => {
    for (const type of ["text", "typewriter"] as const) expect(make(type, BOX).type).toBe(type);
    expect(make("note", [{ x: 0, y: 0 }]).type).toBe("note");
    expect(make("callout", [...BOX, { x: 200, y: 0 }]).type).toBe("callout");
    expect(make("cloudplus", [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, ...BOX]).type).toBe("cloudplus");
    expect(() => make("cloudplus", [{ x: 200, y: 0 }, { x: 300, y: 0 }, ...BOX])).toThrow();
  });

  it("keeps text as plain text up to the limit", () => {
    const m = make("text", BOX, "<b>not bold</b>");
    expect(isTextMarkup(m) && m.text).toBe("<b>not bold</b>");
    expect(isMeasureMarkup(m)).toBe(false);
    expect(() => make("text", BOX, "x".repeat(MAX_TEXT_LENGTH + 1))).toThrow();
  });
});

describe("orientation", () => {
  it("orders a box from the screen's top left clockwise, upright or turned", () => {
    expect(orientBox({ x: 0, y: 0 }, { x: 100, y: 50 }, upright)).toEqual(BOX);
    const [p0, p1, , p3] = orientBox({ x: 0, y: 0 }, { x: 100, y: 50 }, turned);
    // Turned: screen x is user y, screen y is user x: the top left is the user origin.
    expect(p0).toEqual({ x: 0, y: 0 });
    expect(p1).toEqual({ x: 0, y: 50 });
    expect(p3).toEqual({ x: 100, y: 0 });
  });

  it("gives the screen's right and down in user space", () => {
    expect(screenAxes({ x: 5, y: 5 }, upright)).toEqual({ right: { x: 1, y: 0 }, down: { x: 0, y: -1 } });
    expect(screenAxes({ x: 5, y: 5 }, turned)).toEqual({ right: { x: 0, y: 1 }, down: { x: 1, y: 0 } });
    expect(boxFrom({ x: 0, y: 50 }, { x: 1, y: 0 }, { x: 0, y: -1 }, 100, 50)).toEqual(BOX);
  });

  it("grows a box down to a height, never shorter", () => {
    expect(growBox(BOX, 80)).toEqual([BOX[0], BOX[1], { x: 100, y: -30 }, { x: 0, y: -30 }]);
    expect(growBox(BOX, 20)).toEqual(BOX);
  });
});

describe("wrapping", () => {
  const measure = (s: string) => s.length;

  it("breaks at line breaks, and wraps words to the width", () => {
    expect(wrapText("one two three\nfour", null, measure)).toEqual(["one two three", "four"]);
    expect(wrapText("one two three", 8, measure)).toEqual(["one two", "three"]);
    expect(wrapText("one   two", 4, measure)).toEqual(["one", "two"]);
  });

  it("breaks a word wider than the line between characters; keeps an indent and empty lines", () => {
    expect(wrapText("abcdefghij", 4, measure)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("  in\n\nout", 10, measure)).toEqual(["  in", "", "out"]);
  });
});

describe("text markup hits and leaders", () => {
  it("hits a text box inside; a typewriter likewise", () => {
    expect(hitMarkup(make("text", BOX), { x: 50, y: 25 }, 1)).toBe(true);
    expect(hitMarkup(make("typewriter", BOX), { x: 150, y: 25 }, 1)).toBe(false);
  });

  it("hits a note's icon around its point (the index too)", () => {
    const note = make("note", [{ x: 0, y: 0 }]);
    expect(hitMarkup(note, { x: 7, y: -7 }, 0.5)).toBe(true);
    expect(hitMarkup(note, { x: 10, y: 0 }, 0.5)).toBe(false);
    expect(new MarkupIndex([note]).hit({ x: 7, y: 7 }, 0.5)).toBe(note);
  });

  it("runs a callout's leader from the nearer side to its tip, and hits it", () => {
    const callout = make("callout", [...BOX, { x: 200, y: 25 }]);
    expect(isTextMarkup(callout) && leaderOf(callout)).toEqual([{ x: 100, y: 25 }, { x: 200, y: 25 }]);
    expect(hitMarkup(callout, { x: 150, y: 25.5 }, 1)).toBe(true);
    expect(hitMarkup(callout, { x: 150, y: 40 }, 1)).toBe(false);
  });

  it("runs a Cloud+'s leader to the cloud's nearest corner; hits the cloud, the box and the leader", () => {
    const ring = [
      { x: 300, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 100 },
      { x: 300, y: 100 },
    ];
    const m = make("cloudplus", [...ring, ...BOX]);
    expect(isTextMarkup(m) && leaderOf(m)).toEqual([{ x: 100, y: 25 }, { x: 300, y: 0 }]);
    expect(isTextMarkup(m) && textBoxOf(m)).toEqual(BOX);
    for (const p of [{ x: 350, y: 50 }, { x: 50, y: 25 }, { x: 200, y: 12.5 }]) expect(hitMarkup(m, p, 1)).toBe(true);
    expect(hitMarkup(m, { x: 200, y: 80 }, 1)).toBe(false);
  });
});
