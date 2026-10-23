// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DocumentTabs } from "./document-tabs";
import { tabsStore, viewerTabs, type DocumentTab } from "./viewer-tabs";

const tab = (id: string, over: Partial<DocumentTab> = {}): DocumentTab => ({
  id,
  fileName: `${id}-long-file-name.pdf`,
  title: id.toUpperCase(),
  status: "ready",
  failed: false,
  ...over,
});

let activate: ReturnType<typeof vi.spyOn>;
let close: ReturnType<typeof vi.spyOn>;
let cycle: ReturnType<typeof vi.spyOn>;

function setup(tabs: DocumentTab[], activeId: string | null = tabs[0]?.id ?? null) {
  tabsStore.setState({ tabs, activeId });
  render(
    <TooltipProvider delayDuration={0}>
      <DocumentTabs>
        <canvas data-testid="drawing-canvas" tabIndex={0} />
      </DocumentTabs>
    </TooltipProvider>,
  );
  return userEvent.setup();
}

const strip = () => screen.getByRole("tablist", { name: "Open drawings" });
const trigger = (name: RegExp | string) => within(strip()).getByRole("tab", { name });

beforeEach(() => {
  // The strip follows tabsStore; the manager's actions are observed, not run.
  activate = vi.spyOn(viewerTabs, "activate").mockImplementation((id: string) => {
    tabsStore.setState({ activeId: id });
  });
  close = vi.spyOn(viewerTabs, "close").mockImplementation(() => undefined);
  cycle = vi.spyOn(viewerTabs, "cycle").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  tabsStore.setState({ tabs: [], activeId: null });
});

describe("DocumentTabs", () => {
  it("without tabs shows only its panel content", () => {
    setup([]);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("drawing-canvas")).toBeInTheDocument();
  });

  it("names each tab by its title, marks the active one, and wraps the canvas in its panel", () => {
    setup([tab("a"), tab("b")], "b");
    expect(within(strip()).getAllByRole("tab").map((t) => t.textContent)).toEqual(["A", "B"]);
    expect(trigger("B")).toHaveAttribute("aria-selected", "true");
    expect(trigger("A")).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toContainElement(screen.getByTestId("drawing-canvas"));
    expect(panel).toHaveAttribute("tabindex", "-1");
  });

  it("shows the full file name in a tooltip", async () => {
    const user = setup([tab("a")]);
    await user.hover(trigger("A"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("a-long-file-name.pdf");
  });

  it("a loading tab has a thin progress bar; a failed one a quiet marker, both in its accessible name", () => {
    setup([tab("a", { status: "loading" }), tab("b", { status: "error", failed: true })]);
    expect(screen.getByRole("progressbar", { name: "Loading a-long-file-name.pdf" })).toBeInTheDocument();
    expect(trigger("A, loading")).toBeInTheDocument();
    expect(trigger("B, could not be opened")).toHaveAttribute("data-status", "error");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("a click or the arrow keys switch tabs", async () => {
    const user = setup([tab("a"), tab("b"), tab("c")]);
    await user.click(trigger("C"));
    expect(activate).toHaveBeenLastCalledWith("c");
    await user.keyboard("{ArrowLeft}");
    expect(activate).toHaveBeenLastCalledWith("b");
  });

  it("the close button, a middle click and Delete close a tab", async () => {
    const user = setup([tab("a"), tab("b")]);
    await user.click(screen.getByRole("button", { name: "Close b-long-file-name.pdf" }));
    expect(close).toHaveBeenLastCalledWith("b");
    const item = trigger("A").parentElement!;
    fireEvent.mouseDown(item, { button: 1 });
    fireEvent(item, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(close).toHaveBeenLastCalledWith("a");
    act(() => trigger("B").focus());
    await user.keyboard("{Delete}");
    expect(close).toHaveBeenLastCalledWith("b");
    // The close buttons are not tab stops (Delete and Ctrl+F4 are the keyboard way).
    expect(screen.getByRole("button", { name: "Close a-long-file-name.pdf" })).toHaveAttribute("tabindex", "-1");
  });

  it("Ctrl / Alt + PageDown / PageUp cycle and Ctrl+F4 closes, with the canvas or the strip focused only", async () => {
    const user = setup([tab("a"), tab("b")], "a");
    act(() => screen.getByTestId("drawing-canvas").focus());
    await user.keyboard("{Control>}{PageDown}{/Control}");
    expect(cycle).toHaveBeenLastCalledWith(1);
    await user.keyboard("{Alt>}{PageUp}{/Alt}");
    expect(cycle).toHaveBeenLastCalledWith(-1);
    await user.keyboard("{Control>}{F4}{/Control}");
    expect(close).toHaveBeenLastCalledWith("a");
    act(() => trigger("B").focus());
    await user.keyboard("{Control>}{F4}{/Control}");
    expect(close).toHaveBeenLastCalledWith("b");
    // Elsewhere (e.g. the page) the keys are not the tabs'.
    act(() => (document.activeElement as HTMLElement).blur());
    cycle.mockClear();
    fireEvent.keyDown(document.body, { key: "PageDown", ctrlKey: true });
    expect(cycle).not.toHaveBeenCalled();
  });
});
