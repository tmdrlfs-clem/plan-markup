import { describe, expect, it } from "vitest";
import { normalizeTypes } from "./check-types-drift.mjs";

describe("normalizeTypes", () => {
  it("normalises CRLF, trailing whitespace and the final newline", () => {
    expect(normalizeTypes("export type A = 1;  \r\n\r\nexport type B = 2;\r\n\r\n")).toBe(
      "export type A = 1;\n\nexport type B = 2;\n",
    );
  });

  it("detects a real change", () => {
    expect(normalizeTypes("type A = 1\n")).not.toBe(normalizeTypes("type A = 2\n"));
  });
});
