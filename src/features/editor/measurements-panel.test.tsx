// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MEASURE_STYLE, type MeasureMarkup } from "@/core/schema/markup";
import { registerViewerEngine } from "@/features/viewer/viewer-commands";
import { setTool, viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { editorStore, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { MEASUREMENTS_HINT, MeasurementsPanel, measurementUnits } from "./measurements-panel";

const SHEET = { width: 842, height: 595, rotate: 0 };
const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const RECT = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];

let n = 0;
function markup(type: MeasureMarkup["type"], points: { x: number; y: number }[], page = 0): MeasureMarkup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: `doc:${page}`,
    createdAt: "2026-11-01T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type,
    points,
  } as MeasureMarkup;
}

let unregister: () => void = () => undefined;
const reveal = vi.fn();

function setup(markups: MeasureMarkup[], calibrations: Record<string, Calibration> = { "doc:0": CAL }) {
  unregister = registerViewerEngine({
    zoomStep: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    rotate: vi.fn(),
    focusCanvas: vi.fn(),
    goToPage: vi.fn(),
    currentPage: 0,
    pageCount: 2,
    revealUserRect: reveal,
  });
  viewerStore.setState({ status: "ready", pageCount: 2, pageIndex: 0, pages: [SHEET, SHEET], documentId: "doc", calibrations, pageLabels: null, sheetLabels: { 1: "A-102" } });
  setDocMarkups("doc", markups);
  render(<MeasurementsPanel emptyText="No measurements yet" noDrawingText="No drawing open" />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => {
  reveal.mockReset();
  measurementUnits.setState({ unit: null });
});

afterEach(() => {
  unregister();
  act(() => {
    resetEditor();
    resetViewer();
  });
});

describe("MeasurementsPanel (Story 4.11)", () => {
  it("shows the empty states", () => {
    render(<MeasurementsPanel emptyText="No measurements yet" noDrawingText="No drawing open" />);
    expect(screen.getByText("No drawing open")).toBeTruthy();
  });

  it("names the measure tools when the drawing has no measurements", () => {
    setup([]);
    expect(screen.getByTestId("measurements-empty").textContent).toContain(MEASUREMENTS_HINT);
  });

  it("groups by type with totals, rows in page order, unscaled left out", () => {
    setup([
      markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }], 1),
      markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]),
      markup("length", [{ x: 0, y: 0 }, { x: 36, y: 0 }]),
      markup("area", RECT),
      markup("angle", [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }]),
    ]);
    const length = screen.getByTestId("measurements-group-length");
    expect(within(length).getByText("Length (3)")).toBeTruthy();
    expect(within(length).getByText("1 not scaled")).toBeTruthy();
    expect(within(length).getByTestId("measurements-total").textContent).toBe("3810 mm");
    const rows = within(length).getAllByTestId("measurements-row");
    expect(rows.map((r) => r.textContent)).toEqual(["Page 12540 mm", "Page 11270 mm", "A-102Scale not set"]);
    expect(within(screen.getByTestId("measurements-group-area")).getByTestId("measurements-total").textContent).toBe("37.34 m²");
    const angle = screen.getByTestId("measurements-group-angle");
    expect(within(angle).queryByTestId("measurements-total")).toBeNull();
    expect(within(angle).getByTestId("measurements-row").textContent).toContain("90.0°");
  });

  it("converts to the chosen unit", () => {
    setup([markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }])]);
    act(() => measurementUnits.setState({ unit: "m" }));
    expect(screen.getByTestId("measurements-total").textContent).toBe("2.54 m");
    act(() => measurementUnits.setState({ unit: "ft-in" }));
    expect(screen.getByTestId("measurements-total").textContent).toBe(`8'-4"`);
  });

  it("a click selects the measurement and reveals it; keys move and activate", async () => {
    const a = markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]);
    const b = markup("area", RECT, 1);
    const user = setup([a, b], { "doc:0": CAL, "doc:1": CAL });
    setTool("length");
    const rows = screen.getAllByTestId("measurements-row");
    await user.click(rows[0]);
    // Review R1: a tool in use gives way to Select.
    expect(viewerStore.getState().tool).toBe("select");
    expect(editorStore.getState().selection.ids).toEqual([a.id]);
    expect(reveal).toHaveBeenCalledWith(0, { x: 0, y: 0, width: 72, height: 0 });
    expect(screen.getAllByTestId("measurements-row")[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByTestId("measurements-row")[1]);
    await user.keyboard("{Enter}");
    expect(editorStore.getState().selection.ids).toEqual([b.id]);
    expect(reveal).toHaveBeenLastCalledWith(1, { x: 100, y: 100, width: 200, height: 150 });
  });

  it("Story 5.3 review R3: a click on a grouped measurement selects its group", async () => {
    const groupId = "00000000-0000-7000-8000-0000000000aa";
    const a = { ...markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]), groupId };
    const b = { ...markup("length", [{ x: 0, y: 10 }, { x: 36, y: 10 }]), groupId };
    const c = markup("length", [{ x: 0, y: 20 }, { x: 36, y: 20 }]);
    const user = setup([a, b, c]);
    await user.click(screen.getAllByTestId("measurements-row")[1]);
    expect(editorStore.getState().selection.ids).toEqual([b.id, a.id]);
  });

  it("updates live: undoing a measurement removes its row, a calibration scales it", () => {
    const a = markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]);
    setup([a], {});
    expect(screen.getByTestId("measurements-row").textContent).toContain("Scale not set");
    act(() => viewerStore.setState({ calibrations: { "doc:0": CAL } }));
    expect(screen.getByTestId("measurements-row").textContent).toContain("2540 mm");
    act(() => {
      setSelection([a.id]);
      setDocMarkups("doc", []);
    });
    expect(screen.getByTestId("measurements-empty")).toBeTruthy();
  });
});
