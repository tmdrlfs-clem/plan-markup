import { describe, expect, it } from "vitest";

import { SHEETS, sheetSize } from "./page-size";

const MM = 72 / 25.4; // points per millimetre
const IN = 72;

describe("sheetSize", () => {
  it.each([
    ["A0", 841, 1189],
    ["A1", 594, 841],
    ["A2", 420, 594],
    ["A3", 297, 420],
    ["A4", 210, 297],
    ["B0", 1000, 1414],
    ["B1", 707, 1000],
    ["B2", 500, 707],
    ["B3", 353, 500],
    ["B4", 250, 353],
  ])("names ISO %s in millimetres, portrait and landscape", (name, short, long) => {
    expect(sheetSize(short * MM, long * MM)).toMatchObject({ name, orientation: "portrait", unit: "mm", label: `${name} ${short} × ${long} mm` });
    expect(sheetSize(long * MM, short * MM)).toMatchObject({ name, orientation: "landscape", label: `${name} ${long} × ${short} mm` });
  });

  it.each([
    ["ANSI A", 8.5, 11],
    ["ANSI B", 11, 17],
    ["ANSI C", 17, 22],
    ["ANSI D", 22, 34],
    ["ANSI E", 34, 44],
    ["ARCH A", 9, 12],
    ["ARCH B", 12, 18],
    ["ARCH C", 18, 24],
    ["ARCH D", 24, 36],
    ["ARCH E", 36, 48],
    ["ARCH E1", 30, 42],
  ])("names %s in inches", (name, short, long) => {
    expect(sheetSize(long * IN, short * IN)).toMatchObject({ name, orientation: "landscape", unit: "in", label: `${name} ${long} × ${short} in` });
    expect(sheetSize(short * IN, long * IN).label).toBe(`${name} ${short} × ${long} in`);
  });

  it("allows ±1 % on each side, not more", () => {
    expect(sheetSize(841 * MM * 1.009, 594 * MM * 0.991).name).toBe("A1");
    expect(sheetSize(841 * MM * 1.02, 594 * MM).name).toBeNull();
  });

  it("gives any other size in the user's unit (mm by default)", () => {
    expect(sheetSize(500 * MM, 300 * MM)).toMatchObject({ name: null, series: null, orientation: "landscape", label: "500 × 300 mm" });
    expect(sheetSize(10 * IN, 5 * IN, "in").label).toBe("10 × 5 in");
    expect(sheetSize(612.4, 300, "pt").label).toBe("612 × 300 pt");
    expect(sheetSize(400, 400).orientation).toBe("square");
  });

  it("the sheet table has no two sheets within the tolerance of each other", () => {
    const mm = (s: (typeof SHEETS)[number]) => (s.unit === "mm" ? 1 : 25.4);
    for (const a of SHEETS) {
      for (const b of SHEETS) {
        if (a === b) continue;
        const close =
          Math.abs(a.short * mm(a) - b.short * mm(b)) <= b.short * mm(b) * 0.01 &&
          Math.abs(a.long * mm(a) - b.long * mm(b)) <= b.long * mm(b) * 0.01;
        expect(close, `${a.name} vs ${b.name}`).toBe(false);
      }
    }
  });
});
