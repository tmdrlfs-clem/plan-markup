// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThumbnailsPanel, thumbnailName } from "./thumbnails-panel";
import { registerViewerEngine } from "./viewer-commands";
import type { ThumbnailBox, ThumbnailListener } from "./viewer-engine";
import { resetViewer, viewerStore, type ViewerState } from "./viewer-store";

const SHEET = { width: 1191, height: 842, rotate: 0 };

type Request = { index: number; box: ThumbnailBox; listener: ThumbnailListener; cancel: ReturnType<typeof vi.fn> };

function fakeEngine(pageCount: number) {
  const requests: Request[] = [];
  const engine = {
    zoomStep: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    rotate: vi.fn(),
    focusCanvas: vi.fn(),
    currentPage: 0,
    pageCount,
    goToPage: vi.fn((index: number) => {
      engine.currentPage = index;
      viewerStore.setState({ pageIndex: index });
    }),
    thumbnail: vi.fn((index: number, box: ThumbnailBox, listener: ThumbnailListener) => {
      const cancel = vi.fn();
      requests.push({ index, box, listener, cancel });
      return cancel;
    }),
    requestSheetLabel: vi.fn(),
  };
  return { engine, requests };
}

let unregister: () => void = () => undefined;

function setup(pageCount: number, extra: Partial<ViewerState> = {}) {
  const { engine, requests } = fakeEngine(pageCount);
  unregister = registerViewerEngine(engine);
  viewerStore.setState({
    status: "ready",
    pageCount,
    pageIndex: 0,
    pages: Array.from({ length: pageCount }, () => SHEET),
    documentId: "doc",
    ...extra,
  });
  render(<ThumbnailsPanel emptyText="No drawing open" />);
  return { engine, requests, user: userEvent.setup() };
}

const list = () => screen.getByRole("listbox", { name: "Page thumbnails" });
const option = (name: string) => screen.getByRole("option", { name });
const bmp = () => ({ width: 320, height: 226, close: vi.fn() }) as unknown as ImageBitmap;

beforeEach(() => resetViewer());
afterEach(() => unregister());

describe("ThumbnailsPanel", () => {
  it("shows the registry's empty text without a drawing (no spinner)", () => {
    render(<ThumbnailsPanel emptyText="No drawing open" />);
    expect(screen.getByText("No drawing open")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("lists the pages with their number and sheet label; the current page is marked", () => {
    setup(4, { pageLabels: ["1", "FP-201", "FP-202 - SPRINKLER LAYOUT", "4"], sheetLabels: { 0: "S-101" } });
    expect(within(list()).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
      "Page 1, S-101",
      "Page 2, FP-201",
      "Page 3, FP-202",
      "Page 4",
    ]);
    expect(option("Page 1, S-101")).toHaveAttribute("aria-current", "page");
    expect(option("Page 1, S-101")).toHaveAttribute("aria-selected", "true");
    expect(option("Page 2, FP-201")).not.toHaveAttribute("aria-current");
    expect(option("Page 2, FP-201")).toHaveTextContent("2FP-201");
    act(() => viewerStore.setState({ pageIndex: 2 }));
    expect(option("Page 3, FP-202")).toHaveAttribute("aria-current", "page");
    expect(thumbnailName(0, null)).toBe("Page 1");
  });

  it("asks the detected sheet number only for shown rows without a label", () => {
    const { engine } = setup(3, { pageLabels: ["1", "FP-201", "3"], sheetLabels: { 2: null } });
    expect(engine.requestSheetLabel.mock.calls).toEqual([[0]]);
  });

  it("requests a raster per shown row, at the device box of the width step; a pending row keeps its size", () => {
    const { requests } = setup(4);
    expect(requests.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    // jsdom has no layout: a 280 px list, a 256 px box, the 320 px step at DPR 1.
    expect(requests[0].box).toEqual({ width: 320, height: Math.round(320 * (842 / 1191)) });
    const row = option("Page 1");
    expect(row).toHaveAttribute("data-state", "pending");
    act(() => requests[0].listener({ bitmap: bmp() }));
    expect(row).toHaveAttribute("data-state", "ready");
  });

  it("a failed thumbnail shows a quiet glyph and still navigates", async () => {
    const { requests, engine, user } = setup(3);
    act(() => requests[1].listener({ error: true }));
    const row = option("Page 2");
    expect(row).toHaveAttribute("data-state", "failed");
    expect(within(row).getByTestId("thumbnail-failed")).toBeInTheDocument();
    await user.click(row);
    expect(engine.goToPage).toHaveBeenLastCalledWith(1);
  });

  it("is virtualised: far rows are not mounted, and scrolling cancels the rows that left the window", () => {
    const { requests } = setup(200);
    const mounted = within(list()).getAllByRole("option").length;
    expect(mounted).toBeLessThan(20);
    expect(requests).toHaveLength(mounted);
    const el = list();
    el.scrollTop = 150 * 215; // far down
    fireEvent.scroll(el);
    // Every row that left the window is cancelled; the current page's row stays (the list's anchor).
    const left = requests.slice(0, mounted).filter((r) => r.index !== 0);
    expect(left.every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
    expect(requests[0].cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "Page 2" })).not.toBeInTheDocument();
    expect(requests.at(-1)!.index).toBeGreaterThan(140);
  });

  it("click and Enter / Space navigate; arrows, Home / End and PageUp / PageDown move the focus (one tab stop)", async () => {
    const { engine, user } = setup(12);
    await user.click(option("Page 3"));
    expect(engine.goToPage).toHaveBeenLastCalledWith(2);
    expect(list()).toHaveFocus();
    const active = () => document.getElementById(list().getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label");
    expect(active()).toBe("Page 3");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe("Page 5");
    expect(engine.goToPage).toHaveBeenCalledTimes(1); // moving the focus does not navigate
    await user.keyboard("{Enter}");
    expect(engine.goToPage).toHaveBeenLastCalledWith(4);
    await user.keyboard("{Home}");
    expect(active()).toBe("Page 1");
    await user.keyboard("{End}");
    expect(active()).toBe("Page 12");
    await user.keyboard("{PageUp}");
    expect(Number(active()?.split(" ")[1])).toBeLessThan(12);
    await user.keyboard("{ArrowUp}{ }");
    expect(engine.goToPage).toHaveBeenCalledTimes(3);
    // One tab stop: Tab leaves the list.
    await user.tab();
    expect(list()).not.toHaveFocus();
  });

  it("keeps the current page in view when it changes from elsewhere (pager, keys)", () => {
    setup(200);
    const el = list();
    act(() => viewerStore.setState({ pageIndex: 120 }));
    expect(el.scrollTop).toBeGreaterThan(0);
    fireEvent.scroll(el);
    expect(option("Page 120")).toBeInTheDocument();
    expect(option("Page 121")).toHaveAttribute("aria-current", "page");
  });

  it("drops its rasters' requests when unmounted, and starts over for a new document", () => {
    const { requests } = setup(3);
    act(() => viewerStore.setState({ documentId: "other", pages: [SHEET], pageCount: 1 }));
    expect(requests.slice(0, 3).every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
    expect(requests.at(-1)!.index).toBe(0);
    expect(within(list()).getAllByRole("option")).toHaveLength(1);
  });
});
