import { describe, expect, it } from "vitest";

import {
  cleanLabel,
  cleanPageLabels,
  detectSheetLabel,
  isSheetNumber,
  MAX_PAGE_LABEL_LENGTH,
  pageForLabel,
  sheetLabelOf,
  type TextRun,
} from "./sheet-label";

const A1 = { width: 2384, height: 1684 };

/** Body text spread over the sheet: grid refs, room names, dimensions, callouts. */
function body(): TextRun[] {
  const runs: TextRun[] = [];
  for (let i = 0; i < 40; i++) {
    runs.push({ str: `ROOM ${i}`, x: 100 + (i % 10) * 180, y: 100 + Math.floor(i / 10) * 300, width: 40, fontSize: 9 });
    runs.push({ str: String(1200 + i * 5), x: 150 + (i % 10) * 180, y: 160 + Math.floor(i / 10) * 300, width: 20, fontSize: 9 });
  }
  // Detail callouts that look like drawing numbers, small and all over the sheet.
  runs.push({ str: "A2161", x: 1620, y: 1160, width: 30, fontSize: 8 });
  runs.push({ str: "A1713", x: 660, y: 1100, width: 30, fontSize: 8 });
  return runs;
}

/** An L17-like title block: captions at 9 pt, the drawing number at 19.5 pt in the corner. */
function titleBlock(number = "A1721"): TextRun[] {
  return [
    { str: "PROJECT", x: 2057, y: 1610, width: 40, fontSize: 9 },
    { str: "DRAWING NUMBER", x: 2158, y: 1610, width: 80, fontSize: 9 },
    { str: "REVISON", x: 2303, y: 1610, width: 40, fontSize: 9 },
    { str: "PCIP1133", x: 2057, y: 1642, width: 90, fontSize: 19.5 },
    { str: number, x: 2171, y: 1642, width: 60, fontSize: 19.5 },
    { str: "2", x: 2330, y: 1642, width: 10, fontSize: 19.5 },
    { str: "LEVEL 17 REFLECTED CEILING PLAN", x: 2057, y: 1427, width: 200, fontSize: 12 },
    { str: "A1 SCALE As indicated", x: 2151, y: 1483, width: 100, fontSize: 9 },
  ];
}

describe("isSheetNumber", () => {
  it("accepts common drawing-number shapes", () => {
    for (const t of ["A1721", "FP-101", "M.201", "E201B", "AR-0042", "12-AR-001", "123-M-45"]) expect(isSheetNumber(t)).toBe(true);
  });
  it("rejects revisions, paper sizes, grid refs, words and dates", () => {
    for (const t of ["2", "A1", "D3", "PCIP1133", "LEVEL", "16/08/26", "a1721", "ABCD12"]) expect(isSheetNumber(t)).toBe(false);
  });

  it("rejects pipe sizes, pressure ratings and standard references", () => {
    for (const t of ["DN150", "DN25", "NB100", "PN16", "NZS4541", "AS1851", "AS-2118", "EN12845", "BS9251", "ISO9001", "DIN1988"]) {
      expect(isSheetNumber(t)).toBe(false);
    }
    // Real sheet numbers with the same letters stay sheet numbers.
    for (const t of ["AS101", "EN-201", "D150A", "PN-01"]) expect(isSheetNumber(t)).toBe(true);
  });
});

