// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AlertDialog } from "./alert-dialog";

function Fixture({ onAction = vi.fn(), destructive = true }: { onAction?: () => void; destructive?: boolean }) {
  return (
    <AlertDialog
      trigger={<button>Delete pages</button>}
      title="Delete pages"
      description="Delete 3 pages from L17 RCP?"
      actionLabel="Delete 3 pages"
      onAction={onAction}
      destructive={destructive}
    />
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete pages" }));
  return screen.findByRole("alertdialog");
}

describe("AlertDialog", () => {
  it("states the scope, orders Cancel left of the action and focuses Cancel first", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const dialog = await open(user);
    expect(dialog).toHaveAccessibleDescription("Delete 3 pages from L17 RCP?");
    const names = within(dialog).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Cancel", "Delete 3 pages"]);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("uses a danger-filled action when destructive and a primary one otherwise", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Fixture />);
    await open(user);
    expect(screen.getByRole("button", { name: "Delete 3 pages" })).toHaveAttribute("data-variant", "danger");
    unmount();
    render(<Fixture destructive={false} />);
    await open(user);
    expect(screen.getByRole("button", { name: "Delete 3 pages" })).toHaveAttribute("data-variant", "primary");
  });

  it("runs the action and closes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Fixture onAction={onAction} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Delete 3 pages" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Esc cancels without running the action and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Fixture onAction={onAction} />);
    await open(user);
    await user.keyboard("{Escape}");
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete pages" })).toHaveFocus();
  });

  it("Enter on Cancel cancels", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Fixture onAction={onAction} />);
    await open(user);
    await user.keyboard("{Enter}");
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Enter on the dialog body triggers the action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Fixture onAction={onAction} />);
    const dialog = await open(user);
    dialog.focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not close from an overlay click", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await open(user);
    await user.click(document.querySelector(".bg-black\\/50") as HTMLElement);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
