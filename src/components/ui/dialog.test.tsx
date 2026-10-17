// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog, DialogFooter, DialogPrimary } from "./dialog";

function Fixture({ onSave = vi.fn(), saveDisabled = false }: { onSave?: () => void; saveDisabled?: boolean }) {
  return (
    <Dialog
      trigger={<button>Open settings</button>}
      title="Sheet settings"
      description="Change how this sheet is shown."
      footer={
        <DialogFooter
          secondary={<Button>Cancel</Button>}
          primary={
            <DialogPrimary onClick={onSave} disabled={saveDisabled}>
              Save
            </DialogPrimary>
          }
        />
      }
    >
      <label>
        Name
        <input defaultValue="L17" />
      </label>
      <label>
        Notes
        <textarea defaultValue="" />
      </label>
      <label>
        Skip
        <input data-enter-ignore defaultValue="" />
      </label>
    </Dialog>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  return screen.findByRole("dialog", { name: "Sheet settings" });
}

describe("Dialog", () => {
  it("is named by its title, described, and puts secondary left of primary", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const dialog = await open(user);
    expect(dialog).toHaveAccessibleDescription("Change how this sheet is shown.");
    const buttons = within(dialog).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(buttons.indexOf("Cancel")).toBeLessThan(buttons.indexOf("Save"));
  });

  it("focuses the first field on open", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await open(user);
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("focuses the primary when the body has no field", async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger={<button>Open</button>}
        title="Info"
        footer={<DialogFooter primary={<DialogPrimary>Done</DialogPrimary>} />}
      >
        Nothing to edit.
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("Enter in a text input triggers the primary action", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Fixture onSave={onSave} />);
    await open(user);
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Enter does nothing in a textarea or a data-enter-ignore field", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Fixture onSave={onSave} />);
    await open(user);
    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Skip"));
    await user.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Enter on the secondary button activates that button, not the primary", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Fixture onSave={onSave} />);
    await open(user);
    screen.getByRole("button", { name: "Cancel" }).focus();
    await user.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Enter does nothing when the primary is disabled", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Fixture onSave={onSave} saveDisabled />);
    await open(user);
    await user.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Esc closes and focus returns to the trigger", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toHaveFocus();
  });

  it("closes from the Close button and from an overlay click", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open(user);
    await user.click(document.querySelector(".bg-black\\/50") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps focus: Tab cycles inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const dialog = await open(user);
    const tabbables = within(dialog)
      .getAllByRole("button")
      .concat(within(dialog).getAllByRole("textbox"));
    for (let i = 0; i < tabbables.length + 2; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("returns focus to returnFocusRef when controlled without a trigger", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [isOpen, setIsOpen] = useState(false);
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={ref} onClick={() => setIsOpen(true)}>
            Launch
          </button>
          <Dialog
            open={isOpen}
            onOpenChange={setIsOpen}
            returnFocusRef={ref}
            title="Controlled"
            footer={<DialogFooter primary={<DialogPrimary>Done</DialogPrimary>} />}
          />
        </>
      );
    }
    render(<Controlled />);
    await user.click(screen.getByRole("button", { name: "Launch" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Launch" })).toHaveFocus();
  });
});
