import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerViewerEngine, type ViewerCommandTarget } from "@/features/viewer/viewer-commands";
import type { CalibrationPick, CalibrationPickListener } from "@/features/viewer";

import { abandonPick, beginPick, picking, tooClose } from "./picking";

// Story 4.4 review V4: the two-point pick shared by Calibrate and Verify.
let listener: CalibrationPickListener | null = null;
let cancels = 0;
let focused = 0;
let cleared = 0;
const engine: ViewerCommandTarget = {
  zoomStep: () => undefined,
  fitPage: () => undefined,
  fitWidth: () => undefined,
  rotate: () => undefined,
  goToPage: () => undefined,
  currentPage: 0,
  pageCount: 1,
  focusCanvas: () => void focused++,
  startCalibrationPick: (l) => {
    listener = l;
    l.step(1);
  },
  cancelCalibrationPick: () => {
    cancels++;
    const l = listener;
    listener = null;
    l?.done(null);
  },
  clearCalibrationLine: () => void cleared++,
};
const pick = (screenPx: number): CalibrationPick => ({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distancePt: 10, dxPt: 10, dyPt: 0, screenPx });
let unregister = () => undefined as void;

beforeEach(() => {
  listener = null;
  cancels = focused = cleared = 0;
  unregister = registerViewerEngine(engine);
});
afterEach(() => {
  abandonPick();
  unregister();
});

describe("shared two-point pick (Stories 4.3, 4.4)", () => {
  it("starts on the canvas with the line cleared, reports steps and the result once", () => {
    const steps: number[] = [];
    const done: (CalibrationPick | null)[] = [];
    beginPick({ step: (n) => steps.push(n), done: (p) => done.push(p) });
    expect(picking()).toBe(true);
    expect(focused).toBe(1);
    expect(cleared).toBe(1);
    listener!.step(2);
    listener!.done(pick(50));
    listener!.done(pick(60)); // a second answer is ignored
    expect(steps).toEqual([1, 2]);
    expect(done).toHaveLength(1);
    expect(picking()).toBe(false);
  });

  it("abandoning cancels the engine's pick without its answer reaching anyone; a new pick abandons the old", () => {
    const first: unknown[] = [];
    beginPick({ step: () => undefined, done: (p) => first.push(p) });
    const old = listener!;
    const second: unknown[] = [];
    beginPick({ step: () => undefined, done: (p) => second.push(p) });
    expect(cancels).toBe(1);
    old.done(pick(50));
    expect(first).toEqual([]);
    abandonPick();
    expect(cancels).toBe(2);
    expect(second).toEqual([]);
    abandonPick(); // nothing in progress: no engine call
    expect(cancels).toBe(2);
  });

  it("without a drawing the pick ends at once with null", () => {
    unregister();
    const done: unknown[] = [];
    beginPick({ step: () => undefined, done: (p) => done.push(p) });
    expect(done).toEqual([null]);
    expect(picking()).toBe(false);
  });

  it("refuses picks under 10 CSS px", () => {
    expect(tooClose(pick(9.4))).toContain("too close (9 px)");
    expect(tooClose(pick(10))).toBeNull();
  });
});
