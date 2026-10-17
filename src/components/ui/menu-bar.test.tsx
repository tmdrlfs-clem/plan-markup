// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  MenuBar,
  MenuBarContent,
  MenuBarItem,
  MenuBarMenu,
  MenuBarSeparator,
  MenuBarTrigger,
} from "./menu-bar";

function Fixture() {
  return (
    <MenuBar aria-label="Application">
      <MenuBarMenu>
        <MenuBarTrigger>File</MenuBarTrigger>
        <MenuBarContent>
          <MenuBarItem shortcut="Ctrl+O">Open</MenuBarItem>
          <MenuBarItem disabled>Save</MenuBarItem>
          <MenuBarSeparator />
          <MenuBarItem>Close</MenuBarItem>
        </MenuBarContent>
      </MenuBarMenu>
      <MenuBarMenu>
        <MenuBarTrigger>Edit</MenuBarTrigger>
        <MenuBarContent>
          <MenuBarItem>Undo</MenuBarItem>
        </MenuBarContent>
      </MenuBarMenu>
    </MenuBar>
  );
}

describe("MenuBar", () => {
  it("has the menubar role and a required name", () => {
    render(<Fixture />);
    expect(screen.getByRole("menubar", { name: "Application" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("opens with ArrowDown and shows items with aria-keyshortcuts", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    expect(screen.getByRole("menuitem", { name: "File" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("menuitem", { name: /Open/ })).toHaveAttribute("aria-keyshortcuts", "Control+O");
  });

  it("switches menus with Left and Right while open", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: /Open/ });
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menuitem", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Open/ })).not.toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(await screen.findByRole("menuitem", { name: /Open/ })).toBeInTheDocument();
  });

  it("skips disabled items and closes with Escape back to the trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: /Open/ });
    expect(screen.getByRole("menuitem", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "File" })).toHaveFocus();
  });
});
