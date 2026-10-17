// @vitest-environment jsdom
// Regression tests for the Story 1.7 code review findings.
import "@/test/radix-jsdom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Magnet, Ruler } from "lucide-react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./context-menu";
import { Dialog, DialogFooter, DialogPrimary } from "./dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu";
import { NumberField } from "./number-field";
import { Panel } from "./panel";
import { Popover } from "./popover";
import { resetToasts, toast, toastStore } from "./toast-store";
import { ToggleButton } from "./toggle-button";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

function LengthDialog({ onSave }: { onSave: (mm: number) => void }) {
  const [mm, setMm] = useState(4600);
  return (
    <Dialog
      trigger={<button>Open</button>}
      title="Spacing"
      footer={
        <DialogFooter
          secondary={<Button>Cancel</Button>}
          primary={<DialogPrimary onClick={() => onSave(mm)}>Save</DialogPrimary>}
        />
      }
    >
      <NumberField kind="length" label="Max spacing" unit="mm" value={mm} onValueChange={setMm} />
    </Dialog>
  );
}

describe("Dialog with a NumberField", () => {
  it("Enter commits the draft before the primary runs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<LengthDialog onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const field = await screen.findByRole("spinbutton", { name: "Max spacing" });
    await user.clear(field);
    await user.type(field, "5000{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(5000));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Enter with an invalid draft shows the error and does not submit", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<LengthDialog onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const field = await screen.findByRole("spinbutton", { name: "Max spacing" });
    await user.clear(field);
    await user.type(field, "abc{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onSave).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape reverts the draft and keeps the dialog open; a second Escape closes it", async () => {
    const user = userEvent.setup();
    render(<LengthDialog onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const field = await screen.findByRole("spinbutton", { name: "Max spacing" });
    await user.clear(field);
    await user.type(field, "99");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(field).toHaveValue("4600");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape with a draft keeps a Popover open", async () => {
    const user = userEvent.setup();
    function Fixture() {
      const [value, setValue] = useState<number | null>(10);
      return (
        <Popover trigger={<button>Opacity</button>} aria-label="Opacity">
          <NumberField label="Opacity" suffix="%" value={value} onValueChange={setValue} />
        </Popover>
      );
    }
    render(<Fixture />);
    await user.click(screen.getByRole("button", { name: "Opacity" }));
    const field = await screen.findByRole("spinbutton", { name: "Opacity" });
    await user.click(field);
    await user.type(field, "5");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Opacity" })).toBeInTheDocument();
    expect(field).toHaveValue("10");
  });
});

describe("Dialog initial focus", () => {
  it("skips disabled inputs and Radix hidden inputs, and focuses a Checkbox", async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger={<button>Open</button>}
        title="Options"
        footer={<DialogFooter primary={<DialogPrimary>Done</DialogPrimary>} />}
      >
        <form>
          <input aria-label="Locked" disabled defaultValue="x" />
          <Checkbox label="Show grid" />
          <input aria-label="Name" />
        </form>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("checkbox", { name: "Show grid" })).toHaveFocus();
  });
});

describe("toast merging", () => {
  beforeEach(() => resetToasts());

  it("never merges toasts that carry an action", () => {
    const undoA = vi.fn();
    const undoB = vi.fn();
    toast({ title: "Markup deleted", action: { label: "Undo", onAction: undoA } });
    toast({ title: "Markup deleted", action: { label: "Undo", onAction: undoB } });
    const { visible } = toastStore.getState();
    expect(visible).toHaveLength(2);
    expect(visible.map((t) => t.action?.onAction)).toEqual([undoA, undoB]);
    expect(visible.every((t) => t.count === 1)).toBe(true);
  });
});

describe("disabled toggles", () => {
  it("ToggleButton does not call onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ToggleButton label="Snap" icon={Magnet} disabled onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Snap" });
    await user.click(btn);
    btn.focus();
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ToggleGroupItem does not call onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ToggleGroup type="multiple" aria-label="Modes">
        <ToggleGroupItem value="snap" label="Snap" icon={Magnet} />
        <ToggleGroupItem value="ruler" label="Ruler" icon={Ruler} disabled onClick={onClick} />
      </ToggleGroup>,
    );
    await user.click(screen.getByRole("button", { name: "Ruler" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("destructive menu items", () => {
  it("carry the danger colour without a competing text colour", async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger asChild>
          <button>Edit</button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>Copy</MenuItem>
          <MenuItem destructive>Delete</MenuItem>
        </MenuContent>
      </Menu>,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const item = await screen.findByRole("menuitem", { name: "Delete" });
    const classes = item.className.split(/\s+/);
    expect(classes).toContain("text-danger");
    expect(classes).not.toContain("text-text");
  });
});

describe("Panel", () => {
  it("Enter on the handle collapses and moves focus to the expand button", async () => {
    const user = userEvent.setup();
    function Fixture() {
      const [collapsed, setCollapsed] = useState(false);
      const [size, setSize] = useState(300);
      return (
        <Panel
          title="Layers"
          side="left"
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          size={size}
          onSizeChange={setSize}
          minSize={220}
          maxSize={420}
        >
          <p>Body</p>
        </Panel>
      );
    }
    render(<Fixture />);
    screen.getByRole("separator", { name: "Resize Layers" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Layers" })).toHaveFocus();
  });
});

describe("ContextMenu key", () => {
  it("swallows the browser's own contextmenu that follows the synthetic one", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu>
        <ContextMenuTrigger aria-label="Sheet area">Sheet</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Properties</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    await user.tab();
    await user.keyboard("{ContextMenu}");
    await screen.findByRole("menu");
    const notCancelled = fireEvent.contextMenu(document.activeElement ?? document.body);
    expect(notCancelled).toBe(false);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });
});
