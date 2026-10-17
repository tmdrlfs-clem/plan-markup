// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Collapsible } from "./collapsible";

describe("Collapsible", () => {
  it("toggles aria-expanded and content with Enter and Space", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Collapsible title="Properties" onOpenChange={onOpenChange}>
        <p>Body</p>
      </Collapsible>,
    );
    const header = screen.getByRole("button", { name: "Properties" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body")).toBeVisible();
    await user.keyboard(" ");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("can start open and renders actions outside the toggle", () => {
    render(
      <Collapsible title="Layers" defaultOpen actions={<button>Add layer</button>}>
        <p>Body</p>
      </Collapsible>,
    );
    expect(screen.getByRole("button", { name: "Layers" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Layers" })).not.toContainElement(
      screen.getByRole("button", { name: "Add layer" }),
    );
  });

  it("rotates the chevron without a transition under reduced motion", () => {
    render(
      <Collapsible title="Layers">
        <p>Body</p>
      </Collapsible>,
    );
    const svg = screen.getByRole("button", { name: "Layers" }).querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("group-data-[state=open]:rotate-90");
    expect(svg?.getAttribute("class")).toContain("motion-reduce:transition-none");
  });
});
