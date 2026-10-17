// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Grid3x3, Magnet, Ruler } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToggleButton } from "./toggle-button";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

describe("ToggleButton", () => {
  it("toggles with Space and Enter and reports aria-pressed", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<ToggleButton label="Snap" icon={Magnet} shortcut="S" onPressedChange={onPressedChange} />);
    const btn = screen.getByRole("button", { name: "Snap" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("aria-keyshortcuts", "S");
    await user.tab();
    await user.keyboard(" ");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(onPressedChange).toHaveBeenCalledTimes(2);
  });

  it("marks the pressed state with an accent fill and an inset bar, not colour alone", () => {
    render(<ToggleButton label="Snap" icon={Magnet} defaultPressed />);
    const cls = screen.getByRole("button", { name: "Snap" }).className;
    expect(cls).toContain("aria-pressed:bg-accent");
    expect(cls).toContain("aria-pressed:shadow-[inset_0_-2px_0_0_var(--accent-fg)]");
  });

  it("does not toggle while disabled but stays focusable", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<ToggleButton label="Snap" icon={Magnet} disabled onPressedChange={onPressedChange} />);
    const btn = screen.getByRole("button", { name: "Snap" });
    await user.tab();
    expect(btn).toHaveFocus();
    await user.click(btn);
    await user.keyboard(" ");
    expect(onPressedChange).not.toHaveBeenCalled();
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ToggleGroup", () => {
  function Single() {
    const [value, setValue] = useState("a");
    return (
      <ToggleGroup type="single" aria-label="Grid mode" value={value} onValueChange={(v) => v && setValue(v)}>
        <ToggleGroupItem value="a" label="Grid" icon={Grid3x3} />
        <ToggleGroupItem value="b" label="Ruler" icon={Ruler} />
        <ToggleGroupItem value="c" label="Snap" icon={Magnet} />
      </ToggleGroup>
    );
  }

  it("is a named group and roves focus with arrow keys", async () => {
    const user = userEvent.setup();
    render(<Single />);
    expect(screen.getByRole("radiogroup", { name: "Grid mode" })).toBeInTheDocument();
    await user.tab();
    const items = screen.getAllByRole("radio");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(items[2]).toHaveFocus();
  });

  it("keeps exactly one item pressed in single mode", async () => {
    const user = userEvent.setup();
    render(<Single />);
    const items = screen.getAllByRole("radio");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    await user.click(items[1]);
    expect(items[0]).toHaveAttribute("aria-checked", "false");
    expect(items[1]).toHaveAttribute("aria-checked", "true");
    expect(items.filter((i) => i.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("supports multiple mode with Space and Enter", async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="multiple" aria-label="Layers">
        <ToggleGroupItem value="a" label="Grid" icon={Grid3x3} />
        <ToggleGroupItem value="b" label="Ruler" icon={Ruler} />
      </ToggleGroup>,
    );
    await user.tab();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}{Enter}");
    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveAttribute("aria-pressed", "true");
    expect(items[1]).toHaveAttribute("aria-pressed", "true");
  });
});
