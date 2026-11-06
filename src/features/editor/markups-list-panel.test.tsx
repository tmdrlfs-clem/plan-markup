// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { registerViewerEngine } from "@/features/viewer/viewer-commands";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { editorStore, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { EMPTY_VIEW } from "@/core/markup/markup-list";

import { MarkupsListPanel, markupListView } from "./markups-list-panel";

const SHEET = { width: 842, height: 595, rotate: 0 };

let n = 0;
function line(page = 0, extra: object = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: `doc:${page}`,
    createdAt: "2026-11-07T01:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type: "line",
    points: [{ x: 10 * n, y: 10 }, { x: 10 * n + 5, y: 20 }],
    ...extra,
  } as Markup;
}

let unregister: () => void = () => undefined;
const reveal = vi.fn();
const goToPage = vi.fn();

function setup(markups: Markup[]) {
  unregister = registerViewerEngine({
    zoomStep: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    rotate: vi.fn(),
    focusCanvas: vi.fn(),
    goToPage: (i: number) => {
      goToPage(i);
      viewerStore.setState({ pageIndex: i });
    },
    currentPage: 0,
    pageCount: 2,
    revealUserRect: reveal,
  });
  act(() => {
    viewerStore.setState({ status: "ready", pageCount: 2, pageIndex: 0, pages: [SHEET, SHEET], documentId: "doc", calibrations: {}, pageLabels: null, sheetLabels: { 1: "A-102" }, tool: "select" });
    setDocMarkups("doc", markups);
  });
  render(<MarkupsListPanel author="Dana Drafter" />);
  return userEvent.setup({ delay: null });
}

const rows = () => screen.queryAllByTestId("markups-list-row");
const selection = () => editorStore.getState().selection.ids;

beforeEach(() => {
  markupListView.setState(EMPTY_VIEW, true);
  reveal.mockReset();
  goToPage.mockReset();
});

afterEach(() => {
  unregister();
  act(() => {
    resetEditor();
    resetViewer();
  });
});

