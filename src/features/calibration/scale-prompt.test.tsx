// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { factorForRatio, pageIdOf } from "@/core/calibration/calibration";
import type { DetectedScale, PageScales } from "@/core/scale/detect";
import { activeUndoLabels, clearUndo, editorStore, undoActive } from "@/features/editor";
import { INITIAL_VIEWER_STATE } from "@/features/viewer/viewer-store";
import { setTool, viewerStore } from "@/features/viewer";

import { applyCalibration, calibrateStore, closeCalibrate } from "./calibrate-store";
import { DEFAULT_CALIBRATION_PREFS, calibrationPrefs } from "./calibration-prefs";
import { ScalePrompt } from "./scale-prompt";
import { applyDetectedScale, dismissScalePrompt, needsScale, resetScalePrompt, scalePromptFor } from "./scale-prompt-store";
import { closeVerify, verifyStore } from "./verify-store";

const MM = 72 / 25.4;
const A1 = { width: 841 * MM, height: 594 * MM, rotate: 0 };
const A3 = { width: 420 * MM, height: 297 * MM, rotate: 0 };
const SHA = "a".repeat(64);
const scale = (over: Partial<DetectedScale>): DetectedScale => ({
  ratio: 100,
  sheet: "A1",
  effective: 100,
  imperial: false,
  text: "SCALE 1:100 @ A1",
  count: 1,
  quads: [],
  conflict: false,
  readings: [],
  ...over,
});
const ONE: PageScales = { pageSheet: "A1", scales: [scale({})] };
// The same text on an A3 page: 1:200 there.
const CONVERTED: PageScales = { pageSheet: "A3", scales: [scale({ effective: 200 })] };
const NONE: PageScales = { pageSheet: "A1", scales: [] };
const MIXED: PageScales = { pageSheet: "A1", scales: [scale({ ratio: 50, effective: 50 }), scale({})] };
const DISAGREE: PageScales = {
  pageSheet: "A1",
  scales: [
    scale({
      ratio: 75,
      effective: 75,
      text: "1 : 75 @ A1",
      conflict: true,
      readings: [
        { ratio: 75, sheet: "A1", effective: 75, text: "1 : 75 @ A1" },
        { ratio: 200, sheet: "A3", effective: 100, text: "1 : 200 @ A3" },
      ],
    }),
  ],
};

beforeEach(() => {
  viewerStore.setState(
    {
      ...INITIAL_VIEWER_STATE,
      status: "ready",
      pageCount: 5,
      pages: [A1, A3, A1, A1, A1],
      pageIndex: 0,
      documentId: SHA,
      tabId: "doc-1",
      pageScales: { 0: ONE, 1: CONVERTED, 2: MIXED, 3: NONE, 4: DISAGREE },
    },
    true,
  );
  calibrationPrefs.setState(DEFAULT_CALIBRATION_PREFS, true);
  resetScalePrompt();
});

afterEach(() => {
  act(() => {
    closeCalibrate();
    closeVerify();
    setTool("select");
  });
  clearUndo();
});

const prompt = (dialogs = { calibrate: false, verify: false }) => scalePromptFor(viewerStore.getState(), dialogs, {});

describe("scalePromptFor (Story 4.7)", () => {
  it("only while a measuring tool is armed on a page with no scale", () => {
    expect(needsScale("length")).toBe(true);
    expect(needsScale("polylength")).toBe(true);
    expect(needsScale("select")).toBe(false);
    expect(needsScale("calibrate")).toBe(false);
    expect(prompt()).toBeNull(); // Select
    setTool("length");
    expect(prompt()).toMatchObject({ pageIndex: 0, state: { kind: "detected", label: "1:100 @ A1" } });
    // A calibration, Calibrate or Verify open, or no drawing: no prompt.
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 } } });
    expect(prompt()).toBeNull();
    viewerStore.setState({ calibrations: {} });
    expect(prompt({ calibrate: true, verify: false })).toBeNull();
    expect(prompt({ calibrate: false, verify: true })).toBeNull();
    expect(scalePromptFor({ ...viewerStore.getState(), status: "error" }, { calibrate: false, verify: false }, {})).toBeNull();
    expect(scalePromptFor(viewerStore.getState(), { calibrate: false, verify: false }, { [pageIdOf(SHA, 0)]: true })).toBeNull();
  });

  it("offers the detected scale only when there is exactly one that agrees with itself", () => {
    setTool("polylength");
    expect(prompt()!.detected).toMatchObject({ ratio: 100, sheet: "A1" });
    viewerStore.setState({ pageIndex: 1 });
    expect(prompt()).toMatchObject({ state: { kind: "detected", label: "1:200 (1:100 @ A1)" } });
    viewerStore.setState({ pageIndex: 2 });
    expect(prompt()).toMatchObject({ state: { kind: "mixed", count: 2 }, detected: null });
    viewerStore.setState({ pageIndex: 3 });
    expect(prompt()).toMatchObject({ state: { kind: "not-set" }, detected: null });
    viewerStore.setState({ pageIndex: 4 });
    expect(prompt()).toMatchObject({ state: { kind: "conflict" }, detected: null });
    // Not read yet: pending.
    viewerStore.setState({ pageIndex: 0, pageScales: {} });
    expect(prompt()).toMatchObject({ state: { kind: "not-set", pending: true }, detected: null });
  });
});

