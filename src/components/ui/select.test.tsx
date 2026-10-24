// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Select, type SelectProps } from "./select";

const OPTIONS = [
  { value: "a0", label: "A0" },
  { value: "a1", label: "A1" },
  { value: "a2", label: "A2", disabled: true },
  { value: "b1", label: "Banner" },
];

function Fixture(props: Partial<SelectProps>) {
  const [value, setValue] = useState<string | undefined>(props.value);
  return <Select label="Paper size" options={OPTIONS} {...props} value={value} onValueChange={setValue} />;
}

describe("Select", () => {
  it("associates the label with the trigger", () => {
    render(<Fixture placeholder="Choose" />);
    const trigger = screen.getByRole("combobox", { name: "Paper size" });
    expect(trigger).toHaveTextContent("Choose");
  });

  it("labelHidden keeps the accessible name but draws no label (Story 4.4)", () => {
    render(<Fixture labelHidden value="a0" />);
    expect(screen.getByRole("combobox", { name: "Paper size" })).toBeInTheDocument();
    expect(screen.getByText("Paper size")).toHaveClass("sr-only");
  });

  it("opens from the keyboard, moves with arrows and selects with Enter", async () => {
    const user = userEvent.setup();
    render(<Fixture value="a0" />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Paper size" })).toHaveTextContent("A1");
    expect(screen.getByRole("combobox", { name: "Paper size" })).toHaveFocus();
  });

  it("jumps with typeahead when open", async () => {
    const user = userEvent.setup();
    render(<Fixture value="a0" />);
    await user.tab();
    await user.keyboard(" ");
    await screen.findByRole("listbox");
    await user.keyboard("b");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox", { name: "Paper size" })).toHaveTextContent("Banner");
  });

  it("skips disabled options", async () => {
    const user = userEvent.setup();
    render(<Fixture value="a1" />);
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("combobox", { name: "Paper size" })).toHaveTextContent("Banner");
  });

  it("uses a 28 px field in workspace layout and a 40 px field in admin layout", () => {
    const { unmount } = render(<Fixture />);
    expect(screen.getByRole("combobox").className).toContain("h-7");
    unmount();
    render(<Fixture layout="admin" />);
    expect(screen.getByRole("combobox").className).toContain("h-10");
  });

  it("shows an inline error and marks the trigger invalid", () => {
    render(<Fixture error="Pick a size" />);
    const trigger = screen.getByRole("combobox", { name: "Paper size" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("Pick a size");
  });
});
