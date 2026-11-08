// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import type { ZoneMarkup } from "@/core/schema/markup";
import { newZone } from "@/core/sprinkler/zone";
import { calibrateStore } from "@/features/calibration";
import { editorStore, resetEditor, setDocMarkups } from "@/features/editor/editor-store";
import { undoActive } from "@/features/editor/undo-store";
import { zoneDrawStore } from "@/features/editor/zone-draw";
import { tipsStore } from "@/features/tips";
import { registerViewerEngine } from "@/features/viewer/viewer-commands";
import { setTool, viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { CALIBRATE_FIRST, NO_ZONES, SprinklerPanel, UNMAPPED_USE, ZONES_TIP } from "./sprinkler-panel";
import { resetUseMap, useMapStore } from "./use-map-store";

const getUseHazardMap = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ getUseHazardMap: () => getUseHazardMap() }));

vi.mock("@/features/markup-set/actions", () => ({
  ensureMarkupSet: vi.fn(),
  saveSetCalibrations: vi.fn(),
  applyMarkupOps: vi.fn(),
  loadMarkupSet: vi.fn(async () => ({ ok: true, data: null })),
  hasMarkupsOnOtherVersion: vi.fn(async () => ({ ok: true, data: false })),
  listMyMarkupSets: vi.fn(async () => ({ ok: true, data: [] })),
  loadMarkupSetPages: vi.fn(),
}));
vi.mock("@/features/activity/actions", () => ({
  recordActivity: vi.fn(async () => ({ ok: true, data: null })),
}));

const SHEET = { width: 842, height: 595, rotate: 0 };
const k100 = factorForRatio(100);
const CAL: Calibration = {
  xFactor: k100,
  yFactor: k100,
  unit: "mm",
  precision: "0",
  source: "ratio",
  ratio: 100,
};
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

let n = 0;
function zone(holes: { x: number; y: number }[][] = [], page = 0): ZoneMarkup {
  n++;
  return newZone(
    {
      id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
      pageId: `doc:${page}`,
      createdAt: "2026-11-12T00:00:00.000Z",
      outer: ring(100, 100, 200, 150),
      holes,
    },
    [],
    CAL,
  );
}

let unregister: () => void = () => undefined;
const reveal = vi.fn();

