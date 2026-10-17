// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Popover } from "./popover";

describe("Popover", () => {
  it("opens on Enter, closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<button>Colour</button>} aria-label="Colour picker">
        <button>Red</button>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Colour" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Colour picker" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens with Space and moves focus into the content", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<button>Colour</button>}>
        <button>Red</button>
      </Popover>,
    );
    await user.tab();
    await user.keyboard(" ");
    expect(await screen.findByRole("button", { name: "Red" })).toHaveFocus();
  });
});
