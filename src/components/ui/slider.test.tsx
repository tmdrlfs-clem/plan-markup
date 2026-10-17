// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SliderField } from "./slider";

function Fixture() {
  const [value, setValue] = useState(3);
  return <SliderField label="Ceiling height" value={value} onValueChange={setValue} min={1.8} max={4.6} step={0.1} suffix="m" />;
}

describe("SliderField", () => {
  it("names the thumb and the field with the same label and renders the limits", () => {
    render(<Fixture />);
    expect(screen.getByRole("slider", { name: "Ceiling height" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Ceiling height" })).toBeInTheDocument();
    expect(screen.getByText("1.8 — 4.6 m")).toBeInTheDocument();
    expect(screen.getAllByText("Ceiling height")).toHaveLength(2);
  });

  it("updates the field when the thumb moves with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "3");
    thumb.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("spinbutton")).toHaveValue("3.1");
    await user.keyboard("{Home}");
    expect(screen.getByRole("spinbutton")).toHaveValue("1.8");
    expect(thumb).toHaveAttribute("aria-valuenow", "1.8");
    await user.keyboard("{End}");
    expect(thumb).toHaveAttribute("aria-valuenow", "4.6");
  });

  it("moves the thumb when a value is typed into the field", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const field = screen.getByRole("spinbutton");
    await user.clear(field);
    await user.type(field, "4.2{Enter}");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "4.2");
  });

  it("clamps a typed value to the limits and steps with the field's arrows", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const field = screen.getByRole("spinbutton");
    await user.clear(field);
    await user.type(field, "99{Enter}");
    expect(field).toHaveValue("4.6");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "4.5");
  });
});
