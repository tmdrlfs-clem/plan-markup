// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmptyWorkspace } from "./empty-workspace";

describe("EmptyWorkspace recent list (Story 6.6)", () => {
  it("lists recent drawings with their detail; choosing one opens it", async () => {
    const onOpenRecent = vi.fn();
    render(
      <EmptyWorkspace
        onOpen={vi.fn()}
        onOpenFiles={vi.fn()}
        recent={[
          { id: "a", name: "L17 RCP.pdf", detail: "12 pages · 7 Nov 2026" },
          { id: "b", name: "L16.pdf" },
        ]}
        onOpenRecent={onOpenRecent}
      />,
    );
    const items = screen.getAllByTestId("recent-drawing");
    expect(items.map((i) => i.textContent)).toEqual(["L17 RCP.pdf12 pages · 7 Nov 2026", "L16.pdf"]);
    await userEvent.click(items[1]);
    expect(onOpenRecent).toHaveBeenCalledWith("b");
  });

  it("says so when there are none", () => {
    render(<EmptyWorkspace onOpen={vi.fn()} onOpenFiles={vi.fn()} recent={[]} />);
    expect(screen.getByText("No recent drawings")).toBeTruthy();
  });
});
