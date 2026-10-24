// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { MM_PER_POINT, factorForRatio } from "@/core/calibration/calibration";
import type { PageScales } from "@/core/scale/detect";
import { clearUndo, redoActive, undoActive } from "@/features/editor";
import { tipsStore } from "@/features/tips";
import { INITIAL_VIEWER_STATE } from "@/features/viewer/viewer-store";
import { registerViewerEngine, type ViewerCommandTarget } from "@/features/viewer/viewer-commands";
import { viewerStore, type CalibrationPickListener } from "@/features/viewer";

import { CalibrateDialog } from "./calibrate-dialog";
import { calibrateStore, closeCalibrate, openCalibrate } from "./calibrate-store";
import { DEFAULT_CALIBRATION_PREFS, calibrationPrefs } from "./calibration-prefs";

const MM = 72 / 25.4;
const A1 = { width: 841 * MM, height: 594 * MM, rotate: 0 };
const A3 = { width: 420 * MM, height: 297 * MM, rotate: 0 };
const SHA = "f".repeat(64);
const L21: PageScales = {
  pageSheet: "A1",
  scales: [
    {
      ratio: 75,
      sheet: "A1",
      effective: 75,
      imperial: false,
      text: "1 : 75 @ A1",
      count: 1,
      quads: [],
      conflict: true,
      readings: [
        { ratio: 75, sheet: "A1", effective: 75, text: "1 : 75 @ A1" },
        { ratio: 200, sheet: "A3", effective: 100, text: "1 : 200 @ A3" },
      ],
    },
  ],
};

/** A fake engine for the pick: the test plays the clicks. */
let listener: CalibrationPickListener | null = null;
const engine: ViewerCommandTarget = {
  zoomStep: () => undefined,
  fitPage: () => undefined,
  fitWidth: () => undefined,
  rotate: () => undefined,
  goToPage: () => undefined,
  currentPage: 0,
  pageCount: 3,
  focusCanvas: () => undefined,
  startCalibrationPick: (l) => {
    listener = l;
    l.step(1);
  },
  cancelCalibrationPick: () => {
    const l = listener;
    listener = null;
    l?.done(null);
  },
  clearCalibrationLine: () => undefined,
};
let unregister = () => undefined as void;

beforeEach(() => {
  viewerStore.setState(
    { ...INITIAL_VIEWER_STATE, status: "ready", pageCount: 3, pages: [A1, A3, A1], pageIndex: 0, documentId: SHA, tabId: "doc-1", pageScales: { 0: L21 } },
    true,
  );
  tipsStore.setState({ seen: [], loaded: true }, true);
  calibrationPrefs.setState(DEFAULT_CALIBRATION_PREFS, true);
  unregister = registerViewerEngine(engine);
});

afterEach(() => {
  act(() => closeCalibrate());
  unregister();
  clearUndo();
  listener = null;
});

const wrap = () => render(<TooltipProvider delayDuration={0}><CalibrateDialog /></TooltipProvider>);
const calibrations = () => viewerStore.getState().calibrations;

