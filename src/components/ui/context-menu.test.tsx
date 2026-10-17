// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu";

function Fixture() {
  return (
    <ContextMenu>
      <ContextMenuTrigger aria-label="Sheet area">Right-click me</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem shortcut="Del">Delete</ContextMenuItem>
        <ContextMenuItem>Properties</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("ContextMenu", () => {
  it("opens on right-click and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    fireEvent.contextMenu(screen.getByText("Right-click me"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveAttribute("aria-keyshortcuts", "Delete");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with Shift+F10 on the focused trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    expect(screen.getByText("Right-click me")).toHaveFocus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with the ContextMenu key and moves with arrows", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{ContextMenu}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Properties" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveFocus();
  });
});
