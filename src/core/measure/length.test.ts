import { describe, expect, it } from "vitest";

import { calibrationsFor, factorForRatio, factorFromPoints, type Calibration } from "@/core/calibration/calibration";
import { verifyCalibration } from "@/core/calibration/verify";

import { SCALE_NOT_SET, captionPlacement, lengthCaption, lengthMm, paperLengthPt } from "./length";

const at = (ratio: number, unit: Calibration["unit"] = "mm", precision: Calibration["precision"] = "0"): Calibration => ({
  xFactor: factorForRatio(ratio),
  yFactor: factorForRatio(ratio),
  unit,
  precision,
  source: "ratio",
  ratio,
});

describe("length measurements (Story 4.5)", () => {
  it("measures segment by segment under the calibration; UserUnit scales user space", () => {
    expect(lengthMm([{ x: 0, y: 0 }, { x: 72, y: 0 }], at(75))).toBeCloseTo(1905, 9);
    expect(lengthMm([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 0 }], at(1))).toBeCloseTo((50 + 40) * (25.4 / 72), 9);
    expect(lengthMm([{ x: 0, y: 0 }, { x: 36, y: 0 }], at(75), 2)).toBeCloseTo(1905, 9);
    expect(paperLengthPt([{ x: 0, y: 0 }, { x: 36, y: 0 }], 2)).toBeCloseTo(72, 9);
  });

  it("never gives a number without a calibration", () => {
    expect(lengthMm([{ x: 0, y: 0 }, { x: 72, y: 0 }], null)).toBeNull();
    expect(lengthCaption([{ x: 0, y: 0 }, { x: 72, y: 0 }], null)).toEqual({ text: SCALE_NOT_SET, scaled: false });
  });

  it("captions in the calibration's unit and precision, exactly as Verify shows the same two points (NFR8)", () => {
    const line = [{ x: 10, y: 20 }, { x: 210, y: 20 }];
    for (const c of [at(100), at(100, "m", "0.00"), at(100, "ft-in", "1/8"), at(100, "in", "0.0"), at(33.3, "mm", "0.0")]) {
      const caption = lengthCaption(line, c);
      expect(caption.scaled).toBe(true);
      expect(caption.text).toBe(verifyCalibration({ dxPt: 200, dyPt: 0 }, c, null).measuredText);
    }
    expect(lengthCaption(line, at(100)).text).toBe("7056 mm");
    // A two-point calibration measured on its own points reads the typed distance.
    const f = factorFromPoints(123.4, 4321);
    expect(lengthCaption([{ x: 0, y: 0 }, { x: 123.4, y: 0 }], { ...at(1), xFactor: f, yFactor: f }).text).toBe("4321 mm");
  });

  it("separate X / Y on a /Rotate 90 page: the page's vertical scale applies along user space x", () => {
    const c = calibrationsFor({ kind: "ratio", ratio: 100, sheet: null, yRatio: 50 }, [{ index: 0, size: { width: 842, height: 595, rotate: 90 } }], { unit: "mm", precision: "0" }).get(0)!;
    expect(lengthCaption([{ x: 0, y: 0 }, { x: 72, y: 0 }], c).text).toBe("1270 mm");
    expect(lengthCaption([{ x: 0, y: 0 }, { x: 0, y: 72 }], c).text).toBe("2540 mm");
  });

  it("places the caption above the line's middle, never upside down", () => {
    const flat = captionPlacement({ x: 0, y: 100 }, { x: 100, y: 100 }, 6);
    expect(flat).toEqual({ x: 50, y: 94, angle: 0 });
    // Drawn right to left: same readable angle, still above.
    const back = captionPlacement({ x: 100, y: 100 }, { x: 0, y: 100 }, 6);
    expect(back.angle).toBeCloseTo(0, 12);
    expect(back.y).toBeCloseTo(94, 12);
    // Vertical either way: turned a quarter back, text reading upwards, offset to the left of the line.
    for (const [a, b] of [
      [{ x: 50, y: 100 }, { x: 50, y: 0 }],
      [{ x: 50, y: 0 }, { x: 50, y: 100 }],
    ]) {
      const up = captionPlacement(a, b, 6);
      expect(up.angle).toBeCloseTo(-Math.PI / 2, 12);
      expect(up.x).toBeCloseTo(44, 12);
    }
  });
});