describe("CalibrateDialog (Story 4.3)", () => {
  it("shows the first-use tip once, and the conflicting printed scales with both options (AC 6, 8)", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByTestId("tip-calibrate")).toBeInTheDocument();
    expect(within(dialog).getByTestId("calibrate-conflict")).toHaveTextContent("Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed");
    await user.click(within(dialog).getByRole("button", { name: "Use 1:200 @ A3 (1:100 on this page)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calibrations()[`${SHA}:0`]).toMatchObject({ source: "detected", ratio: 200, sheet: "A3", unit: "mm" });
    expect(calibrations()[`${SHA}:0`].xFactor).toBeCloseTo(factorForRatio(100), 9);
    // Opened again: the tip does not show again.
    act(() => openCalibrate());
    const again = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(again).queryByTestId("tip-calibrate")).toBeNull();
  });

  it("by ratio with a sheet qualifier, to a page range of mixed sizes, is one undo step; Enter applies", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    const ratio = within(dialog).getByTestId("calibrate-ratio");
    await user.type(ratio, "1:100 @ A1");
    act(() => calibrateStore.setState({ scope: "range", rangeText: "1-2" }));
    expect(within(dialog).getByTestId("calibrate-mixed")).toHaveTextContent("the ratio applies to each page as a ratio");
    await user.click(ratio);
    await user.keyboard("{Enter}");
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calibrations()[`${SHA}:0`].xFactor).toBeCloseTo(factorForRatio(100), 9);
    expect(calibrations()[`${SHA}:1`].xFactor).toBeCloseTo(factorForRatio(200), 9);
    expect(calibrations()[`${SHA}:2`]).toBeUndefined();
    act(() => void undoActive());
    expect(calibrations()).toEqual({});
    act(() => void redoActive());
    expect(Object.keys(calibrations())).toHaveLength(2);
  });

  it("an unreadable ratio or range shows an inline error and applies nothing", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.type(within(dialog).getByTestId("calibrate-ratio"), "scale");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(within(dialog).getByText("Enter a ratio like 1:100 or 1:100 @ A1")).toBeInTheDocument();
    expect(calibrations()).toEqual({});
  });

  it("two points: collapses to the instruction bar, Esc brings the dialog back; a pick under 10 px is refused; a typed ft-in distance applies (AC 2)", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    let dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.click(within(dialog).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Click the first point · Esc to cancel");
    act(() => listener!.step(2));
    expect(screen.getByRole("status")).toHaveTextContent("Click the second point · Esc to cancel");
    // Esc (the engine cancels): the dialog is back, as it was.
    act(() => engine.cancelCalibrationPick!());
    dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByRole("tab", { name: "By two points" })).toHaveAttribute("aria-selected", "true");
    // Too close on screen.
    await user.click(within(dialog).getByRole("button", { name: "Pick two points" }));
    act(() => listener!.done({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, distancePt: 5, dxPt: 5, dyPt: 0, screenPx: 6 }));
    dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByTestId("calibrate-pick-error")).toHaveTextContent("too close");
    // A good pick: 144 pt is 12'-6" in reality.
    await user.click(within(dialog).getByRole("button", { name: "Pick two points" }));
    act(() => listener!.done({ a: { x: 0, y: 0 }, b: { x: 144, y: 0 }, distancePt: 144, dxPt: 144, dyPt: 0, screenPx: 200 }));
    dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByTestId("calibrate-picked")).toHaveTextContent(`${(144 * MM_PER_POINT).toFixed(1)} mm on paper`);
    act(() => calibrateStore.setState({ distanceUnit: "ft-in", unit: "ft-in", precision: "1/8" }));
    await user.type(within(dialog).getByTestId("calibrate-distance"), `12'-6"`);
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    const c = calibrations()[`${SHA}:0`];
    expect(c).toMatchObject({ source: "points", unit: "ft-in", precision: "1/8" });
    expect(c.xFactor).toBeCloseTo((150 * 25.4) / 144, 9);
    // The unit and precision are the user's defaults from now on.
    expect(calibrationPrefs.getState()).toEqual({ unit: "ft-in", precision: "1/8" });
  });

  it("a separate vertical scale sets Y (AC 3)", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.type(within(dialog).getByTestId("calibrate-ratio"), "1:100");
    await user.click(within(dialog).getByRole("button", { name: "Different vertical scale" }));
    await user.type(within(dialog).getByTestId("calibrate-y-ratio"), "1:50");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    const c = calibrations()[`${SHA}:0`];
    expect(c.yFactor).toBeCloseTo(factorForRatio(50), 9);
    expect(c.yRatio).toBe(50);
  });

  it("review R3: opening Calibrate again while picking abandons the pick; a stale pick's answer is ignored", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.click(within(dialog).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    const first = listener!;
    // The ScaleIndicator (or a menu) is still reachable while picking.
    act(() => openCalibrate());
    expect(listener).toBeNull(); // the engine's pick was cancelled
    expect(calibrateStore.getState()).toMatchObject({ open: true, picking: false });
    await user.click(within(await screen.findByRole("dialog")).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    // The first pick answering late changes nothing.
    act(() => first.done(null));
    act(() => first.done({ a: { x: 0, y: 0 }, b: { x: 72, y: 0 }, distancePt: 72, dxPt: 72, dyPt: 0, screenPx: 100 }));
    expect(calibrateStore.getState()).toMatchObject({ picking: true, pick: null });
    expect(screen.getByRole("status")).toHaveTextContent("Click the first point");
  });

  it("review R4: another page shown while the dialog is open moves it to that page and drops the pick", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.click(within(dialog).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    act(() => listener!.done({ a: { x: 0, y: 0 }, b: { x: 72, y: 0 }, distancePt: 72, dxPt: 72, dyPt: 0, screenPx: 100 }));
    expect(calibrateStore.getState().pick).not.toBeNull();
    act(() => viewerStore.setState({ pageIndex: 1 }));
    const moved = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(moved).toHaveAccessibleDescription(/^Page 2 of 3/);
    expect(calibrateStore.getState()).toMatchObject({ pageIndex: 1, pick: null });
    expect(within(moved).getByRole("combobox", { name: "Apply to" })).toHaveTextContent("This page (2)");
  });

  it("review R6: the first-use tip stays for the whole first session, also after a pick", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    let dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByTestId("tip-calibrate")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    act(() => listener!.done({ a: { x: 0, y: 0 }, b: { x: 72, y: 0 }, distancePt: 72, dxPt: 72, dyPt: 0, screenPx: 100 }));
    dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(within(dialog).getByTestId("tip-calibrate")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Dismiss tip" }));
    expect(within(dialog).queryByTestId("tip-calibrate")).toBeNull();
    act(() => closeCalibrate());
    act(() => openCalibrate());
    expect(within(await screen.findByRole("dialog")).queryByTestId("tip-calibrate")).toBeNull();
  });

  it("review R7 and R9: metres type the distance in m; a vertical ratio names the sheet it is stated for", async () => {
    const user = userEvent.setup();
    calibrationPrefs.setState({ unit: "m", precision: "0.00" }, true);
    wrap();
    act(() => openCalibrate());
    expect(calibrateStore.getState().distanceUnit).toBe("m");
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    act(() => viewerStore.setState({ pageIndex: 0 }));
    await user.type(within(dialog).getByTestId("calibrate-ratio"), "1:100 @ A3");
    await user.click(within(dialog).getByRole("button", { name: "Different vertical scale" }));
    await user.type(within(dialog).getByTestId("calibrate-y-ratio"), "1:50");
    expect(within(dialog).getByTestId("calibrate-y-note")).toHaveTextContent("Stated for A3 like the ratio: 1:25 on this page");
  });
});
