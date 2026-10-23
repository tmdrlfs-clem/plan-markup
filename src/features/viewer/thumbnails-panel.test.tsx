// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OVERSCAN_DELAY_MS, ThumbnailsPanel, paint, thumbnailName } from "./thumbnails-panel";
import { registerViewerEngine } from "./viewer-commands";
import type { ThumbnailBox, ThumbnailListener } from "./viewer-engine";
import { resetViewer, viewerStore, type ViewerState } from "./viewer-store";

const SHEET = { width: 1191, height: 842, rotate: 0 };

type Request = { index: number; box: ThumbnailBox; listener: ThumbnailListener; cancel: ReturnType<typeof vi.fn> };
type LabelLookup = { index: number; release: ReturnType<typeof vi.fn> };

function fakeEngine(pageCount: number) {
  const requests: Request[] = [];
  const labels: LabelLookup[] = [];
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
    sheetLabel: vi.fn((index: number) => {
      const release = vi.fn();
      labels.push({ index, release });
      return release;
    }),
  };
  return { engine, requests, labels };
}

let unregister: () => void = () => undefined;

/** Lets every mounted row ask (visible rows at once, overscan rows after OVERSCAN_DELAY_MS). */
const arm = () => act(() => vi.advanceTimersByTime(OVERSCAN_DELAY_MS));

function setup(pageCount: number, extra: Partial<ViewerState> = {}, { armed = true } = {}) {
  const { engine, requests, labels } = fakeEngine(pageCount);
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
  if (armed) arm();
  return { engine, requests, labels, user: userEvent.setup({ delay: null }) };
}

const list = () => screen.getByRole("listbox", { name: "Page thumbnails" });
const option = (name: string) => screen.getByRole("option", { name });
const bmp = () => ({ width: 320, height: 226, close: vi.fn() }) as unknown as ImageBitmap;

beforeEach(() => {
  // shouldAdvanceTime: user-event's async wrapper waits on a real setTimeout.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetViewer();
});
afterEach(() => {
  unregister();
  vi.useRealTimers();
});

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

  it("asks the detected sheet number only for shown rows without a label, and releases it when the row goes", () => {
    const { engine, labels } = setup(3, { pageLabels: ["1", "FP-201", "3"], sheetLabels: { 2: null } });
    expect(engine.sheetLabel.mock.calls).toEqual([[0]]);
    act(() => viewerStore.setState({ sheetLabels: { 0: "S-101", 2: null } }));
    expect(labels[0].release).toHaveBeenCalledTimes(1);
  });

  it("visible rows ask first; overscan rows only after a delay, and not at all when they leave before it", () => {
    const { requests } = setup(200, {}, { armed: false });
    expect(requests).toHaveLength(0); // from a macrotask, never during the render
    act(() => vi.advanceTimersByTime(0));
    // jsdom: a 600 px list of 215 px rows, so rows 0-2 are on screen.
    expect(requests.map((r) => r.index)).toEqual([0, 1, 2]);
    // A fling: the overscan rows below leave before their delay, so they never ask.
    const el = list();
    el.scrollTop = 100 * 215;
    fireEvent.scroll(el);
    act(() => vi.advanceTimersByTime(0));
    const visibleNow = requests.slice(3).map((r) => r.index);
    expect(visibleNow).toEqual([100, 101, 102]);
    arm();
    expect(requests.slice(6).every((r) => r.index !== 3 && r.index !== 4 && r.index !== 5)).toBe(true);
    expect(requests.length).toBeGreaterThan(6);
  });

  it("opening on a page far down asks only for the rows around it", () => {
    const { requests } = setup(200, { pageIndex: 150 });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.index >= 140)).toBe(true);
    expect(option("Page 151")).toHaveAttribute("aria-current", "page");
  });

  it("names its position in the whole set (virtualised listbox)", () => {
    setup(60);
    expect(option("Page 2")).toHaveAttribute("aria-setsize", "60");
    expect(option("Page 2")).toHaveAttribute("aria-posinset", "2");
  });

  it("asks again when the held raster was evicted (closed) before a redraw", () => {
    const { requests } = setup(1);
    const closed = { width: 0, height: 0, close: vi.fn() } as unknown as ImageBitmap;
    act(() => requests[0].listener({ bitmap: closed }));
    act(() => vi.advanceTimersByTime(0));
    expect(requests).toHaveLength(2);
    expect(option("Page 1")).toHaveAttribute("data-state", "pending");
    act(() => requests[1].listener({ bitmap: bmp() }));
    expect(option("Page 1")).toHaveAttribute("data-state", "ready");
    expect(paint(null, closed)).toBe(false);
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
    arm();
    // Every row that left the window is cancelled; the current page's row stays (the list's anchor).
    const left = requests.slice(0, mounted).filter((r) => r.index !== 0);
    expect(left.every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
    expect(requests[0].cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "Page 2" })).not.toBeInTheDocument();
    expect(requests.at(-1)!.index).toBeGreaterThan(140);
  });

  it("click and Enter / Space navigate and hand the focus to the canvas; arrows, Home / End and PageUp / PageDown move the focus (one tab stop)", async () => {
    const { engine, user } = setup(12);
    await user.click(option("Page 3"));
    expect(engine.goToPage).toHaveBeenLastCalledWith(2);
    expect(engine.focusCanvas).toHaveBeenCalledTimes(1);
    const active = () => document.getElementById(list().getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label");
    expect(active()).toBe("Page 3");
    // The fake engine's focusCanvas moves nothing: the list keeps the focus here.
    act(() => list().focus());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe("Page 5");
    expect(engine.goToPage).toHaveBeenCalledTimes(1); // moving the focus does not navigate
    await user.keyboard("{Enter}");
    expect(engine.goToPage).toHaveBeenLastCalledWith(4);
    expect(engine.focusCanvas).toHaveBeenCalledTimes(2);
    // Enter on the current page's thumbnail only moves the focus.
    await user.keyboard("{Enter}");
    expect(engine.goToPage).toHaveBeenCalledTimes(2);
    expect(engine.focusCanvas).toHaveBeenCalledTimes(3);
    await user.keyboard("{Home}");
    expect(active()).toBe("Page 1");
    await user.keyboard("{End}");
    expect(active()).toBe("Page 12");
    await user.keyboard("{PageUp}");
    expect(Number(active()?.split(" ")[1])).toBeLessThan(12);
    await user.keyboard("{ArrowUp}{ }");
    expect(engine.goToPage).toHaveBeenCalledTimes(3);
    expect(engine.focusCanvas).toHaveBeenCalledTimes(4);
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
    arm();
    expect(requests.slice(0, 3).every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
    expect(requests.at(-1)!.index).toBe(0);
    expect(within(list()).getAllByRole("option")).toHaveLength(1);
  });
});
