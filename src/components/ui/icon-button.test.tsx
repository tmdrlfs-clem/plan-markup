// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Undo2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./icon-button";
import { TooltipProvider } from "./tooltip";

describe("IconButton", () => {
  it("is named by its label and exposes aria-keyshortcuts", () => {
    render(<IconButton label="Undo" icon={Undo2} shortcut="Ctrl+Z" />);
    const btn = screen.getByRole("button", { name: "Undo" });
    expect(btn).toHaveAttribute("aria-keyshortcuts", "Control+Z");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.className).toContain("focus-ring");
    expect(btn.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("uses 28 px for sm and 32 px for md", () => {
    render(
      <>
        <IconButton label="Small" icon={Undo2} size="sm" />
        <IconButton label="Medium" icon={Undo2} size="md" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Small" }).className).toContain("h-7");
    expect(screen.getByRole("button", { name: "Medium" }).className).toContain("h-8");
  });

  it("shows the label and shortcut in a tooltip on hover", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Undo" icon={Undo2} shortcut="Ctrl+Z" />
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole("button", { name: "Undo" }));
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Undo");
    expect(tip).toHaveTextContent("Ctrl+Z");
  });

  it("shows the tooltip on keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Undo" icon={Undo2} />
      </TooltipProvider>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Undo");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<IconButton label="Undo" icon={Undo2} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays focusable when disabled, explains why, and swallows clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Undo" icon={Undo2} disabled disabledReason="Nothing to undo" onClick={onClick} />
      </TooltipProvider>,
    );
    const btn = screen.getByRole("button", { name: "Undo" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    await user.tab();
    expect(btn).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Nothing to undo");
    await user.click(btn);
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
  });
});
