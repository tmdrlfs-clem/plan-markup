// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { buildPageText, type TextItem } from "@/core/search/page-text";
import type { TextResult } from "@/workers/render-protocol";

import { DocumentSearch, type SearchHost } from "./document-search";
import { SearchPanel, hitDescription, hitPlace, resultRows, searchStatus } from "./search-panel";
import { requestSearchFocus, searchUi } from "./search-ui";
import { activeSearch, viewerCommands } from "./viewer-commands";
import { INITIAL_VIEWER_STATE, viewerStore } from "./viewer-store";

function item(str: string, x: number, y: number): TextItem {
  const width = str.length * 6;
  return { str, x, y, width, fontSize: 10, quad: [x, y + 2, x + width, y + 2, x + width, y - 8, x, y - 8], eol: false };
}
const text = (items: TextItem[]): TextResult => ({ items, index: buildPageText(items) });

let pages: TextResult[];
let revealed: number[];

function makeSearch(pageCount: number) {
  const host: SearchHost = {
    pageCount,
    currentPage: 0,
    requestText: (page) => ({ promise: Promise.resolve(pages[page]), cancel: () => undefined }),
    revealHit: (page) => revealed.push(page),
    changed: () => undefined,
    highlightsAllowed: () => searchUi.getState().panelOpen,
  };
  const search = new DocumentSearch(host);
  search.reset(pageCount);
  activeSearch.setState({ search });
  return search;
}

