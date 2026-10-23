// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HintBar } from "./hint-bar";
import { dismissHint, hintStore, showHint } from "./hint-store";
import { TooltipProvider } from "./tooltip";

function setup() {
  return render(
    <TooltipProvider>
      <HintBar />
    </TooltipProvider>,
  );
}

beforeEach(() => hintStore.setState({ hint: null }));

describe("HintBar", () => {
  it("renders nothing without a notice", () => {
    setup();
    expect(screen.queryByTestId("hint-bar")).not.toBeInTheDocument();
  });

  it("shows one notice at a time with icon, text, action and Dismiss", async () => {
    const user = userEvent.setup();
    setup();
    const onAction = vi.fn();
    act(() => showHint({ id: "a", variant: "info", text: "First" }));
    act(() => showHint({ id: "b", variant: "warning", text: "Second", action: { label: "Fix", onAction } }));
    const bar = screen.getByTestId("hint-bar");
    expect(bar).toHaveTextContent("Second");
    expect(bar).not.toHaveTextContent("First");
    expect(bar).toHaveAttribute("data-variant", "warning");
    expect(bar.querySelector("svg")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Fix" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("hint-bar")).not.toBeInTheDocument();
  });

  it("uses role alert for danger and status otherwise", () => {
    setup();
    act(() => showHint({ id: "d", variant: "danger", text: "Bad" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Bad");
    act(() => showHint({ id: "i", variant: "info", text: "Fyi" }));
    expect(screen.getByRole("status")).toHaveTextContent("Fyi");
  });

  it("dismissHint(id) only hides that notice", () => {
    showHint({ id: "a", variant: "info", text: "A" });
    dismissHint("b");
    expect(hintStore.getState().hint?.id).toBe("a");
    dismissHint("a");
    expect(hintStore.getState().hint).toBeNull();
  });

  it("reports a user's Dismiss through onDismiss, but not a dismissal by code", async () => {
    const user = userEvent.setup();
    setup();
    const onDismiss = vi.fn();
    act(() => showHint({ id: "a", variant: "info", text: "A", onDismiss }));
    act(() => dismissHint("a"));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => showHint({ id: "a", variant: "info", text: "A", onDismiss }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(hintStore.getState().hint).toBeNull();
  });
});
