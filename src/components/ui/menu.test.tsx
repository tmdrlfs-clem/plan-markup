// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./menu";

function Fixture({ onCopy = vi.fn() }: { onCopy?: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button>Edit</button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Clipboard</MenuLabel>
        <MenuItem icon={Copy} shortcut="Ctrl+C" onSelect={onCopy}>
          Copy
        </MenuItem>
        <MenuItem disabled>Cut</MenuItem>
        <MenuItem shortcut="Del" destructive>
          Delete
        </MenuItem>
        <MenuSeparator />
        <MenuCheckboxItem checked>Show grid</MenuCheckboxItem>
        <MenuRadioGroup value="a">
          <MenuRadioItem value="a">Alpha</MenuRadioItem>
          <MenuRadioItem value="b">Beta</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSub>
          <MenuSubTrigger>More</MenuSubTrigger>
          <MenuSubContent>
            <MenuItem>Nested</MenuItem>
          </MenuSubContent>
        </MenuSub>
      </MenuContent>
    </Menu>
  );
}

describe("Menu", () => {
  it.each([["{Enter}"], [" "], ["{ArrowDown}"]])("opens from the trigger with %j", async (key) => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard(key);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("moves with arrows, skips disabled items and selects with Enter", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<Fixture onCopy={onCopy} />);
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes with Escape and refocuses the trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "Edit" });
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("sets aria-keyshortcuts and shows the shortcut", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{Enter}");
    const copy = await screen.findByRole("menuitem", { name: /Copy/ });
    expect(copy).toHaveAttribute("aria-keyshortcuts", "Control+C");
    expect(copy).toHaveTextContent("Ctrl+C");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveAttribute("aria-keyshortcuts", "Delete");
    expect(screen.getByRole("menuitem", { name: "Cut" })).toHaveAttribute("aria-disabled", "true");
  });

  it("exposes checkbox and radio items with their state", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitemcheckbox", { name: "Show grid" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Alpha" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Beta" })).toHaveAttribute("aria-checked", "false");
  });

  it("opens a submenu with ArrowRight and closes it with ArrowLeft", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.keyboard("{Enter}");
    const sub = await screen.findByRole("menuitem", { name: "More" });
    sub.focus();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("menuitem", { name: "Nested" })).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menuitem", { name: "Nested" })).not.toBeInTheDocument();
    expect(sub).toHaveFocus();
  });
});
