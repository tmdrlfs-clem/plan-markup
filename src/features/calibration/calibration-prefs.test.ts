import { describe, expect, it } from "vitest";

import { calibrationPrefsKey, parseCalibrationPrefs } from "./calibration-prefs";

describe("calibration defaults per user (Story 4.3 AC 3)", () => {
  it("reads a stored unit and precision; unusable values give null (the defaults)", () => {
    expect(calibrationPrefsKey("u1")).toBe("pm.calibration.v1.u1");
    expect(parseCalibrationPrefs(JSON.stringify({ v: 1, unit: "ft-in", precision: "1/16" }))).toEqual({ unit: "ft-in", precision: "1/16" });
    // A fraction precision with a metric unit falls back to the unit's first precision.
    expect(parseCalibrationPrefs(JSON.stringify({ v: 1, unit: "mm", precision: "1/8" }))).toEqual({ unit: "mm", precision: "0" });
    expect(parseCalibrationPrefs(JSON.stringify({ v: 1, unit: "yd", precision: "0" }))).toBeNull();
    expect(parseCalibrationPrefs("{")).toBeNull();
    expect(parseCalibrationPrefs(null)).toBeNull();
  });
});