describe("detectSheetLabel", () => {
  it("finds the captioned, large number in the bottom-right title block (L17 / L21 layout)", () => {
    expect(detectSheetLabel([...body(), ...titleBlock()], A1)).toBe("A1721");
    expect(detectSheetLabel([...body(), ...titleBlock("A2121")], A1)).toBe("A2121");
  });

  it("works without a caption when the number is clearly larger than the body text", () => {
    const runs = [...body(), { str: "S-101", x: 2200, y: 1640, width: 50, fontSize: 18 }];
    expect(detectSheetLabel(runs, A1)).toBe("S-101");
  });

  it("finds a number inside a longer run (e.g. 'DWG NO. FP-301')", () => {
    const runs = [...body(), { str: "DWG NO. FP-301", x: 2000, y: 1600, width: 120, fontSize: 9 }];
    expect(detectSheetLabel(runs, A1)).toBe("FP-301");
  });

  it("is not fooled by a large pipe size or standard reference in the title block", () => {
    const notes = [
      { str: "DN150", x: 2250, y: 1500, width: 50, fontSize: 24 },
      { str: "DESIGNED TO NZS4541", x: 2000, y: 1560, width: 150, fontSize: 18 },
    ];
    expect(detectSheetLabel([...body(), ...notes], A1)).toBeNull();
    expect(detectSheetLabel([...body(), ...notes, ...titleBlock()], A1)).toBe("A1721");
  });

  it("ignores numbers outside the bottom-right quadrant", () => {
    const runs = [...body(), { str: "S-101", x: 200, y: 1640, width: 50, fontSize: 18 }, { str: "S-102", x: 2200, y: 200, width: 50, fontSize: 18 }];
    expect(detectSheetLabel(runs, A1)).toBeNull();
  });

  it("returns null when unsure: small uncaptioned numbers, or two equally likely numbers", () => {
    expect(detectSheetLabel(body(), A1)).toBeNull();
    const tie = [
      ...body(),
      { str: "S-101", x: 2200, y: 1640, width: 50, fontSize: 18 },
      { str: "S-102", x: 2100, y: 1640, width: 50, fontSize: 18 },
    ];
    expect(detectSheetLabel(tie, A1)).toBeNull();
  });

  it("returns null for pages without text or with no size", () => {
    expect(detectSheetLabel([], A1)).toBeNull();
    expect(detectSheetLabel(titleBlock(), { width: 0, height: 10 })).toBeNull();
  });

  it("works in page space of a rotated page (the title block is bottom-right as displayed)", () => {
    const portrait = { width: 1684, height: 2384 };
    const runs = [...body(), { str: "DRAWING NO.", x: 1450, y: 2290, width: 60, fontSize: 7 }, { str: "E-201", x: 1460, y: 2320, width: 50, fontSize: 16 }];
    expect(detectSheetLabel(runs, portrait)).toBe("E-201");
  });
});

describe("page labels", () => {
  it("cleans control characters and whitespace", () => {
    expect(cleanLabel("A1721 - LEVEL 17\u0000")).toBe("A1721 - LEVEL 17");
    expect(cleanLabel("  FP  101\n")).toBe("FP 101");
  });

  it("cleanPageLabels is null when there is nothing beyond page numbers", () => {
    expect(cleanPageLabels(null)).toBeNull();
    expect(cleanPageLabels([])).toBeNull();
    expect(cleanPageLabels(["1", "2", "3"])).toBeNull();
    expect(cleanPageLabels(["", null, ""])).toBeNull();
    expect(cleanPageLabels(["1", "FP-201\u0000", "3"])).toEqual(["1", "FP-201", "3"]);
  });

  it("sheetLabelOf: a different page label wins, '<number> - <title>' shows the number; else the detected number", () => {
    expect(sheetLabelOf(1, "A1721 - LEVEL 17 REFLECTED CEILING PLAN", "X-1")).toEqual({
      short: "A1721",
      full: "A1721 - LEVEL 17 REFLECTED CEILING PLAN",
    });
    expect(sheetLabelOf(2, "FP-201", null)).toEqual({ short: "FP-201", full: "FP-201" });
    expect(sheetLabelOf(3, "Cover sheet", null)).toEqual({ short: "Cover sheet", full: "Cover sheet" });
    expect(sheetLabelOf(4, "4", "S-104")).toEqual({ short: "S-104", full: "S-104" });
    expect(sheetLabelOf(5, null, null)).toBeNull();
  });

  it("pageForLabel ignores case (founder decision 2026-10-23)", () => {
    const labels = ["1", "A1721 - LEVEL 17 RCP", "FP-201"];
    expect(pageForLabel("a1721", labels, {})).toBe(1);
    expect(pageForLabel("a1721 - level 17 rcp", labels, {})).toBe(1);
    expect(pageForLabel("fp-201", labels, {})).toBe(2);
    expect(pageForLabel("s-101", null, { 0: "S-101", 3: null })).toBe(0);
  });

  it("cleanPageLabels caps a label at MAX_PAGE_LABEL_LENGTH (the cache schema's limit)", () => {
    const long = "X".repeat(MAX_PAGE_LABEL_LENGTH + 50);
    expect(cleanPageLabels([long])?.[0]).toHaveLength(MAX_PAGE_LABEL_LENGTH);
  });

  it("pageForLabel matches page labels (full or number) and detected numbers", () => {
    const labels = ["1", "A1721 - LEVEL 17", "FP-201"];
    expect(pageForLabel("A1721", labels, {})).toBe(1);
    expect(pageForLabel("FP-201", labels, {})).toBe(2);
    expect(pageForLabel("S-101", labels, { 0: "S-101" })).toBe(0);
    expect(pageForLabel("1", labels, {})).toBeNull(); // a page-number label is not a sheet label
    expect(pageForLabel("nope", labels, {})).toBeNull();
    expect(pageForLabel("  ", null, {})).toBeNull();
  });
});
