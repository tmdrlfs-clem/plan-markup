// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, type ButtonVariant } from "./button";

describe("Button", () => {
  it.each<ButtonVariant>(["primary", "secondary", "ghost", "destructive", "danger"])(
    "renders the %s variant",
    (variant) => {
      render(<Button variant={variant}>Go</Button>);
      const btn = screen.getByRole("button", { name: "Go" });
      expect(btn).toHaveAttribute("data-variant", variant);
      expect(btn.className).toContain("rounded");
      expect(btn.className).toContain("focus-ring");
    },
  );

  it("defaults to a secondary type=button", () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("uses 28 px for sm and 40 px for md", () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </>,
    );
    expect(screen.getByText("Small").className).toContain("h-7");
    expect(screen.getByText("Medium").className).toContain("h-10");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire when disabled but stays in the document", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    const btn = screen.getByRole("button");
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn).toBeDisabled();
    expect(btn).toBeVisible();
  });

  it("is reachable by Tab", async () => {
    render(<Button>Go</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
  });
});
