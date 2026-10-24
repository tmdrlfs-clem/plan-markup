// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { factorForRatio, factorFromPoints, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { clearUndo } from "@/features/editor";
import { tipsStore } from "@/features/tips";
import { INITIAL_VIEWER_STATE } from "@/features/viewer/viewer-store";
import { registerViewerEngine, type ViewerCommandTarget } from "@/features/viewer/viewer-commands";
import { viewerStore, type CalibrationPick, type CalibrationPickListener } from "@/features/viewer";

import { CalibrateDialog } from "./calibrate-dialog";
import { calibrateStore, closeCalibrate, openCalibrate } from "./calibrate-store";
import { VerifyDialog } from "./verify-dialog";
import { closeVerify, openVerify, verifyStore } from "./verify-store";

const MM = 72 / 25.4;
const A1 = { width: 841 * MM, height: 594 * MM, rotate: 0 };
const SHA = "e".repeat(64);
const AT_100: Calibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100, sheet: null };

let listener: CalibrationPickListener | null = null;
let cleared = 0;
const engine: ViewerCommandTarget = {
  zoomStep: () => undefined,
  fitPage: () => undefined,
  fitWidth: () => undefined,
  rotate: () => undefined,
  goToPage: () => undefined,
  currentPage: 0,
  pageCount: 2,
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
  clearCalibrationLine: () => void cleared++,
};
let unregister = () => undefined as void;

/** A horizontal pick `pt` points long. */
const line = (pt: number, screenPx = 200): CalibrationPick => ({ a: { x: 0, y: 0 }, b: { x: pt, y: 0 }, distancePt: pt, dxPt: pt, dyPt: 0, screenPx });

beforeEach(() => {
  viewerStore.setState(
    {
      ...INITIAL_VIEWER_STATE,
      status: "ready",
      pageCount: 2,
      pages: [A1, A1],
      pageIndex: 0,
      documentId: SHA,
      tabId: "doc-1",
      calibrations: { [pageIdOf(SHA, 0)]: AT_100 },
    },
    true,
  );
  tipsStore.setState({ seen: ["calibrate"], loaded: true }, true);
  unregister = registerViewerEngine(engine);
  cleared = 0;
});

afterEach(() => {
  act(() => {
    closeVerify();
    closeCalibrate();
  });
  unregister();
  clearUndo();
  listener = null;
});

const wrap = () =>
  render(
    <TooltipProvider delayDuration={0}>
      <CalibrateDialog />
      <VerifyDialog />
    </TooltipProvider>,
  );

async function pick(user: ReturnType<typeof userEvent.setup>, result: CalibrationPick) {
  await user.click(within(screen.getByRole("dialog", { name: "Verify calibration" })).getByRole("button", { name: "Pick two points" }));
  expect(screen.getByRole("status")).toHaveTextContent("Click the first point · Esc to cancel");
  act(() => listener!.step(2));
  act(() => listener!.done(result));
  return screen.findByRole("dialog", { name: "Verify calibration" });
}

