import { afterEach, describe, expect, it, vi } from "vitest";

import { cursorStore, setCursor } from "./cursor-store";
import { SCALE_NOT_SET, scaleStateOf } from "./scale-state";

afterEach(() => cursorStore.setState({ point: null }));

describe("cursor store", () => {
  it("notifies only when the point changes", () => {
    const seen = vi.fn();
    const off = cursorStore.subscribe(seen);
    setCursor({ x: 1, y: 2 });
    setCursor({ x: 1, y: 2 });
    setCursor(null);
    setCursor(null);
    off();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("scale state", () => {
  it("is 'not set' on every page until calibration exists (Epic 4)", () => {
    expect(scaleStateOf()).toBe(SCALE_NOT_SET);
    expect(scaleStateOf()).toEqual({ kind: "not-set" });
  });
});
