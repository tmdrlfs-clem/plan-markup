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

import { EngineHost } from "@/workers/engine.worker";
import type { EngineReply } from "@/core/sprinkler/engine/protocol";

import { coverageStore, resetCoverage } from "@/features/editor/coverage-overlay";

import { headCentre, isHead, type HeadMarkup } from "@/core/sprinkler/heads";
import { translateMarkup } from "@/core/markup/geometry";
import { executeOp } from "@/features/editor/undo-store";
import { setArmedStamp, stampStore } from "@/features/tool-chest/stamp-store";

import { stopLiveCheck, zoneCheckStore } from "./live-check";
import { resetPlaceRun, setEngineChannelFactory } from "./place-run";
import { CALIBRATE_FIRST, NO_ZONES, SprinklerPanel, UNMAPPED_USE, ZONES_TIP } from "./sprinkler-panel";
import { resetUseMap, useMapStore } from "./use-map-store";

const getUseHazardMap = vi.hoisted(() => vi.fn());
const saveZoneLayouts = vi.hoisted(() => vi.fn(async () => ({ ok: true, data: null })));
vi.mock("./actions", () => ({ getUseHazardMap: () => getUseHazardMap(), saveZoneLayouts }));

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
    stopLiveCheck();
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
    // Story 9.12 (FR78): the footer always says layouts are advisory.
    expect(screen.getByTestId("advisory-notice").textContent).toMatch(/advisory\. The designer remains responsible for compliance with NZS 4541/);
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

