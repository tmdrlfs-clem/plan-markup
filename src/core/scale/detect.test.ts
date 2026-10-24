import { describe, expect, it } from "vitest";

import type { TextItem } from "@/core/search/page-text";

import { conflictReadings, conflictWarning, conversionNote, detectScales, scaleLabel, textLines } from "./detect";
import { findRatios } from "./ratio";
import { niceRatio, ratioOnPage } from "./sheet";

const MM = 72 / 25.4;
const A1 = [841 * MM, 594 * MM] as const;
const A2 = [594 * MM, 420 * MM] as const;
const A3 = [420 * MM, 297 * MM] as const;

/** A run at baseline (x, y) in page space (y down), in direction `angle` (degrees, 0 = rightwards). */
function run(str: string, x: number, y: number, opts: { size?: number; angle?: number; eol?: boolean; width?: number } = {}): TextItem {
  const size = opts.size ?? 10;
  const width = opts.width ?? 0.5 * size * str.length;
  const a = ((opts.angle ?? 0) * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [uy, -ux]; // "up" from the baseline in page space
  const p = (along: number, up: number) => [x + ux * along + nx * up, y + uy * along + ny * up];
  const [bl, br, tr, tl] = [p(0, -0.2 * size), p(width, -0.2 * size), p(width, 0.8 * size), p(0, 0.8 * size)];
  return { str, x, y, width, fontSize: size, quad: [...bl, ...br, ...tr, ...tl] as unknown as TextItem["quad"], eol: opts.eol ?? false };
}
/** A line of words, one run each, separated by a space's width. */
function line(words: string[], x: number, y: number, opts: { size?: number; angle?: number } = {}): TextItem[] {
  const size = opts.size ?? 10;
  const out: TextItem[] = [];
  let along = 0;
  const a = ((opts.angle ?? 0) * Math.PI) / 180;
  for (const w of words) {
    out.push(run(w, x + Math.cos(a) * along, y + Math.sin(a) * along, opts));
    along += 0.5 * size * w.length + 0.3 * size;
  }
  out[out.length - 1] = { ...out[out.length - 1], eol: true };
  return out;
}
const detect = (items: TextItem[], [w, h]: readonly [number, number] = A1) => detectScales(items, w, h);

describe("findRatios", () => {
  it.each([
    ["1:100 @ A1", 100, "A1"],
    ["SCALE 1:50", 50, null],
    ["1 : 200 at A3", 200, "A3"],
    ["1:100@A1", 100, "A1"],
    ["SCALE: 1/100", 100, null],
    ["1:1250 (A1)", 1250, "A1"],
    ["1:500 FOR ANSI D", 500, "ANSI D"],
    // Review D2: punctuation after the number, a label colon, the ratio sign.
    ["SCALE 1:100.", 100, null],
    ["SCALE:1:100", 100, null],
    ["SCALE: 1:20 @A3", 20, "A3"],
    ["1∶100", 100, null],
    ["1:100 A1", 100, "A1"],
    // Review D4: a slope word further back is not context.
    ["RAMP PLAN 1:50", 50, null],
    ["GRADE BEAM DETAIL 1:20", 20, null],
    ["SCALE RATIO 1:100", 100, null],
    // Review D6: a short view title is not a note; a long line with SCALE before the ratio neither.
    ["GROUND FLOOR PLAN - LEVEL 1 - PROPOSED 1:100", 100, null],
    ["SHEET TITLE GROUND FLOOR PLAN PROJECT NEW HOUSE CLIENT SMITH SCALE 1:100 @ A1", 100, "A1"],
  ])("finds %j", (text, ratio, sheet) => {
    expect(findRatios(text)).toMatchObject([{ ratio, sheet, imperial: false }]);
  });

  it.each([
    [`1/8" = 1'-0"`, 96],
    [`1/4"=1'`, 48],
    [`3/16″ = 1′-0″`, 64],
    [`1 1/2" = 1'-0"`, 8],
    [`1" = 20'`, 240],
    // Review D3: the hyphenated mixed number.
    [`1-1/2" = 1'-0"`, 8],
    [`SCALE: 1-1/2"=1'-0"`, 8],
  ])("converts the imperial scale %j to a ratio", (text, ratio) => {
    expect(findRatios(text)).toMatchObject([{ ratio, imperial: true }]);
  });

  it.each([
    "As indicated",
    "NTS",
    "NOT TO SCALE",
    "AS SHOWN",
    "1:30 PM",
    "11:30",
    "1:20 pm",
    "12/10/2026",
    "1/10/2026",
    "REV C 1/10/26 ISSUED FOR CONSTRUCTION",
    "slope 1:40",
    "FALL 1:60 MIN",
    "min. gradient 1:100",
    "1:100 year flood",
    "1:100 AEP",
    "GRID A1 / B2",
    "2700 x 1200",
    "1:3 (cement : sand)",
    "1:7",
    "1/2 HR FIRE RATED",
    "1:100.5",
    "12:1:30",
    "FALL AT 1:60",
    "FALLS MIN. 1:80",
    // Review D6: ratios inside notes.
    "REFER TO 1:50 DETAILS FOR ALL FLASHINGS AND THE LIKE",
    "ALL WORK TO BE READ IN CONJUNCTION WITH THE 1:20 SECTIONS PROVIDED",
  ])("finds nothing in %j", (text) => {
    expect(findRatios(text)).toEqual([]);
  });
});

describe("sheet conversion", () => {
  it("1:100 stated for A1 is 1:200 on A3, exactly (√2 per ISO step), and unchanged on A1", () => {
    expect(ratioOnPage(100, "A1", ...A3)).toBeCloseTo(200, 9);
    expect(ratioOnPage(20, "A1", ...A3)).toBeCloseTo(40, 9);
    expect(ratioOnPage(100, "A1", ...A1)).toBe(100);
    expect(ratioOnPage(100, "A3", ...A1)).toBeCloseTo(50, 9);
    expect(ratioOnPage(100, null, ...A3)).toBe(100);
  });
  it("across series by the long edges; on a non-standard page by its own size", () => {
    // ANSI D (34 in) printed on A1 (841 mm): 1:100 × 863.6 / 841.
    expect(ratioOnPage(100, "ANSI D", ...A1)).toBeCloseTo((100 * 863.6) / 841, 6);
    expect(ratioOnPage(100, "A1", 1000, 600)).toBeCloseTo((100 * 841) / ((1000 * 25.4) / 72), 6);
  });
  it("review D5: a bare sheet-like code after a ratio is not a sheet unless it is ISO A0-A4", () => {
    expect(findRatios("SECTION 1:50 B2")).toMatchObject([{ ratio: 50, sheet: null }]);
    expect(findRatios("SECTION 1:50 ANSI D")).toMatchObject([{ ratio: 50, sheet: null }]);
    expect(findRatios("SECTION 1:50 @ B2")).toMatchObject([{ ratio: 50, sheet: "B2" }]);
    expect(findRatios("PLAN 1:50, SECTION 1:100")).toMatchObject([{ ratio: 50 }, { ratio: 100 }]);
  });
  it("rounds to the usual ratios within 2 %", () => {
    expect(niceRatio(101.5)).toBe(100);
    expect(niceRatio(141.4)).toBe(141.4);
  });
});

describe("detectScales", () => {
  it("a qualified title-block scale on its own sheet", () => {
    const r = detect(line(["SCALE", "1:100", "@", "A1"], 100, 100));
    expect(r.pageSheet).toBe("A1");
    expect(r.scales).toMatchObject([{ ratio: 100, sheet: "A1", effective: 100, count: 1 }]);
    expect(r.scales[0].quads.length).toBeGreaterThan(0);
    expect(scaleLabel(r.scales[0])).toBe("1:100 @ A1");
    expect(conversionNote(r.scales[0], r.pageSheet)).toBeNull();
  });

  it("the same text on an A3 page is 1:200, and the UI note says both", () => {
    const r = detect(line(["SCALE", "1:100", "@", "A1"], 100, 100), A3);
    expect(r.scales).toMatchObject([{ ratio: 100, sheet: "A1", effective: 200 }]);
    expect(conversionNote(r.scales[0], r.pageSheet)).toBe("1:100 @ A1 → 1:200 on this A3 page");
  });

  it("a ratio split across runs ('1', ':', '100') is found, and rotated text too", () => {
    expect(detect(line(["1", ":", "100"], 50, 50)).scales).toMatchObject([{ ratio: 100 }]);
    expect(detect(line(["SCALE", "1:50"], 300, 300, { angle: -90 })).scales).toMatchObject([{ ratio: 50 }]);
  });

  it("joins runs drawn out of order on one baseline (a Revit view title: '1 : 75', '1 : 200', '@ A1', '@ A3 PLAN VIEW')", () => {
    const items = [run("1 : 75", 795, 1403, { size: 8, width: 22 }), run("1 : 200", 857, 1403, { size: 8, width: 25 }), run("@ A1", 824, 1403, { size: 8, width: 16 }), run("@ A3 PLAN VIEW", 884, 1403, { size: 8, width: 60 })];
    expect(textLines(items)).toHaveLength(1);
    // One view's scale for two sheet sizes, and they disagree (1:75 @ A1 is 1:150 @ A3): one scale,
    // flagged, both readings kept, the page's own sheet first (founder decision 2026-10-24, review D1).
    const a1 = detect(items).scales;
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({ conflict: true, ratio: 75, sheet: "A1", effective: 75, count: 1 });
    expect(a1[0].readings.map((r) => [r.ratio, r.sheet, r.effective])).toEqual([
      [75, "A1", 75],
      [200, "A3", 100],
    ]);
    expect(conflictReadings(a1[0], "A1")).toEqual(["1:75 @ A1 = 1:75 on this A1 page", "1:200 @ A3 = 1:100 on this A1 page"]);
    // On an A3 page the A3 statement comes first.
    const a3 = detect(items, A3).scales;
    expect(a3[0]).toMatchObject({ conflict: true, ratio: 200, sheet: "A3", effective: 200 });
    expect(a3[0].readings.map((r) => r.effective)).toEqual([200, 150]);
    // On an A2 page (neither sheet) still one scale, not "2 scales on page".
    expect(detect(items, A2).scales).toHaveLength(1);
  });

  it("review D1: agreeing statements for two sheets are one plain scale; a bare repeat of a reading folds into the conflict", () => {
    const agree = [...line(["1:100", "@", "A1", "1:200", "@", "A3"], 100, 100)];
    expect(detect(agree).scales).toMatchObject([{ conflict: false, effective: 100, ratio: 100, sheet: "A1", count: 1 }]);
    expect(detect(agree).scales[0].readings).toHaveLength(2);
    expect(detect(agree, A2).scales).toMatchObject([{ conflict: false, effective: 141.42 }]);
    const disagree = [...line(["1:75", "@", "A1", "1:200", "@", "A3"], 100, 100), ...line(["PLAN", "1:75"], 900, 900), ...line(["KEY", "PLAN", "1:20"], 100, 1400)];
    expect(detect(disagree).scales.map((s) => [s.conflict, s.effective, s.count])).toEqual([
      [true, 75, 2],
      [false, 20, 1],
    ]);
  });

  it("two viewport scales count twice; the same scale repeated (and a bare one next to the qualified) counts once", () => {
    const items = [
      ...line(["PLAN", "1:50"], 100, 100),
      ...line(["SECTION", "1:100"], 100, 400),
      ...line(["SECTION", "B", "1:100"], 600, 400),
      ...line(["SCALE", "1:100", "@", "A1"], 1800, 1600),
    ];
    const r = detect(items);
    expect(r.scales.map((s) => [s.effective, s.count, s.sheet])).toEqual([
      [100, 3, "A1"],
      [50, 1, null],
    ]);
  });

  it("no false scale from 'As indicated', a slope, a date, a time or a return period; separate cells are separate lines", () => {
    const items = [
      ...line(["SCALE"], 100, 100),
      ...line(["As", "indicated"], 200, 100), // a cell further along: another line
      ...line(["FALLS", "1:40", "TO", "OUTLET"], 100, 300),
      ...line(["DATE", "12/10/2026", "1:30", "PM"], 100, 500),
      ...line(["DESIGNED", "FOR", "1:100", "YEAR", "FLOOD"], 100, 700),
    ];
    expect(detect(items).scales).toEqual([]);
    expect(textLines(line(["SCALE"], 100, 100).concat(line(["As", "indicated"], 200, 100)))).toHaveLength(2);
  });

  it("drops a ratio implausible for the page (the sheet would be over 50 km)", () => {
    expect(detect(line(["1:10000"], 10, 10)).scales).toMatchObject([{ effective: 10000 }]); // A1: 8.4 km
    expect(detect(line(["1:10000"], 10, 10), [10 * 841 * MM, 10 * 594 * MM]).scales).toEqual([]); // 84 km
  });
});

describe("conflictWarning (Story 4.3 AC 6)", () => {
  it("compares the first statement converted to the other's sheet with what is printed", () => {
    const items = [run("1 : 75", 795, 1403, { size: 8, width: 22 }), run("1 : 200", 857, 1403, { size: 8, width: 25 }), run("@ A1", 824, 1403, { size: 8, width: 16 }), run("@ A3 PLAN VIEW", 884, 1403, { size: 8, width: 60 })];
    expect(conflictWarning(detect(items).scales[0])).toBe("Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed");
  });
});