describe("Use it and dismiss (Story 4.7)", () => {
  it("Use it calibrates the shown page as the dialog's detected button does: one undo step", () => {
    setTool("length");
    viewerStore.setState({ pageIndex: 1 });
    expect(applyDetectedScale()).toBe(true);
    const c = viewerStore.getState().calibrations[pageIdOf(SHA, 1)];
    // "1:100 @ A1" on an A3 page: 1:200 there.
    expect(c).toMatchObject({ unit: "mm", precision: "0" });
    expect(c.xFactor).toBeCloseTo(factorForRatio(200), 9);
    expect(prompt()).toBeNull();
    expect(activeUndoLabels(editorStore.getState(), "doc-1").undo).toBe("Calibrate page 2");
    undoActive();
    expect(viewerStore.getState().calibrations[pageIdOf(SHA, 1)]).toBeUndefined();
    // Nothing to use on a page without one detected scale.
    viewerStore.setState({ pageIndex: 3 });
    expect(applyDetectedScale()).toBe(false);
  });

  it("dismissing lasts for that page only", () => {
    setTool("length");
    dismissScalePrompt();
    render(<ScalePrompt />);
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 3 }));
    expect(screen.getByTestId("scale-prompt")).toHaveAttribute("data-state", "not-set");
    act(() => viewerStore.setState({ pageIndex: 0 }));
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
  });
});

describe("ScalePrompt (Story 4.7)", () => {
  const setup = () =>
    render(
      <TooltipProvider>
        <ScalePrompt />
      </TooltipProvider>,
    );

  it("shows the detected scale with Use it and Calibrate…, without taking the focus", async () => {
    const user = userEvent.setup();
    const before = document.activeElement;
    setup();
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => setTool("length"));
    const region = screen.getByRole("region", { name: "Scale not set" });
    expect(region).toHaveTextContent("Detected 1:100 @ A1");
    expect(region).toHaveTextContent("Measurements show “Scale not set” until the page has a scale.");
    expect(screen.getByRole("status")).toHaveTextContent("Detected 1:100 @ A1");
    expect(document.activeElement).toBe(before);
    await user.click(screen.getByRole("button", { name: "Use it" }));
    expect(viewerStore.getState().calibrations[pageIdOf(SHA, 0)]).toBeDefined();
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
  });

  it("offers only Calibrate… without one detected scale, says why, and hides while a dialog is open", async () => {
    const user = userEvent.setup();
    setup();
    act(() => {
      setTool("polylength");
      viewerStore.setState({ pageIndex: 3 });
    });
    expect(screen.getByTestId("scale-prompt")).toHaveTextContent("No scale found on this page");
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 4 }));
    expect(screen.getByTestId("scale-prompt")).toHaveTextContent("Printed scales disagree");
    act(() => viewerStore.setState({ pageIndex: 2 }));
    expect(screen.getByTestId("scale-prompt")).toHaveTextContent("2 scales on page");
    act(() => viewerStore.setState({ pageScales: {} }));
    expect(screen.getByTestId("scale-prompt")).toHaveTextContent("Reading the drawing’s scale…");
    act(() => verifyStore.setState({ open: true }));
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => verifyStore.setState({ open: false }));
    await user.click(screen.getByRole("button", { name: "Calibrate…" }));
    expect(calibrateStore.getState().open).toBe(true);
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    // Founder decision: cancelled (still no scale), it stays away on that page; other pages still prompt.
    act(() => closeCalibrate());
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 3 }));
    expect(screen.getByTestId("scale-prompt")).toBeInTheDocument();
  });

  it("Calibrate… applied: the page has a scale, nothing is dismissed (undoing it prompts again)", async () => {
    const user = userEvent.setup();
    setup();
    act(() => setTool("length"));
    await user.click(screen.getByRole("button", { name: "Calibrate…" }));
    act(() => {
      applyCalibration({ kind: "ratio", ratio: 50, sheet: null }, [0], DEFAULT_CALIBRATION_PREFS);
      closeCalibrate();
    });
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => {
      undoActive();
    });
    expect(screen.getByTestId("scale-prompt")).toBeInTheDocument();
  });

  it("review R1: the dialog closed by another tab dismisses nothing", async () => {
    const user = userEvent.setup();
    setup();
    act(() => setTool("length"));
    await user.click(screen.getByRole("button", { name: "Calibrate…" }));
    act(() => {
      viewerStore.setState({ documentId: "b".repeat(64), tabId: "doc-2" });
      closeCalibrate();
      viewerStore.setState({ documentId: SHA, tabId: "doc-1" });
    });
    expect(screen.getByTestId("scale-prompt")).toBeInTheDocument();
  });

  it("× hides it for the page; another tool hides it too", async () => {
    const user = userEvent.setup();
    setup();
    act(() => setTool("length"));
    await user.click(screen.getByRole("button", { name: "Measure without scale" }));
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
    act(() => viewerStore.setState({ pageIndex: 3 }));
    expect(screen.getByTestId("scale-prompt")).toBeInTheDocument();
    act(() => setTool("pan"));
    expect(screen.queryByTestId("scale-prompt")).toBeNull();
  });
});
