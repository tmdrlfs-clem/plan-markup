// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Panel, type PanelSide } from "./panel";

function Fixture({ side = "left", initial = 300 }: { side?: PanelSide; initial?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const [size, setSize] = useState(initial);
  return (
    <Panel
      title="Layers"
      side={side}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      size={size}
      onSizeChange={setSize}
      minSize={220}
      maxSize={420}
      actions={<button>Add</button>}
    >
      <p>Panel body</p>
    </Panel>
  );
}

function handle() {
  return screen.getByRole("separator", { name: "Resize Layers" });
}

describe("Panel", () => {
  it("is a labelled section with a heading, actions and the body", () => {
    render(<Fixture />);
    expect(screen.getByRole("region", { name: "Layers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Layers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Layers" })).toHaveStyle({ width: "300px" });
  });

  it("collapses with the header button, toggling hidden and the label", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const body = screen.getByText("Panel body").parentElement as HTMLElement;
    const button = screen.getByRole("button", { name: "Collapse Layers" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", body.id);
    await user.click(button);
    expect(body).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Expand Layers" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Layers" }));
    expect(body).not.toHaveAttribute("hidden");
    expect(handle()).toBeInTheDocument();
  });

  it("exposes separator semantics", () => {
    render(<Fixture />);
    const sep = handle();
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "300");
    expect(sep).toHaveAttribute("aria-valuemin", "220");
    expect(sep).toHaveAttribute("aria-valuemax", "420");
    expect(sep).toHaveAttribute("tabindex", "0");
    expect(sep).toHaveAttribute("aria-controls", (screen.getByText("Panel body").parentElement as HTMLElement).id);
  });

  it("resizes with arrows (8 px), Shift (32 px), Home and End, within bounds", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    handle().focus();
    await user.keyboard("{ArrowRight}");
    expect(handle()).toHaveAttribute("aria-valuenow", "308");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(handle()).toHaveAttribute("aria-valuenow", "292");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(handle()).toHaveAttribute("aria-valuenow", "324");
    await user.keyboard("{Home}");
    expect(handle()).toHaveAttribute("aria-valuenow", "220");
    await user.keyboard("{ArrowLeft}");
    expect(handle()).toHaveAttribute("aria-valuenow", "220");
    await user.keyboard("{End}");
    expect(handle()).toHaveAttribute("aria-valuenow", "420");
    await user.keyboard("{ArrowRight}");
    expect(handle()).toHaveAttribute("aria-valuenow", "420");
    expect(screen.getByRole("region", { name: "Layers" })).toHaveStyle({ width: "420px" });
  });

  it("Enter on the handle toggles collapse", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    handle().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Panel body").parentElement).toHaveAttribute("hidden");
  });

  it("inverts the grow key for right panels and uses vertical keys for bottom panels", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Fixture side="right" />);
    handle().focus();
    await user.keyboard("{ArrowLeft}");
    expect(handle()).toHaveAttribute("aria-valuenow", "308");
    unmount();
    render(<Fixture side="bottom" initial={240} />);
    expect(handle()).toHaveAttribute("aria-orientation", "horizontal");
    handle().focus();
    await user.keyboard("{ArrowUp}");
    expect(handle()).toHaveAttribute("aria-valuenow", "248");
    expect(screen.getByRole("region", { name: "Layers" })).toHaveStyle({ height: "248px" });
  });

  it("resizes by pointer drag with capture and clamps to the bounds", () => {
    render(<Fixture />);
    const sep = handle();
    fireEvent.pointerDown(sep, { pointerId: 1, button: 0, clientX: 300 });
    expect(sep).toHaveAttribute("data-dragging", "true");
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 340 });
    expect(sep).toHaveAttribute("aria-valuenow", "340");
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 900 });
    expect(sep).toHaveAttribute("aria-valuenow", "420");
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(sep).toHaveAttribute("data-dragging", "false");
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 100 });
    expect(sep).toHaveAttribute("aria-valuenow", "420");
  });

  it("drags right panels in the opposite direction", () => {
    render(<Fixture side="right" />);
    const sep = handle();
    fireEvent.pointerDown(sep, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 460 });
    expect(sep).toHaveAttribute("aria-valuenow", "340");
  });
});
