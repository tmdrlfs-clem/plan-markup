// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ruler } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { StatusBarItem, type StatusTone } from "./status-bar-item";

describe("StatusBarItem", () => {
  it("renders a span when there is no action", () => {
    render(<StatusBarItem label="Scale 1:100" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Scale 1:100").closest("span[data-tone]")).toHaveClass("h-6", "text-ws-xs", "num");
  });

  it("renders a keyboard-operable button when actionable", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<StatusBarItem label="Zoom 100%" icon={Ruler} onClick={onClick} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Zoom 100%" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each<[Exclude<StatusTone, "default">, string, string]>([
    ["success", "lucide-circle-check", "text-success"],
    ["warning", "lucide-triangle-alert", "text-warning-text"],
    ["danger", "lucide-circle-x", "text-danger"],
    ["info", "lucide-info", "text-info"],
  ])("always shows an icon for the %s tone", (tone, iconClass, textClass) => {
    render(<StatusBarItem label="Status" tone={tone} />);
    const item = screen.getByText("Status").closest("[data-tone]");
    expect(item).toHaveClass(textClass);
    expect(item?.querySelector(`svg.${iconClass}`)).toBeInTheDocument();
  });

  it("shows no icon for the default tone unless one is given", () => {
    render(<StatusBarItem label="Plain" />);
    expect(screen.getByText("Plain").closest("[data-tone]")?.querySelector("svg")).toBeNull();
  });

  it("shows its tooltip on hover", async () => {
    const user = userEvent.setup();
    render(<StatusBarItem label="Zoom 100%" onClick={() => {}} tooltip="Set zoom" />);
    await user.hover(screen.getByRole("button"));
    expect(await screen.findByRole("tooltip", {}, { timeout: 2000 })).toHaveTextContent("Set zoom");
  });

  it("forwards a ref and extra props; asButton makes a button for a menu trigger; iconOnly keeps the label for assistive technology (Story 3.7)", () => {
    const ref = { current: null as HTMLElement | null };
    const { rerender } = render(<StatusBarItem ref={ref} label="106%" asButton data-testid="zoom" aria-haspopup="menu" />);
    const button = screen.getByRole("button", { name: "106%" });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute("data-testid", "zoom");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    rerender(<StatusBarItem label="A1 841 × 594 mm" icon={Ruler} iconOnly />);
    expect(screen.getByText("A1 841 × 594 mm")).toHaveClass("sr-only");
  });
});
