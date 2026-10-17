// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ColorSwatch, ColorSwatchGroup } from "./color-swatch";

const COLORS = [
  { value: "#d32f2f", label: "Red" },
  { value: "#1976d2", label: "Blue" },
  { value: "#388e3c", label: "Green" },
];

describe("ColorSwatch", () => {
  it("is named by the colour name, applies the colour inline and fires onSelect", async () => {
    const onSelect = vi.fn();
    render(<ColorSwatch color="#d32f2f" label="Red" onSelect={onSelect} />);
    const swatch = screen.getByRole("button", { name: "Red" });
    expect(swatch).toHaveStyle({ backgroundColor: "#d32f2f" });
    expect(swatch).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(swatch);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks the selected state with a check glyph and a thicker border, not colour alone", () => {
    render(<ColorSwatch color="#d32f2f" label="Red" selected />);
    const swatch = screen.getByRole("button", { name: "Red" });
    expect(swatch).toHaveAttribute("aria-pressed", "true");
    expect(swatch.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(swatch.className).toContain("data-[selected=true]:border-2");
  });
});

describe("ColorSwatchGroup", () => {
  function Fixture() {
    const [value, setValue] = useState("#d32f2f");
    return <ColorSwatchGroup aria-label="Markup colour" colors={COLORS} value={value} onValueChange={setValue} />;
  }

  it("is a named radio group with named swatches", () => {
    render(<Fixture />);
    expect(screen.getByRole("radiogroup", { name: "Markup colour" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["Red", "Blue", "Green"]);
  });

  it("roves with arrow keys, selects, and shows the glyph only on the selected one", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    const [red, blue, green] = screen.getAllByRole("radio");
    expect(red).toHaveFocus();
    expect(red).toHaveAttribute("aria-checked", "true");
    expect(red.querySelector("svg.lucide-check")).toBeInTheDocument();
    // Radix focuses on a timeout and selects the radio only while the arrow key is still held.
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(blue).toHaveFocus());
    await user.keyboard("{/ArrowRight}");
    await waitFor(() => expect(blue).toHaveAttribute("aria-checked", "true"));
    expect(blue.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(red.querySelector("svg.lucide-check")).not.toBeInTheDocument();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(green).toHaveFocus();
  });
});
