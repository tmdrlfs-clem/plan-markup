// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles with Space and by clicking the label", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Show grid" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Show grid" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(" ");
    expect(box).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByText("Show grid"));
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
    expect(onCheckedChange).toHaveBeenNthCalledWith(2, false);
  });

  it("shows a check glyph when checked (not colour alone)", () => {
    render(<Checkbox label="Show grid" defaultChecked />);
    expect(screen.getByRole("checkbox").querySelector("svg.lucide-check")).toBeInTheDocument();
  });

  it("reports the indeterminate state as mixed with a minus glyph", () => {
    render(<Checkbox label="Some layers" checked="indeterminate" />);
    const box = screen.getByRole("checkbox", { name: "Some layers" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box.querySelector("svg.lucide-minus")).toBeInTheDocument();
  });

  it("does not toggle while disabled", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Locked" disabled />);
    await user.click(screen.getByText("Locked"));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});
