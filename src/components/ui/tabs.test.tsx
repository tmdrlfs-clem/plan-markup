// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Fixture() {
  return (
    <Tabs defaultValue="one">
      <TabsList aria-label="Panels">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
        <TabsTrigger value="three">Three</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Content one</TabsContent>
      <TabsContent value="two">Content two</TabsContent>
      <TabsContent value="three">Content three</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("has a named tablist and an active tab with an accent bottom border", () => {
    render(<Fixture />);
    expect(screen.getByRole("tablist", { name: "Panels" })).toBeInTheDocument();
    const one = screen.getByRole("tab", { name: "One" });
    expect(one).toHaveAttribute("aria-selected", "true");
    expect(one.className).toContain("data-[state=active]:border-accent");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Content one");
  });

  it("changes tab and panel with arrows, wrapping, Home and End", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Content two");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Content three");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Content one");
  });

  it("moves focus from the tablist into the panel with Tab", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });
});