describe("VerifyDialog (Story 4.4)", () => {
  it("opens only on a calibrated page; names the page and its scale", async () => {
    wrap();
    act(() => viewerStore.setState({ pageIndex: 1 }));
    act(() => openVerify());
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 0 }));
    act(() => openVerify());
    expect(await screen.findByRole("dialog", { name: "Verify calibration" })).toHaveAccessibleDescription("Page 1 of 2 · Scale 1:100");
  });

  it("a known distance that matches: Matches, Keep is the primary and changes nothing", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openVerify());
    let dialog = await screen.findByRole("dialog", { name: "Verify calibration" });
    // Typed before picking.
    await user.type(within(dialog).getByTestId("verify-known"), "7056");
    dialog = await pick(user, line(200));
    expect(within(dialog).getByTestId("verify-row-measured")).toHaveTextContent("7056 mm");
    expect(within(dialog).getByTestId("verify-row-difference")).toHaveTextContent("0 mm (-0.01 %)");
    expect(within(dialog).getByTestId("verify-verdict")).toHaveAttribute("data-verdict", "matches");
    expect(within(dialog).getByTestId("verify-verdict")).toHaveTextContent("Matches the calibration at the shown precision (1 mm)");
    const before = viewerStore.getState().calibrations;
    // Enter = Keep.
    await user.click(within(dialog).getByTestId("verify-known"));
    await user.keyboard("{Enter}");
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(viewerStore.getState().calibrations).toBe(before);
    expect(cleared).toBeGreaterThan(0); // the picked line is cleared
  });

  it("a known distance that is off: the signed difference and percentage; Recalibrate… opens Calibrate prefilled", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openVerify());
    await screen.findByRole("dialog", { name: "Verify calibration" });
    let dialog = await pick(user, line(200));
    expect(within(dialog).getByTestId("verify-result")).toHaveTextContent("Type the known distance to compare.");
    await user.type(within(dialog).getByTestId("verify-known"), "7000");
    dialog = screen.getByRole("dialog", { name: "Verify calibration" });
    expect(within(dialog).getByTestId("verify-verdict")).toHaveTextContent("Off by +56 mm (+0.79 %)");
    expect(within(dialog).getByTestId("verify-verdict")).toHaveAttribute("data-verdict", "off");
    await user.click(within(dialog).getByRole("button", { name: "Recalibrate…" }));
    const calibrate = await screen.findByRole("dialog", { name: "Calibrate" });
    expect(screen.queryByRole("dialog", { name: "Verify calibration" })).toBeNull();
    expect(calibrateStore.getState()).toMatchObject({ method: "points", distanceText: "7000", distanceUnit: "mm" });
    expect(within(calibrate).getByTestId("calibrate-picked")).toHaveTextContent("(200.0 pt)");
    expect(within(calibrate).getByTestId("calibrate-distance")).toHaveValue("7000");
    await user.click(within(calibrate).getByRole("button", { name: "Apply" }));
    expect(viewerStore.getState().calibrations[pageIdOf(SHA, 0)].xFactor).toBeCloseTo(factorFromPoints(200, 7000), 9);
  });

  it("ft-in known distances, an unreadable one shows an error; too close and Esc while picking", async () => {
    const user = userEvent.setup();
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: { ...AT_100, unit: "ft-in", precision: "1/8" } } });
    wrap();
    act(() => openVerify());
    let dialog = await screen.findByRole("dialog", { name: "Verify calibration" });
    expect(verifyStore.getState().knownUnit).toBe("ft-in");
    await user.click(within(dialog).getByRole("button", { name: "Pick two points" }));
    // Esc (the engine cancels): the dialog comes back.
    act(() => engine.cancelCalibrationPick!());
    await screen.findByRole("dialog", { name: "Verify calibration" });
    dialog = await pick(user, line(3, 6));
    expect(within(dialog).getByTestId("verify-pick-error")).toHaveTextContent("too close");
    dialog = await pick(user, line(200));
    await user.type(within(dialog).getByTestId("verify-known"), "abc");
    expect(within(dialog).getByText(`Enter a distance like 4.6 m or 12'-6"`)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Recalibrate…" })).toBeDisabled();
    await user.clear(within(dialog).getByTestId("verify-known"));
    await user.type(within(dialog).getByTestId("verify-known"), `23'-1 3/4"`);
    expect(within(dialog).getByTestId("verify-row-measured")).toHaveTextContent(`23'-1 3/4"`);
    expect(within(dialog).getByTestId("verify-verdict")).toHaveAttribute("data-verdict", "matches");
  });

  it("follows the shown page; a page without a calibration closes it; Calibrate opening closes it", async () => {
    const user = userEvent.setup();
    viewerStore.setState({
      calibrations: { [pageIdOf(SHA, 0)]: AT_100, [pageIdOf(SHA, 1)]: { ...AT_100, xFactor: factorForRatio(50), yFactor: factorForRatio(50), ratio: 50 } },
    });
    wrap();
    act(() => openVerify());
    await screen.findByRole("dialog", { name: "Verify calibration" });
    await pick(user, line(200));
    act(() => viewerStore.setState({ pageIndex: 1 }));
    expect(await screen.findByRole("dialog", { name: "Verify calibration" })).toHaveAccessibleDescription("Page 2 of 2 · Scale 1:50");
    expect(verifyStore.getState()).toMatchObject({ pageIndex: 1, pick: null });
    act(() => viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: AT_100 } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 0 }));
    act(() => openVerify());
    await screen.findByRole("dialog", { name: "Verify calibration" });
    act(() => openCalibrate());
    expect(await screen.findByRole("dialog", { name: "Calibrate" })).toBeInTheDocument();
    expect(verifyStore.getState().open).toBe(false);
  });

  it("opening Verify while Calibrate is picking abandons that pick", async () => {
    const user = userEvent.setup();
    wrap();
    act(() => openCalibrate());
    const dialog = await screen.findByRole("dialog", { name: "Calibrate" });
    await user.click(within(dialog).getByRole("tab", { name: "By two points" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick two points" }));
    const stale = listener!;
    act(() => openVerify());
    expect(calibrateStore.getState()).toMatchObject({ open: false, picking: false });
    expect(await screen.findByRole("dialog", { name: "Verify calibration" })).toBeInTheDocument();
    act(() => stale.done(line(100)));
    expect(calibrateStore.getState().pick).toBeNull();
    expect(verifyStore.getState().pick).toBeNull();
  });
});
