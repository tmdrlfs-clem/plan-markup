// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADVISORY_NOTICE } from "@/core/sprinkler/report";
import { Landing } from "./landing";

describe("Landing", () => {
  it("says what the product does and leads to sign-up and sign-in", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Head layouts in minutes.Not afternoons.",
    );
    const signUp = screen.getAllByRole("link", {
      name: /Create (your )?account/,
    });
    expect(signUp.length).toBeGreaterThanOrEqual(3);
    for (const a of signUp) expect(a).toHaveAttribute("href", "/sign-up");
    for (const a of screen.getAllByRole("link", { name: "Sign in" }))
      expect(a).toHaveAttribute("href", "/sign-in");
  });

  it("has one main landmark, a skip link to it and in-page section links", () => {
    const { container } = render(<Landing />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#content");
    expect(container.querySelector("#content")).not.toBeNull();
    for (const [name, id] of [
      ["How it works", "how"],
      ["Features", "features"],
      ["The 4541 engine", "engine"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        `#${id}`,
      );
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("carries the advisory notice and the trademark note", () => {
    render(<Landing />);
    expect(
      screen.getAllByText(ADVISORY_NOTICE, { exact: false }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/not affiliated with or endorsed by Bluebeam, Inc\./),
    ).toBeInTheDocument();
  });

  it("keeps decoration out of the accessibility tree and the pictures labelled", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".lp-embers")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByRole("img", {
        name: "A sprinkler head operating over a fire",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /aligned rows/ }),
    ).toBeInTheDocument();
  });
});