describe("SprinklerPanel Place heads (Story 9.8)", () => {
  beforeEach(() => {
    setEngineChannelFactory(() => {
      const listeners = new Set<(r: EngineReply) => void>();
      const host = new EngineHost((r) => listeners.forEach((fn) => fn(r)));
      return {
        post: (msg) => void host.handle(msg),
        listen: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    });
  });
  afterEach(() => {
    act(() => {
      resetPlaceRun();
      resetCoverage();
    });
    setEngineChannelFactory(null);
  });

  it("is disabled without zones; no coverage controls before heads", () => {
    setup([]);
    expect((screen.getByTestId("place-heads") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("coverage-controls")).toBeNull();
  });

  it("places heads in every zone, reports the outcome and ticks the checklist", async () => {
    const a = zone();
    const user = setup([a]);
    expect(screen.getByTestId("place-heads").textContent).toBe("Place heads");
    await user.click(screen.getByTestId("place-heads"));
    await screen.findByText(/head(s)? placed in 1 zone\./);
    const heads = (editorStore.getState().doc.markups.doc ?? []).filter((m) => m.type === "ellipse");
    expect(heads.length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId("sprinkler-checklist"))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-done")),
    ).toEqual(["true", "true", "true"]);
    expect(screen.queryByTestId("place-errors")).toBeNull();
    // Story 9.9: the coverage overlay is on after a run; it toggles, and its shape too.
    const controls = screen.getByTestId("coverage-controls");
    const toggle = within(controls).getByRole("button", { name: "Coverage" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(coverageStore.getState().fade).not.toBe("hidden");
    await user.click(within(controls).getByRole("button", { name: "Square" }));
    expect(coverageStore.getState().shape).toBe("square");
    await user.click(toggle);
    expect(coverageStore.getState().on).toBe(false);
    expect((within(controls).getByRole("button", { name: "Circle" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the selected zones and shows an error card that reveals the zone", async () => {
    const a = zone();
    const b = { ...zone(), zone: { ...zone().zone, name: "Store", use: "Hangar" } };
    const user = setup([a, b]);
    await user.click(screen.getByRole("button", { name: /Store/ }));
    expect(screen.getByTestId("place-heads").textContent).toBe("Place heads (1 selected)");
    await user.click(screen.getByTestId("place-heads"));
    const card = await screen.findByTestId("place-error");
    expect(card.textContent).toContain("Store: not placed");
    expect(card.textContent).toContain("Choose a use");
    reveal.mockReset();
    await user.click(within(card).getByRole("button", { name: "Show in drawing" }));
    expect(reveal).toHaveBeenCalledWith(0, { x: 100, y: 100, width: 200, height: 150 });
    expect(editorStore.getState().selection.ids).toEqual([b.id]);
  });

  it("Story 9.10: shows each zone's live check, confirms a re-run's scope and keeps an edited head", async () => {
    const a = zone();
    const user = setup([a]);
    await user.click(screen.getByTestId("place-heads"));
    await screen.findByText(/placed in 1 zone\./);
    expect((await screen.findByTestId("zone-check")).getAttribute("data-tone")).toBe("pass");
    const heads = () => (editorStore.getState().doc.markups.doc ?? []).filter(isHead);

    // A head dragged onto the wall: the row says so (the move is one undo step and makes it manual).
    const h = heads()[0];
    act(() => executeOp({ kind: "markups.update", documentId: "doc", before: [h], after: [translateMarkup(h, { x: 100 - headCentre(h).x, y: 0 })] }, "Move markup"));
    await vi.waitFor(() => expect(screen.getByTestId("zone-check").getAttribute("data-tone")).toBe("error"));
    expect(screen.getByTestId("zone-check").textContent).toMatch(/rule break/);
    const moved = heads().find((x) => x.id === h.id) as HeadMarkup;
    expect(moved.head.kind).toBe("manual");

    // Re-running confirms what it replaces and keeps; Cancel does nothing.
    await user.click(screen.getByTestId("place-heads"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Re-place 1 zone, keep 1 edited head")).toBeTruthy();
    expect(dialog.textContent).toContain("Heads you moved or added stay where they are");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(heads().map((x) => x.id)).toContain(h.id);

    await user.click(screen.getByTestId("place-heads"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Re-place 1 zone" }));
    await screen.findByText(/placed in 1 zone\./);
    const kept = heads().find((x) => x.id === h.id);
    expect(kept?.head.kind).toBe("manual");
    expect(kept?.points).toEqual(moved.points);
  });

  it("Story 9.10: Add head arms the Stamp tool in head mode; arming a Tool Chest tool ends it", async () => {
    const user = setup([zone()]);
    const add = screen.getByTestId("add-head");
    await user.click(add);
    expect(viewerStore.getState().tool).toBe("stamp");
    expect(stampStore.getState().heads).toBe(true);
    expect(screen.getByTestId("add-head").getAttribute("aria-pressed")).toBe("true");
    act(() => setArmedStamp({ id: "t", name: "Bell", content: null as never, imageSrc: null, device: null }));
    expect(stampStore.getState().heads).toBe(false);
    expect(screen.getByTestId("add-head").getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByTestId("add-head"));
    act(() => setTool("select"));
    expect(stampStore.getState().heads).toBe(false);
  });
  it("Story 9.11: the selected zone's report lists its breaks; a row zooms to its break; changes are announced", async () => {
    const a = zone();
    const user = setup([a]);
    await user.click(screen.getByTestId("place-heads"));
    await screen.findByText(/placed in 1 zone\./);
    await screen.findByTestId("zone-check");
    // No report until the zone is selected; then a clean one.
    expect(screen.queryByTestId("zone-report")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Zone 1/ }));
    const report = await screen.findByTestId("zone-report");
    expect(within(report).getByTestId("report-hazard").textContent).toContain(screen.getByTestId("hazard-chip").textContent);
    expect(within(report).getByTestId("report-ruleset").textContent).toContain("nzs4541 v1");
    expect(within(report).getByTestId("report-pass")).toBeTruthy();

    // A head pushed onto the wall: the report lists the break; the change is announced once it holds.
    const heads = () => (editorStore.getState().doc.markups.doc ?? []).filter(isHead);
    const h = heads()[0];
    act(() => executeOp({ kind: "markups.update", documentId: "doc", before: [h], after: [translateMarkup(h, { x: 100 - headCentre(h).x, y: 0 })] }, "Move markup"));
    const list = await screen.findByTestId("rule-breaks");
    const first = within(list).getAllByTestId("rule-break")[0];
    expect(first.textContent).toMatch(/Rule break:/);
    await vi.waitFor(() => expect(screen.getByTestId("zone-status-live").textContent).toMatch(/^Zone 1: \d+ rule breaks?/), { timeout: 2000 });

    reveal.mockReset();
    await user.click(first);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId("rule-breaks")).getAllByTestId("rule-break")[0].getAttribute("aria-current")).toBe("true");
    expect(zoneCheckStore.getState().focus?.zoneId).toBe(a.id);
  });

  it("Story 9.11: a zone the engine cannot place shows Infeasible", async () => {
    const thin = newZone({ id: "00000000-0000-7000-8000-0000000009f1", pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer: ring(100, 100, 200, 1), holes: [] }, [], CAL);
    const user = setup([thin]);
    await user.click(screen.getByTestId("place-heads"));
    await screen.findByTestId("place-error");
    const badge = screen.getByTestId("zone-check");
    expect(badge.getAttribute("data-tone")).toBe("infeasible");
    expect(badge.textContent).toBe("Infeasible");
  });
});
