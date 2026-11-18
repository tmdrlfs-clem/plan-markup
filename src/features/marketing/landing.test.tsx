// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADVISORY_NOTICE } from "@/core/sprinkler/report";
import { Landing } from "./landing";

describe("Landing", () => {
  it("says what the product does and leads to sign-in", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NZS 4541 head layouts, placed and checked for you.");
    const signIn = screen.getAllByRole("link", { name: "Sign in" });
    expect(signIn.length).toBeGreaterThanOrEqual(2);
    for (const a of signIn) expect(a).toHaveAttribute("href", "/sign-in");
  });

  it("has one main landmark, a skip link to it and in-page section links", () => {
    const { container } = render(<Landing />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#content");
    expect(container.querySelector("#content")).not.toBeNull();
    for (const [name, id] of [
      ["Layout engine", "engine"],
      ["Features", "features"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", `#${id}`);
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("shows the zone, the placed heads and the report, with labelled pictures", () => {
    render(<Landing />);
    expect(screen.getByRole("img", { name: /zone outlined on a plan, before any heads/ })).toBeInTheDocument();
    const placed = screen.getByRole("img", { name: /ten sprinkler heads placed/ });
    expect(placed.querySelectorAll(".lp-head")).toHaveLength(10);
    const report = screen.getByRole("table", { name: "Example zone report" });
    expect(within(report).getByRole("rowheader", { name: "Coverage" })).toBeInTheDocument();
    expect(within(report).getAllByText("OK")).toHaveLength(5);
  });

  it("lists the six things it does, in order", () => {
    render(<Landing />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Open and calibrate",
      "Zones and uses",
      "Automatic placement",
      "Live checks",
      "Measure and mark up",
      "Export and print",
    ]);
  });

  it("carries the advisory notice and the trademark note", () => {
    render(<Landing />);
    expect(screen.getByText(ADVISORY_NOTICE, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/not affiliated with or endorsed by Bluebeam, Inc\./)).toBeInTheDocument();
  });
});