function setup(markups: ZoneMarkup[], calibrations: Record<string, Calibration> = { "doc:0": CAL }) {
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
  viewerStore.setState({
    status: "ready",
    pageCount: 2,
    pageIndex: 0,
    pages: [SHEET, SHEET],
    documentId: "doc",
    calibrations,
    pageLabels: null,
    sheetLabels: {},
  });
  tipsStore.setState({ seen: [], loaded: true });
  setDocMarkups("doc", markups);
  render(<SprinklerPanel emptyText="Open and calibrate a drawing to place sprinklers." />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => {
  getUseHazardMap.mockReset();
  getUseHazardMap.mockResolvedValue({ ok: false, code: "INTERNAL", message: "" });
});

afterEach(() => {
  unregister();
  reveal.mockReset();
  act(() => {
    zoneDrawStore.setState({ tool: null });
    resetEditor();
    resetUseMap();
    resetViewer();
  });
});

describe("SprinklerPanel (Story 9.2)", () => {
  it("asks for a calibration on an uncalibrated page, and opens Calibrate", async () => {
    const user = setup([], {});
    expect(screen.getByText(CALIBRATE_FIRST)).toBeTruthy();
    expect(screen.queryByTestId("sprinkler-checklist")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Calibrate" }));
    expect(calibrateStore.getState().open).toBe(true);
  });

  it("shows the tip, the empty checklist and arms Fill zone / Polygon zone", async () => {
    const user = setup([]);
    expect(screen.getByText(ZONES_TIP)).toBeTruthy();
    expect(screen.getByText(NO_ZONES)).toBeTruthy();
    const items = within(screen.getByTestId("sprinkler-checklist")).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-done"))).toEqual(["false", "false", "false"]);
    await user.click(screen.getByRole("button", { name: /Fill zone/ }));
    expect(viewerStore.getState().tool).toBe("fill");
    expect(zoneDrawStore.getState().tool).toBe("fill");
    expect(screen.getByRole("button", { name: /Fill zone/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Polygon zone/ }));
    expect(viewerStore.getState().tool).toBe("area");
    expect(zoneDrawStore.getState().tool).toBe("area");
    // Another tool ends zone mode.
    act(() => setTool("select"));
    expect(zoneDrawStore.getState().tool).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByText(ZONES_TIP)).toBeNull();
  });

  it("lists the page's zones with use, hazard and area; a row selects and reveals its zone", async () => {
    const a = zone();
    const other = zone([], 1);
    const user = setup([a, other]);
    const rows = screen.getAllByTestId("zone-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Zone 1");
    expect(rows[0].textContent).toContain("Office");
    expect(within(rows[0]).getByTestId("hazard-chip").textContent).toBe("ELH");
    // 200 × 150 pt at 1:100 is 7.06 m × 5.29 m.
    expect(rows[0].textContent).toMatch(/37\.\d m²/);
    expect(
      within(screen.getByTestId("sprinkler-checklist"))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-done")),
    ).toEqual(["true", "true", "false"]);
    await user.click(within(rows[0]).getByRole("button", { name: /Zone 1/ }));
    expect(editorStore.getState().selection.ids).toEqual([a.id]);
    expect(reveal).toHaveBeenCalledWith(0, {
      x: 100,
      y: 100,
      width: 200,
      height: 150,
    });
    expect(rows[0].getAttribute("data-selected")).toBe("true");
    expect(within(rows[0]).getByRole("button", { name: /Zone 1/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tags a selected zone's holes (undoable)", async () => {
    const z = zone([ring(120, 120, 10, 10)]);
    const user = setup([z]);
    expect(screen.queryByTestId("zone-holes")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Zone 1/ }));
    const holes = screen.getByTestId("zone-holes");
    const trigger = within(holes).getByRole("combobox", { name: "Hole 1" });
    expect(trigger.textContent).toContain("Column");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Shaft / void" }));
    const saved = editorStore.getState().doc.markups.doc[0] as ZoneMarkup;
    expect(saved.zone.holeTags).toEqual(["shaft"]);
    act(() => void undoActive());
    expect((editorStore.getState().doc.markups.doc[0] as ZoneMarkup).zone.holeTags).toEqual(["column"]);
  });

  it("reads the mapping once; a use change sets the hazard and figures at once (undoable)", async () => {
    getUseHazardMap.mockResolvedValue({
      ok: true,
      data: {
        source: "platform",
        map: { ...useMapStore.getState().map, version: "2", uses: [...useMapStore.getState().map.uses, { use: "Lab", hazard: "OH3" }] },
      },
    });
    const z = zone();
    const user = setup([z]);
    await vi.waitFor(() => expect(useMapStore.getState().loaded).toBe(true));
    expect(getUseHazardMap).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Zone 1/ }));
    const figures = screen.getByTestId("zone-figures");
    expect(figures.textContent).toContain("ELH · NZS 4541 v1");
    expect(within(figures).getByTestId("figure-Amax").textContent).toContain("21 m²");
    expect(within(figures).getByTestId("figure-Smax").textContent).toContain("4.6 m");
    expect(within(figures).getByTestId("mapping-source").textContent).toBe("Platform default mapping v2 (draft, not yet verified)");

    await user.click(screen.getByRole("combobox", { name: "Use of Zone 1" }));
    await user.click(await screen.findByRole("option", { name: "Lab (OH3)" }));
    expect((editorStore.getState().doc.markups.doc[0] as ZoneMarkup).zone.use).toBe("Lab");
    expect(screen.getByTestId("hazard-chip").textContent).toBe("OH3");
    expect(screen.getByTestId("zone-figures").textContent).toContain("OH3 · NZS 4541 v1");
    expect(within(screen.getByTestId("zone-figures")).getByTestId("figure-Amax").textContent).toContain("12 m²");
    act(() => void undoActive());
    expect(screen.getByTestId("hazard-chip").textContent).toBe("ELH");
  });

  it("an unmapped use shows ? and asks for a use; the checklist's Uses stays open", async () => {
    getUseHazardMap.mockResolvedValue({ ok: false, code: "INTERNAL", message: "x" });
    const z = zone();
    const user = setup([{ ...z, zone: { ...z.zone, use: "Hangar" } }]);
    expect(screen.getByTestId("hazard-chip").textContent).toBe("?");
    expect(
      within(screen.getByTestId("sprinkler-checklist"))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-done")),
    ).toEqual(["true", "false", "false"]);
    await user.click(screen.getByRole("button", { name: /Zone 1/ }));
    expect(screen.getByTestId("zone-figures").textContent).toContain(UNMAPPED_USE);
    expect(screen.getByTestId("mapping-source").textContent).toContain("Built-in default mapping v1");
  });
});
