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
/** The close buttons are hidden from the accessibility tree (mouse-only): found by their label. */
const closeButton = (fileName: string) => screen.getAllByTestId("close-tab").find((b) => b.getAttribute("aria-label") === `Close ${fileName}`)!;

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
    expect(trigger("A, loading")).toBeInTheDocument();
    expect(trigger("B, could not be opened")).toHaveAttribute("data-status", "error");
    // The bar is a visual only: the tablist owns tabs and nothing else in the accessibility tree.
    expect(screen.getAllByTestId("tab-progress")).toHaveLength(1);
    expect(screen.getByTestId("tab-progress")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(strip()).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip()).getAllByRole("tab")).toHaveLength(2);
  });

  it("names a tab by its file name (founder decision), truncated, with the tab keys for assistive technology", () => {
    setup([tab("a", { title: "a-long-file-name.pdf" })]);
    const a = trigger("a-long-file-name.pdf");
    expect(a.querySelector(".truncate")).toHaveTextContent("a-long-file-name.pdf");
    expect(a).toHaveAttribute("aria-keyshortcuts", "Alt+PageDown Alt+PageUp Alt+W Delete");
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
    await user.click(closeButton("b-long-file-name.pdf"));
    expect(close).toHaveBeenLastCalledWith("b");
    const item = trigger("A").parentElement!;
    fireEvent.mouseDown(item, { button: 1 });
    fireEvent(item, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(close).toHaveBeenLastCalledWith("a");
    act(() => trigger("B").focus());
    await user.keyboard("{Delete}");
    expect(close).toHaveBeenLastCalledWith("b");
    // The close buttons are mouse-only (Delete and Alt+W are the keyboard way): no tab stop, hidden from the tree.
    const closeA = closeButton("a-long-file-name.pdf");
    expect(closeA).toHaveAttribute("tabindex", "-1");
    expect(closeA).toHaveAttribute("aria-hidden", "true");
  });

  it("Alt+PageDown / Alt+PageUp cycle and Alt+W closes (the Ctrl keys too), with the canvas, the strip or nothing focused", async () => {
    const user = setup([tab("a"), tab("b")], "a");
    act(() => screen.getByTestId("drawing-canvas").focus());
    await user.keyboard("{Alt>}{PageDown}{/Alt}");
    expect(cycle).toHaveBeenLastCalledWith(1);
    await user.keyboard("{Alt>}{PageUp}{/Alt}");
    expect(cycle).toHaveBeenLastCalledWith(-1);
    await user.keyboard("{Control>}{PageDown}{/Control}");
    expect(cycle).toHaveBeenLastCalledWith(1);
    await user.keyboard("{Alt>}w{/Alt}");
    expect(close).toHaveBeenLastCalledWith("a");
    await user.keyboard("{Control>}{F4}{/Control}");
    expect(close).toHaveBeenCalledTimes(2);
    act(() => trigger("B").focus());
    await user.keyboard("{Alt>}w{/Alt}");
    expect(close).toHaveBeenLastCalledWith("b");
    // Nothing focused (the page): the keys still act.
    act(() => (document.activeElement as HTMLElement).blur());
    cycle.mockClear();
    fireEvent.keyDown(document.body, { key: "PageDown", altKey: true });
    expect(cycle).toHaveBeenCalledWith(1);
    // In another control (a field, a panel) they are not the tabs'.
    const field = document.createElement("input");
    document.body.append(field);
    cycle.mockClear();
    close.mockClear();
    fireEvent.keyDown(field, { key: "PageDown", altKey: true });
    fireEvent.keyDown(field, { key: "w", code: "KeyW", altKey: true });
    expect(cycle).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    field.remove();
  });

  it("the active tab's close button shows Alt+W; closing the last tab moves the focus to the canvas region", async () => {
    close.mockImplementation(() => tabsStore.setState({ tabs: [], activeId: null }));
    const region = document.createElement("main");
    region.dataset.region = "canvas";
    region.tabIndex = -1;
    document.body.append(region);
    const user = setup([tab("a")]);
    const button = closeButton("a-long-file-name.pdf");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Alt+W Control+F4");
    act(() => trigger("A").focus());
    await user.keyboard("{Delete}");
    expect(close).toHaveBeenCalledWith("a");
    expect(document.activeElement).toBe(region);
    region.remove();
  });

  it("scrolls the active tab into view when it changes", () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.querySelector("[data-tab-id]")?.getAttribute("data-tab-id") ?? "");
    };
    try {
      setup([tab("a"), tab("b"), tab("c")], "a");
      act(() => tabsStore.setState({ activeId: "c" }));
      expect(scrolled.at(-1)).toBe("c");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});