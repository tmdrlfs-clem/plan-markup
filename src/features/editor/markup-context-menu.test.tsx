// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";
import type { LayerView } from "@/features/viewer";
import { registerViewerEngine } from "@/features/viewer/viewer-commands";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setMarkupMenu, setSelection } from "./editor-store";
import { MarkupContextMenu, selectionStateOf } from "./markup-context-menu";
import { resetSelectTool } from "./select-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const view: LayerView = {
  documentId: "doc",
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: -p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 1000,
  height: 1000,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

let n = 0;
function count(x: number, extra: Partial<Markup> = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "doc:0",
    createdAt: "2026-11-02T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type: "count",
    points: [{ x, y: 0 }],
    ...extra,
  } as Markup;
}

const focusCanvas = vi.fn();
let unregister: () => void = () => undefined;
let a: Markup;
let b: Markup;

beforeEach(() => {
  resetViewer();
  viewerStore.setState({ tabId: "t1", documentId: "doc", openSeq: 1, pageIndex: 0 });
  unregister = registerViewerEngine({
    zoomStep: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    rotate: vi.fn(),
    goToPage: vi.fn(),
    focusCanvas,
    currentPage: 0,
    pageCount: 1,
  });
  a = count(0);
  b = count(100, { locked: true });
  setDocMarkups("doc", [a, b]);
});

afterEach(() => {
  unregister();
  resetSelectTool({ clipboard: true });
  resetEditor();
  clearUndo();
  focusCanvas.mockClear();
});

const open = () => setMarkupMenu({ documentId: "doc", pageIndex: 0, view, point: { x: 50, y: 0 }, client: { x: 40, y: 30 } });

describe("MarkupContextMenu (Story 5.3)", () => {
  it("states what the selection allows: units, locked, grouped", () => {
    const g = "00000000-0000-7000-8000-0000000000aa";
    const list = [count(0, { groupId: g }), count(1, { groupId: g }), count(2, { locked: true })];
    expect(selectionStateOf(list.map((m) => m.id), list, "doc", 0)).toEqual({ selected: 3, editable: 2, units: 2, grouped: true, locked: 1, any: true });
    expect(selectionStateOf([], list, "doc", 1)).toMatchObject({ selected: 0, any: false });
  });

  it("opens where the right-click was; disables what cannot act; Group groups; closing focuses the canvas", async () => {
    const user = userEvent.setup();
    render(<MarkupContextMenu />);
    expect(screen.queryByRole("menu")).toBeNull();
    setSelection([a.id]);
    open();
    const menu = await screen.findByRole("menu", { name: "Markup" });
    expect(screen.getByTestId("markup-menu-anchor")).toHaveStyle({ left: "40px", top: "30px" });
    expect(screen.getByRole("menuitem", { name: /Copy/ })).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /Paste/ })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /Group/ })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /Lock/ })).not.toHaveAttribute("data-disabled");
    expect(menu).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(editorStore.getState().tools.menu).toBeNull();
    expect(focusCanvas).toHaveBeenCalled();

    // A locked markup in the selection: Unlock; two units: Group.
    setSelection([a.id, b.id]);
    open();
    await screen.findByRole("menu", { name: "Markup" });
    expect(screen.getByRole("menuitem", { name: /Unlock/ })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /^Group/ }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const [ga, gb] = markupsOf(editorStore.getState(), "doc");
    expect(ga.groupId).toBeDefined();
    expect(ga.groupId).toBe(gb.groupId);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Group markups");
  });
});