/** Lets the debounce and the matching slices run (real timers). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 220));
  });
}

function setup(pageCount = 3) {
  const search = makeSearch(pageCount);
  const size = { width: 600, height: 400, rotate: 0 };
  viewerStore.setState({
    ...INITIAL_VIEWER_STATE,
    status: "ready",
    fileName: "a.pdf",
    pageCount,
    pages: Array.from({ length: pageCount }, () => size),
    pageLabels: ["S-101", "S-102", "S-103"],
  });
  render(
    <TooltipProvider delayDuration={0}>
      <SearchPanel emptyText="No drawing open" />
    </TooltipProvider>,
  );
  return { search, user: userEvent.setup() };
}

const field = () => screen.getByRole("textbox", { name: "Find" });
const status = () => screen.getByTestId("search-status");

beforeEach(() => {
  revealed = [];
  pages = [
    text([item("CH +2700", 10, 100), item("ROOM 1", 10, 130)]),
    text([]),
    text([item("ch +2700 again", 10, 100)]),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
  activeSearch.setState({ search: null });
  viewerStore.setState(INITIAL_VIEWER_STATE, true);
});

describe("SearchPanel", () => {
  it("without a drawing shows the empty text; open, the panel lets highlights show", () => {
    render(<SearchPanel emptyText="No drawing open" />);
    expect(screen.getByText("No drawing open")).toBeInTheDocument();
    expect(searchUi.getState().panelOpen).toBe(true);
  });

  it("typing searches all pages: count, results grouped by page with sheet labels, the no-text summary", async () => {
    const { user } = setup();
    expect(status()).toHaveTextContent("Type to find text on the drawing.");
    await user.type(field(), "ch +2700");
    await settle();
    expect(status()).toHaveTextContent("2 results on 2 pages");
    const list = screen.getByRole("listbox", { name: "Search results" });
    expect(within(list).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
      "Page 1 · S-101: CH +2700, near ROOM 1",
      "Page 3 · S-103: ch +2700",
    ]);
    // Rows tell hits apart by the text near them and where they sit on the sheet (review R5).
    expect(screen.getAllByTestId("search-hit-context").map((e) => e.textContent)).toEqual([" · ROOM 1"]);
    expect(screen.getAllByTestId("search-hit-place")).toHaveLength(2);
    expect(screen.getByTestId("search-no-text")).toHaveTextContent("1 page has no searchable text");
  });

  it("Enter / Shift+Enter move to next / previous with a quiet 'Search wrapped'; Esc hides the highlights and returns to the canvas", async () => {
    const focusCanvas = vi.spyOn(viewerCommands, "focusCanvas").mockImplementation(() => undefined);
    const { search, user } = setup();
    await user.type(field(), "+2700");
    await settle();
    await user.keyboard("{Enter}");
    expect(revealed).toEqual([0]);
    expect(screen.getAllByTestId("search-hit")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(revealed).toEqual([0, 2, 0]);
    expect(status()).toHaveTextContent("Search wrapped");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(revealed.at(-1)).toBe(2);
    await user.keyboard("{Escape}");
    expect(search.store.getState().visible).toBe(false);
    expect(focusCanvas).toHaveBeenCalled();
  });

  it("Match case and Whole word toggle the options; previous / next buttons step", async () => {
    const { search, user } = setup();
    await user.type(field(), "CH");
    await settle();
    expect(search.store.getState().hits).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Match case" }));
    await settle();
    expect(search.store.getState()).toMatchObject({ matchCase: true });
    expect(search.store.getState().hits).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Whole word" }));
    await settle();
    expect(search.store.getState().wholeWord).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next result" }));
    expect(revealed).toEqual([0]);
  });

  it("a click on a result goes there and hands the focus to the canvas; arrows and Enter in the list do the same", async () => {
    const focusCanvas = vi.spyOn(viewerCommands, "focusCanvas").mockImplementation(() => undefined);
    const { user } = setup();
    await user.type(field(), "+2700");
    await settle();
    await user.click(screen.getAllByTestId("search-hit")[1]);
    expect(revealed).toEqual([2]);
    expect(focusCanvas).toHaveBeenCalledTimes(1);
    const list = screen.getByRole("listbox", { name: "Search results" });
    act(() => list.focus());
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(revealed).toEqual([2, 0]);
  });

  it("the keyboard's row starts over with a new query: Enter in the list never goes to a hit of the old results (review R8)", async () => {
    vi.spyOn(viewerCommands, "focusCanvas").mockImplementation(() => undefined);
    const { user } = setup();
    await user.type(field(), "+2700");
    await settle();
    const list = screen.getByRole("listbox", { name: "Search results" });
    act(() => list.focus());
    fireEvent.keyDown(list, { key: "End" });
    expect(list.getAttribute("aria-activedescendant")).toMatch(/hit-1$/);
    await user.clear(field());
    await user.type(field(), "room");
    await settle();
    expect(list.getAttribute("aria-activedescendant")).toMatch(/hit-0$/);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(revealed).toEqual([0]);
  });

  it("an image-only drawing lists 'No searchable text on this page'", async () => {
    pages = [text([])];
    setup(1);
    await settle();
    expect(screen.getByTestId("search-no-text-page")).toHaveTextContent("No searchable text on this page");
  });

  it("Ctrl+F's focus request focuses and selects the query", async () => {
    const { user } = setup();
    await user.type(field(), "abc");
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => requestSearchFocus());
    expect(field()).toHaveFocus();
    expect((field() as HTMLInputElement).selectionStart).toBe(0);
    expect((field() as HTMLInputElement).selectionEnd).toBe(3);
  });
});

describe("search panel helpers", () => {
  it("status text and rows", () => {
    expect(searchStatus({ query: "x", hits: [], pagesDone: 1, pageCount: 3, noText: [] })).toBe("No results so far · searching 1 of 3 pages");
    const hit = (page: number) => ({
      page,
      start: 0,
      end: 1,
      snippet: { before: "", match: "x", after: "" },
      quads: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      textHeight: 0,
    });
    expect(resultRows({ hits: [hit(0), hit(0), hit(2)], noText: [], pageCount: 3, pagesDone: 3 })).toEqual([
      { kind: "page", page: 0, count: 2 },
      { kind: "hit", hit: 0 },
      { kind: "hit", hit: 1 },
      { kind: "page", page: 2, count: 1 },
      { kind: "hit", hit: 2 },
    ]);
    expect(resultRows({ hits: [], noText: [0, 1], pageCount: 2, pagesDone: 2 })).toEqual([
      { kind: "page", page: 0, count: 0 },
      { kind: "note", page: 0 },
      { kind: "page", page: 1, count: 0 },
      { kind: "note", page: 1 },
    ]);
  });
});

describe("result row description (review R5)", () => {
  const hit = {
    page: 0,
    start: 0,
    end: 8,
    snippet: { before: "60 60 ", match: "CH +2700", after: " CH +2700" },
    quads: [],
    bounds: { x: 100, y: 50, width: 40, height: 10 },
    textHeight: 10,
  };

  it("names the nearby text, not the drawing-order excerpt", () => {
    expect(hitDescription(hit, ["CT.02", "D1"])).toEqual({ match: "CH +2700", context: "CT.02 · D1" });
    expect(hitDescription(hit, [])).toEqual({ match: "CH +2700", context: "" });
  });

  it("places the hit on its page as shares of the page size", () => {
    expect(hitPlace(hit, { width: 240, height: 110 })).toEqual({ x: 0.5, y: 0.5 });
    expect(hitPlace(hit, { width: 0, height: 100 })).toBeNull();
    expect(hitPlace(hit, undefined)).toBeNull();
    expect(hitPlace({ ...hit, bounds: { x: 500, y: -50, width: 0, height: 0 } }, { width: 100, height: 100 })).toEqual({ x: 1, y: 0 });
  });
});
