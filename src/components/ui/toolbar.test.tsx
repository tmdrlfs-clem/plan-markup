// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Magnet, Redo2, Ruler, Undo2 } from "lucide-react";
import { describe, expect, it } from "vitest";

import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "./toolbar";

function Fixture() {
  return (
    <>
      <Toolbar aria-label="Main tools">
        <ToolbarButton label="Undo" icon={Undo2} />
        <ToolbarButton label="Redo" icon={Redo2} />
        <ToolbarSeparator />
        <ToolbarToggleGroup type="single" aria-label="Mode">
          <ToolbarToggleItem value="snap" label="Snap" icon={Magnet} />
          <ToolbarToggleItem value="ruler" label="Ruler" icon={Ruler} />
        </ToolbarToggleGroup>
      </Toolbar>
      <button>After toolbar</button>
    </>
  );
}

describe("Toolbar", () => {
  it("has the toolbar role and a required name", () => {
    render(<Fixture />);
    expect(screen.getByRole("toolbar", { name: "Main tools" })).toBeInTheDocument();
  });

  it("moves focus with arrow keys, wrapping around, with Home and End", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Redo" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Snap" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Ruler" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Ruler" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
  });

  it("leaves the toolbar with Tab", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "After toolbar" })).toHaveFocus();
  });
});
