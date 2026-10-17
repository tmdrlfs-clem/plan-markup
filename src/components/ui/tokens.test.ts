// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THEME,
  getTheme,
  readCanvasTokens,
  setTheme,
  subscribeCanvasTokens,
} from "./tokens";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.documentElement.setAttribute("data-theme", "blueprint");
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("readCanvasTokens", () => {
  it("returns the values defined on the element", () => {
    const el = document.documentElement;
    const vars: Record<string, string> = {
      "--accent": "#ff7a1a",
      "--canvas-selection-outline": "#1a0e05",
      "--canvas-halo": "#ffffff",
      "--canvas-snap": "#2563c9",
      "--canvas-danger": "#c8243a",
      "--warning": "#f2d24b",
      "--success": "#3fbf7f",
      "--canvas-coverage-fill": "rgba(108, 168, 255, 0.18)",
      "--canvas-coverage-outline": "#6ca8ff",
      "--canvas-zone": "#8b7fd1",
      "--surface-0": "#10151c",
      "--canvas-handle-size": "8px",
    };
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    const tokens = readCanvasTokens(el);
    expect(tokens.selection).toBe("#ff7a1a");
    expect(tokens.selectionOutline).toBe("#1a0e05");
    expect(tokens.halo).toBe("#ffffff");
    expect(tokens.snap).toBe("#2563c9");
    expect(tokens.danger).toBe("#c8243a");
    expect(tokens.warning).toBe("#f2d24b");
    expect(tokens.success).toBe("#3fbf7f");
    expect(tokens.coverageFill).toBe("rgba(108, 168, 255, 0.18)");
    expect(tokens.coverageOutline).toBe("#6ca8ff");
    expect(tokens.zoneOutline).toBe("#8b7fd1");
    expect(tokens.surround).toBe("#10151c");
    expect(tokens.handleSize).toBe(8);
  });

  it("falls back to an 8 px handle when the variable is missing", () => {
    expect(readCanvasTokens().handleSize).toBe(8);
  });
});

describe("theme subscription", () => {
  it("notifies once per theme change", async () => {
    const cb = vi.fn();
    const off = subscribeCanvasTokens(cb);
    setTheme("daylight");
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    setTheme("contrast");
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(getTheme()).toBe("contrast");
    off();
  });

  it("shares one observer across subscribers and reads fresh tokens", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeCanvasTokens(a);
    const offB = subscribeCanvasTokens(b);
    document.documentElement.style.setProperty("--accent", "#123456");
    setTheme("daylight");
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].selection).toBe("#123456");
    offA();
    offB();
  });

  it("stops notifying after unsubscribe", async () => {
    const cb = vi.fn();
    const off = subscribeCanvasTokens(cb);
    off();
    setTheme("daylight");
    await flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores unrelated attribute changes and defaults to blueprint", async () => {
    const cb = vi.fn();
    const off = subscribeCanvasTokens(cb);
    document.documentElement.setAttribute("lang", "en");
    await flush();
    expect(cb).not.toHaveBeenCalled();
    document.documentElement.removeAttribute("data-theme");
    expect(getTheme()).toBe(DEFAULT_THEME);
    off();
  });
});
