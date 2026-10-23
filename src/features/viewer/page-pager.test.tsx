// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { PagePager, currentSheetLabel, pageAnnouncement, resolvePageEntry } from "./page-pager";
import { registerViewerEngine } from "./viewer-commands";
import { viewerStore } from "./viewer-store";
import { resetViewer } from "./viewer-tabs";

function fakeEngine(pageCount: number) {
  const engine = {
    zoomStep: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    rotate: vi.fn(),
    // Like the real canvas: focus leaves the field (its blur must not commit the reverted draft).
    focusCanvas: vi.fn(() => (document.activeElement as HTMLElement | null)?.blur()),
    currentPage: 0,
    pageCount,
    goToPage: vi.fn((index: number) => {
      if (index < 0 || index >= pageCount) return;
      engine.currentPage = index;
      viewerStore.setState({ pageIndex: index });
    }),
  };
  return engine;
}

let unregister: () => void = () => undefined;

function setup(pageCount: number, extra: Partial<Parameters<typeof viewerStore.setState>[0]> = {}) {
  const engine = fakeEngine(pageCount);
  unregister = registerViewerEngine(engine);
  viewerStore.setState({ status: "ready", pageCount, pageIndex: 0, ...extra });
  render(
    <TooltipProvider>
      <PagePager />
    </TooltipProvider>,
  );
  return { engine, user: userEvent.setup() };
}

const input = () => screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => resetViewer());
afterEach(() => unregister());

describe("resolvePageEntry", () => {
  it("takes page numbers in range and labels (any case); anything else is null", () => {
    expect(resolvePageEntry("3", 12, null, {})).toBe(2);
    expect(resolvePageEntry(" 12 ", 12, null, {})).toBe(11);
    for (const bad of ["0", "13", "-1", "2.5", "abc", ""]) expect(resolvePageEntry(bad, 12, null, {})).toBeNull();
    const labels = ["1", "A1721 - LEVEL 17 RCP", "FP-201"];
    expect(resolvePageEntry("A1721", 3, labels, {})).toBe(1);
    expect(resolvePageEntry("A1721 - LEVEL 17 RCP", 3, labels, {})).toBe(1);
    expect(resolvePageEntry("FP-201", 3, labels, {})).toBe(2);
    expect(resolvePageEntry("fp-201", 3, labels, {})).toBe(2); // case-insensitive (founder decision)
    expect(resolvePageEntry("a1721", 3, labels, {})).toBe(1);
    expect(resolvePageEntry("FP-20", 3, labels, {})).toBeNull();
    expect(resolvePageEntry("S-101", 3, labels, { 0: "S-101" })).toBe(0);
  });
});

describe("currentSheetLabel / pageAnnouncement", () => {
  it("prefers the page label, then the detected number", () => {
    expect(currentSheetLabel({ pageIndex: 0, pageLabels: ["A1721 - LEVEL 17"], sheetLabels: { 0: "X" } })).toEqual({
      short: "A1721",
      full: "A1721 - LEVEL 17",
    });
    expect(currentSheetLabel({ pageIndex: 1, pageLabels: ["1", "2"], sheetLabels: { 1: "S-102" } })?.short).toBe("S-102");
    expect(currentSheetLabel({ pageIndex: 0, pageLabels: null, sheetLabels: {} })).toBeNull();
    expect(pageAnnouncement(2, 12, { short: "A1721", full: "A1721 - X" })).toBe("Page 3 of 12, A1721");
    expect(pageAnnouncement(0, 1, null)).toBe("Page 1 of 1");
  });
});

describe("PagePager", () => {
  it("is hidden without a drawing", () => {
    const { container } = render(<PagePager />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables every arrow on a single page", () => {
    setup(1);
    for (const name of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(button(name)).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("group", { name: "Pages" })).toHaveTextContent("/ 1");
  });

  it("first/previous are disabled on page 1, next/last on the last page; the arrows move", async () => {
    const { engine, user } = setup(4);
    expect(button("First page")).toHaveAttribute("aria-disabled", "true");
    expect(button("Next page")).not.toHaveAttribute("aria-disabled");
    await user.click(button("Next page"));
    expect(engine.goToPage).toHaveBeenLastCalledWith(1);
    expect(input().value).toBe("2");
    await user.click(button("Last page"));
    expect(input().value).toBe("4");
    expect(button("Next page")).toHaveAttribute("aria-disabled", "true");
    expect(button("Last page")).toHaveAttribute("aria-disabled", "true");
    await user.click(button("Previous page"));
    expect(input().value).toBe("3");
    await user.click(button("First page"));
    expect(input().value).toBe("1");
  });

  it("Enter commits a page number; an invalid entry reverts silently", async () => {
    const { engine, user } = setup(12);
    await user.click(input());
    await user.keyboard("7{Enter}");
    expect(engine.goToPage).toHaveBeenLastCalledWith(6);
    expect(input().value).toBe("7");
    for (const bad of ["13", "0", "abc"]) {
      await user.clear(input());
      await user.type(input(), `${bad}{Enter}`);
      expect(input().value).toBe("7");
    }
    expect(engine.goToPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaving the field commits; Escape reverts and returns to the canvas", async () => {
    const { engine, user } = setup(5);
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}3");
    await user.tab();
    expect(engine.goToPage).toHaveBeenLastCalledWith(2);
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}5{Escape}");
    expect(input().value).toBe("3");
    expect(engine.goToPage).toHaveBeenCalledTimes(1);
    expect(engine.focusCanvas).toHaveBeenCalledTimes(1);
  });

  it("a typed label navigates; the sheet label shows with the full label as tooltip", async () => {
    const { engine, user } = setup(3, { pageLabels: ["1", "A1721 - LEVEL 17 RCP", "3"], sheetLabels: { 0: "S-101" } });
    expect(screen.getByTestId("sheet-label")).toHaveTextContent("S-101");
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}A1721{Enter}");
    expect(engine.goToPage).toHaveBeenLastCalledWith(1);
    expect(screen.getByTestId("sheet-label")).toHaveTextContent(/^A1721$/);
    await user.hover(screen.getByTestId("sheet-label"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("A1721 - LEVEL 17 RCP");
    act(() => viewerStore.setState({ pageIndex: 2 }));
    expect(screen.queryByTestId("sheet-label")).not.toBeInTheDocument();
  });

  it("labels match in any case, and the field asks for a normal (not digits-only) keyboard", async () => {
    const { engine, user } = setup(3, { pageLabels: ["1", "A1721 - LEVEL 17 RCP", "3"] });
    expect(input()).not.toHaveAttribute("inputmode", "numeric");
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}a1721{Enter}");
    expect(engine.goToPage).toHaveBeenLastCalledWith(1);
  });
});
