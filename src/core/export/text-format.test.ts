import { describe, expect, it } from "vitest";

import { markupAppearance } from "./appearance";
import type { Markup } from "./model";

const cal = { xFactor: 1, yFactor: 1, unit: "mm", precision: "0" } as never;
const box = (extra: Partial<Extract<Markup, { type: "textBox" }>>): Markup =>
  ({ id: "t", subject: "Text box", author: "A", color: [1, 0, 0], width: 1, type: "textBox", rect: [0, 0, 200, 40], text: "Hello", fontSize: 10, textColor: [1, 0, 0], ...extra }) as Markup;

describe("text format in the PDF (founder 2026-11-21)", () => {
  it("plain text is Helvetica at the left margin", () => {
    const { form } = markupAppearance(box({}), cal);
    expect(form.fonts).toEqual({ Helv: "Helvetica" });
    expect(form.content).toMatch(/1 0 0 1 3 \S+ Tm/);
  });

  it("bold serif, right-aligned, underlined and struck through", () => {
    const { form } = markupAppearance(box({ font: "serif", bold: true, align: "right", underline: true, strike: true }), cal);
    expect(Object.values(form.fonts)).toEqual(["Times-Bold"]);
    const x = Number(/1 0 0 1 (\S+) \S+ Tm/.exec(form.content)![1]);
    // Right-aligned: the line ends at the right margin (200 − 3).
    expect(x).toBeGreaterThan(150);
    // Two decoration rectangles, filled.
    expect(form.content.match(/ re/g)!.length).toBeGreaterThanOrEqual(3);
    expect(form.content).toMatch(/re\nf/);
  });

  it("centred mono text sits in the middle", () => {
    const { form } = markupAppearance(box({ font: "mono", align: "center" }), cal);
    expect(Object.values(form.fonts)).toEqual(["Courier"]);
    const x = Number(/1 0 0 1 (\S+) \S+ Tm/.exec(form.content)![1]);
    // "Hello" in Courier 10 pt is 30 pt wide: (194 − 30) / 2 + 3.
    expect(x).toBeCloseTo(85, 3);
  });
});
