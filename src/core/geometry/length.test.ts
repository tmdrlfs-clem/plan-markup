import { describe, expect, it } from "vitest";

import {
  describeLength,
  formatLength,
  formatLengthValue,
  parseLength,
  type LengthUnit,
} from "./length";

function mm(input: string, unit: LengthUnit): number {
  const result = parseLength(input, unit);
  if (!result.ok) throw new Error(`expected ${input} to parse, got ${result.reason}`);
  return result.mm;
}

describe("parseLength grammar", () => {
  const rows: Array<[string, LengthUnit, number]> = [
    ["4.6", "m", 4600],
    ["4.6", "mm", 4.6],
    ["4600 mm", "m", 4600],
    ["4600mm", "mm", 4600],
    ["4600mm", "ft-in", 4600],
    ["4.6m", "mm", 4600],
    ["4.6 M", "mm", 4600],
    ["4.6 M", "ft-in", 4600],
    ["46 cm", "m", 460],
    [".5m", "mm", 500],
    ['15\'6"', "mm", 4724.4],
    ['15\'6"', "m", 4724.4],
    ['15\' 6"', "mm", 4724.4],
    ["15'", "mm", 4572],
    ['6"', "mm", 152.4],
    ["15ft 6in", "mm", 4724.4],
    ["15-6", "ft-in", 4724.4],
    ["15.5'", "mm", 4724.4],
    ['6 1/2"', "mm", 165.1],
    ["4.6", "ft-in", 1402.08],
  ];

  it.each(rows)("parses %s (default %s) as %d mm", (input, unit, expected) => {
    expect(mm(input, unit)).toBeCloseTo(expected, 6);
  });

  it("accepts typographic quotes", () => {
    expect(mm("15′6″", "mm")).toBeCloseTo(4724.4, 6);
    expect(mm("15’6”", "mm")).toBeCloseTo(4724.4, 6);
  });

  it("accepts a fraction on its own", () => {
    expect(mm('1/2"', "mm")).toBeCloseTo(12.7, 6);
  });

  it.each([["abc"], ["4.6 kg"], ["1..2"], ["4.6m 3"], ["4,6"], ['6 1/0"'], ["15-6x"]])(
    "rejects %s as invalid",
    (input) => {
      expect(parseLength(input, "mm")).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("treats 15-6 as invalid unless the default unit is ft-in", () => {
    expect(parseLength("15-6", "mm")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports empty input", () => {
    expect(parseLength("", "mm")).toEqual({ ok: false, reason: "empty" });
    expect(parseLength("   ", "m")).toEqual({ ok: false, reason: "empty" });
  });

  it("reports negative input", () => {
    expect(parseLength("-1", "mm")).toEqual({ ok: false, reason: "negative" });
    expect(parseLength("-4.6 m", "mm")).toEqual({ ok: false, reason: "negative" });
  });

  it("does not round inside the parser", () => {
    expect(mm("4.6789", "m")).toBeCloseTo(4678.9, 6);
  });
});

describe("formatLength", () => {
  it("formats mm as an integer", () => {
    expect(formatLength(4600, "mm")).toBe("4600 mm");
    expect(formatLength(4600.4, "mm")).toBe("4600 mm");
    expect(formatLength(4600.26, "mm", { decimals: 1 })).toBe("4600.3 mm");
  });

  it("formats m with up to 3 decimals, trimmed", () => {
    expect(formatLength(4600, "m")).toBe("4.6 m");
    expect(formatLength(4678.9, "m")).toBe("4.679 m");
    expect(formatLength(5000, "m")).toBe("5 m");
  });

  it("formats ft-in to the nearest 1/8 inch", () => {
    expect(formatLength(4724.4, "ft-in")).toBe('15\'6"');
    expect(formatLength(15 * 304.8 + 6.5 * 25.4, "ft-in")).toBe('15\'6 1/2"');
    expect(formatLength(152.4, "ft-in")).toBe('0\'6"');
    expect(formatLength(25.4 / 8, "ft-in")).toBe('0\'0 1/8"');
    expect(formatLength(0, "ft-in")).toBe('0\'0"');
  });

  it("rolls 11 7/8+ inches over into the next foot", () => {
    expect(formatLength(304.8 - 0.1, "ft-in")).toBe('1\'0"');
  });

  it("gives the bare number for mm and m", () => {
    expect(formatLengthValue(4600, "m")).toBe("4.6");
    expect(formatLengthValue(4600, "mm")).toBe("4600");
  });
});

describe("describeLength", () => {
  it("speaks units", () => {
    expect(describeLength(4600, "m")).toBe("4.6 m");
    expect(describeLength(4724.4, "ft-in")).toBe("15 feet 6 inches");
    expect(describeLength(4572, "ft-in")).toBe("15 feet");
    expect(describeLength(25.4, "ft-in")).toBe("1 inch");
    expect(describeLength(0, "ft-in")).toBe("0 feet");
  });
});

describe("round trips", () => {
  it.each<[number, LengthUnit]>([
    [4600, "mm"],
    [4600, "m"],
    [4724.4, "ft-in"],
    [152.4, "ft-in"],
  ])("%d mm survives format then parse in %s", (value, unit) => {
    const text = formatLengthValue(value, unit);
    expect(mm(text, unit)).toBeCloseTo(value, 6);
  });
});
