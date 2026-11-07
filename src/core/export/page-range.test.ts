import { describe, expect, it } from "vitest";

import { parsePageRange } from "./page-range";

describe("page range (Story 8.1)", () => {
  it("reads 1-based pages and ranges, in order, once each", () => {
    expect(parsePageRange("1-3, 5", 6)).toEqual({ ok: true, pages: [0, 1, 2, 4] });
    expect(parsePageRange(" 4 ,2-2, 3–4", 6)).toEqual({ ok: true, pages: [1, 2, 3] });
  });

  it("refuses what it cannot read or what is not a page", () => {
    for (const bad of ["", "0", "7", "3-1", "1,,2", "a", "1-", "2-9"]) expect(parsePageRange(bad, 6).ok, bad).toBe(false);
    expect(parsePageRange("9", 6)).toEqual({ ok: false, reason: "Enter pages like 1-3, 5 (1 to 6)." });
  });
});