describe("Markups List (Story 6.7)", () => {
  it("shows each markup's type, subject, page, comments, date, author, status, colour, layer, device (7.3) and value", () => {
    const a = line(0, { subject: "Check this" });
    setup([a, line(1)]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Type", "Subject", "Page", "Comments", "Date", "Author", "Status", "Colour", "Layer", "Device", "Measurement"]);
    const cells = screen.getAllByRole("gridcell").slice(0, 11).map((c) => c.textContent);
    expect(cells[0]).toBe("Line");
    expect(cells.slice(1, 4)).toEqual(["Check this", "Page 1", "—"]);
    expect(cells[5]).toBe("Dana Drafter");
    expect(cells[7]).toBe("#ff0000");
    expect(rows()[1].textContent).toContain("A-102");
  });

  it("an empty state, and none without a drawing", () => {
    setup([]);
    expect(screen.getByTestId("markups-list-empty").textContent).toBe("Markups you add appear here.");
  });

  it("renders only the rows in view for thousands of markups", () => {
    setup(Array.from({ length: 3000 }, () => line(0)));
    expect(screen.getByTestId("markups-list").dataset.rows).toBe("3000");
    expect(rows().length).toBeLessThan(60);
  });

  it("selection syncs both ways: click, Ctrl+click and Shift+click select on the canvas; the canvas selection marks rows", async () => {
    const [a, b, c, d] = [line(), line(), line(), line(1)];
    const user = setup([a, b, c, d]);
    await user.click(rows()[0]);
    expect(selection()).toEqual([a.id]);
    await user.keyboard("{Control>}");
    await user.click(rows()[2]);
    await user.keyboard("{/Control}");
    expect([...selection()].sort()).toEqual([a.id, c.id].sort());
    await user.click(rows()[0]);
    await user.keyboard("{Shift>}");
    await user.click(rows()[1]);
    await user.keyboard("{/Shift}");
    expect([...selection()].sort()).toEqual([a.id, b.id].sort());
    // A row on another page shows that page and selects only there.
    await user.click(rows()[3]);
    expect(goToPage).toHaveBeenCalledWith(1);
    expect(selection()).toEqual([d.id]);
    // From the canvas.
    act(() => {
      viewerStore.setState({ pageIndex: 0 });
      setSelection([b.id]);
    });
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
  });

  it("double-click and Enter zoom to the markup", async () => {
    const [a, b] = [line(), line()];
    const user = setup([a, b]);
    await user.dblClick(rows()[1]);
    expect(reveal).toHaveBeenCalledWith(0, expect.objectContaining({ width: 5, height: 10 }));
    expect(selection()).toEqual([b.id]);
    const grid = screen.getByRole("grid", { name: "Markups" });
    act(() => grid.focus());
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("keyboard: arrows move the active cell (Up / Down select the row, Shift extends), Home / End, Ctrl+Home / Ctrl+End, Space", () => {
    const list = [line(), line(), line(), line()];
    setup(list);
    const grid = screen.getByRole("grid", { name: "Markups" });
    act(() => grid.focus());
    const activeCell = () => grid.getAttribute("aria-activedescendant");
    expect(activeCell()).toBe("markups-list-cell-0-0");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(activeCell()).toBe("markups-list-cell-1-0");
    expect(selection()).toEqual([list[1].id]);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect([...selection()].sort()).toEqual([list[1].id, list[2].id].sort());
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(activeCell()).toBe("markups-list-cell-2-2");
    fireEvent.keyDown(grid, { key: "End" });
    expect(activeCell()).toBe("markups-list-cell-2-10");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(activeCell()).toBe("markups-list-cell-2-0");
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
    expect(activeCell()).toBe("markups-list-cell-3-0");
    expect(selection()).toEqual([list[3].id]);
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    fireEvent.keyDown(grid, { key: "ArrowDown", ctrlKey: true });
    expect(selection()).toEqual([list[0].id]);
    fireEvent.keyDown(grid, { key: " ", ctrlKey: true });
    expect([...selection()].sort()).toEqual([list[0].id, list[1].id].sort());
  });
});

describe("sort, filter and search (Story 6.8)", () => {
  const subjects = () => rows().map((r) => r.querySelectorAll("[role='gridcell']")[1].textContent);
  const count = () => screen.getByTestId("markups-list-count").textContent;

  it("a header click sorts ascending, then descending, then not at all", async () => {
    const user = setup([line(0, { subject: "b" }), line(1, { subject: "c" }), line(0, { subject: "a" })]);
    expect(subjects()).toEqual(["b", "a", "c"]);
    const header = () => screen.getByRole("columnheader", { name: "Subject" });
    expect(header()).toHaveAttribute("aria-sort", "none");
    await user.click(within(header()).getByRole("button"));
    expect(subjects()).toEqual(["a", "b", "c"]);
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(header()).getByRole("button"));
    expect(subjects()).toEqual(["c", "b", "a"]);
    expect(header()).toHaveAttribute("aria-sort", "descending");
    await user.click(within(header()).getByRole("button"));
    expect(subjects()).toEqual(["b", "a", "c"]);
    // Columns without data do not sort.
    expect(screen.getByRole("columnheader", { name: "Comments" })).not.toHaveAttribute("aria-sort");
    expect(count()).toBe("3 markups");
  });

  it("the quick filter updates rows at once, shows a removable chip and the count", async () => {
    const user = setup([line(0, { subject: "Duct run" }), line(0, { subject: "Pipe" }), line(1, { subject: "Duct drop" })]);
    await user.type(screen.getByRole("searchbox", { name: "Quick filter" }), "duct");
    expect(subjects()).toEqual(["Duct run", "Duct drop"]);
    expect(count()).toBe("Showing 2 of 3");
    expect(screen.getAllByTestId("markups-list-chip").map((c) => c.textContent)).toEqual(["“duct”"]);
    await user.click(screen.getByRole("button", { name: "Remove quick filter" }));
    expect(subjects()).toHaveLength(3);
    expect(screen.getByRole("searchbox", { name: "Quick filter" })).toHaveValue("");
  });

  it("column filters show as chips; nothing matching offers Clear filters", async () => {
    const user = setup([line(0), line(1), line(1)]);
    act(() => markupListView.setState({ filters: { page: ["A-102"] } }));
    expect(rows()).toHaveLength(2);
    expect(count()).toBe("Showing 2 of 3");
    expect(screen.getAllByTestId("markups-list-chip").map((c) => c.textContent)).toEqual(["Page: A-102"]);
    await user.click(screen.getByRole("button", { name: "Remove Page filter" }));
    expect(rows()).toHaveLength(3);

    act(() => markupListView.setState({ filters: { type: ["Arrow"] } }));
    expect(screen.getByTestId("markups-list-no-match")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(3);
  });

  it("Filter lists each column's values and toggles them", async () => {
    const user = setup([line(0), line(1)]);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(await screen.findByRole("menuitem", { name: "Page" }));
    // The submenu item by keyboard (jsdom has no pointer grace area for submenus).
    (await screen.findByRole("menuitemcheckbox", { name: "Page 1" })).focus();
    await user.keyboard(" ");
    expect(markupListView.getState().filters.page).toEqual(["Page 1"]);
    expect(rows()).toHaveLength(1);
  });

  it("selecting a filtered row jumps to the markup's page", async () => {
    const target = line(1, { subject: "Far" });
    const user = setup([line(0), target]);
    await user.type(screen.getByRole("searchbox", { name: "Quick filter" }), "far");
    await user.click(rows()[0]);
    expect(goToPage).toHaveBeenCalledWith(1);
    expect(selection()).toEqual([target.id]);
  });
});
