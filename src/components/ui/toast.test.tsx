// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "./toast";
import { resetToasts, toast } from "./toast-store";

function setup() {
  const user = userEvent.setup({ delay: null });
  render(<Toaster />);
  return user;
}

function push(...args: Parameters<typeof toast>) {
  act(() => {
    toast(...args);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Testing Library only advances fake timers for its async helpers when a global
    // `jest` exists; without it user-event hangs on vitest fake timers.
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });
  afterEach(() => {
    act(() => resetToasts());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is a bottom-right region named with its hotkey", () => {
    setup();
    const region = screen.getByRole("region", { name: "Notifications (F8)" });
    const list = region.querySelector("ol");
    expect(list?.className).toContain("bottom-4");
    expect(list?.className).toContain("right-4");
    expect(list?.className).toContain("z-toast");
  });

  it("auto-dismisses after 4 s", () => {
    setup();
    push({ title: "Saved" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    advance(3900);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    advance(200);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("pauses while hovered and resumes after", async () => {
    const user = setup();
    push({ title: "Saved" });
    advance(2000);
    await user.hover(screen.getByText("Saved"));
    advance(10_000);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await user.unhover(screen.getByText("Saved"));
    advance(5000);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("pauses while focus is inside", () => {
    setup();
    push({ title: "Saved" });
    advance(1000);
    act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
    advance(10_000);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows at most 3 and brings queued ones in as others close", async () => {
    const user = setup();
    for (const title of ["A", "B", "C", "D"]) push({ title });
    expect(screen.queryByText("D")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("merges identical toasts with a count and restarts the timer", () => {
    setup();
    push({ title: "Saved", variant: "success" });
    advance(3000);
    push({ title: "Saved", variant: "success" });
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    expect(screen.getByLabelText("2 times")).toHaveTextContent("×2");
    advance(3000);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    advance(1100);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("runs the action once and dismisses the toast", async () => {
    const user = setup();
    const onAction = vi.fn();
    push({ title: "Deleted 2 pages", action: { label: "Undo", onAction } });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Deleted 2 pages")).not.toBeInTheDocument();
  });

  it("moves focus to the toast region with F8", async () => {
    setup();
    push({ title: "Saved" });
    // Radix matches the hotkey on event.code, which user-event does not set for F-keys.
    fireEvent.keyDown(document, { key: "F8", code: "F8" });
    // Radix focuses the toast list inside the labelled region, not the region wrapper.
    const region = screen.getByRole("region", { name: "Notifications (F8)" });
    expect(within(region).getByRole("list")).toHaveFocus();
  });

  it.each([
    ["success", "lucide-circle-check", "text-success"],
    ["warning", "lucide-triangle-alert", "text-warning-text"],
    ["danger", "lucide-circle-x", "text-danger"],
    ["info", "lucide-info", "text-info"],
  ] as const)("the %s variant has an icon and text, never the accent colour", (variant, iconClass, textClass) => {
    setup();
    push({ title: "Status", description: "Details", variant });
    const root = screen.getByText("Status").closest("[data-variant]") as HTMLElement;
    const icon = root.querySelector(`svg.${iconClass}`);
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass(textClass);
    expect(root.className).not.toContain("accent");
    expect(root.innerHTML).not.toMatch(/(?:text|bg|border)-accent/);
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("neutral toasts have no status icon", () => {
    setup();
    push({ title: "Plain" });
    const root = screen.getByText("Plain").closest("[data-variant]") as HTMLElement;
    expect(root.querySelector("svg.lucide-circle-check, svg.lucide-info, svg.lucide-circle-x, svg.lucide-triangle-alert")).toBeNull();
  });
});
