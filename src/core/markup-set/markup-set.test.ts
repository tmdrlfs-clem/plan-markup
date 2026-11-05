import { describe, expect, it } from "vitest";

import { ensureMarkupSetSchema, pageGeometryOf, saveCalibrationsSchema, setFilename } from "./markup-set";

const SHA = "a".repeat(64);
const PAGE = { rotation: 0, cropBox: [0, 0, 842, 595], width: 842, height: 595 } as const;
const CAL = { xFactor: 26.46, yFactor: 26.46, unit: "mm", precision: "0.0", source: "ratio" } as const;

describe("markup set inputs (Story 6.1)", () => {
  it("a page's geometry: its /Rotate normalised, its view box or the whole page", () => {
    expect(pageGeometryOf({ width: 842, height: 595, rotate: -90, view: [10, 20, 852, 615] })).toEqual({ rotation: 270, cropBox: [10, 20, 852, 615], width: 842, height: 595 });
    expect(pageGeometryOf({ width: 595, height: 842, rotate: 450 })).toEqual({ rotation: 90, cropBox: [0, 0, 595, 842], width: 595, height: 842 });
  });

  it("takes a hash, a filename and page geometry only", () => {
    expect(ensureMarkupSetSchema.safeParse({ sha256: SHA, filename: " L17.pdf ", pages: [PAGE] })).toMatchObject({ success: true, data: { filename: "L17.pdf" } });
    for (const bad of [
      { sha256: SHA.toUpperCase(), filename: "a.pdf", pages: [PAGE] },
      { sha256: SHA, filename: "  ", pages: [PAGE] },
      { sha256: SHA, filename: "a.pdf", pages: [] },
      { sha256: SHA, filename: "a.pdf", pages: [{ ...PAGE, rotation: 45 }] },
      { sha256: SHA, filename: "a.pdf", pages: [{ ...PAGE, width: Number.NaN }] },
    ])
      expect(ensureMarkupSetSchema.safeParse(bad).success).toBe(false);
  });

  it("calibrations by server page id; null removes one", () => {
    const pageId = "01890a5d-ac96-774b-bcce-b302099a8057";
    expect(saveCalibrationsSchema.safeParse([{ pageId, calibration: CAL }, { pageId, calibration: null }]).success).toBe(true);
    expect(saveCalibrationsSchema.safeParse([{ pageId: `${SHA}:0`, calibration: CAL }]).success).toBe(false);
    expect(saveCalibrationsSchema.safeParse([{ pageId, calibration: { ...CAL, xFactor: -1 } }]).success).toBe(false);
  });

  it("a long filename keeps its end", () => {
    expect(setFilename(null)).toBe("Untitled.pdf");
    expect(setFilename(`${"x".repeat(300)}L17.pdf`)).toHaveLength(255);
    expect(setFilename(`${"x".repeat(300)}L17.pdf`).endsWith("L17.pdf")).toBe(true);
  });
});
