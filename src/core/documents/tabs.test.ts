import { describe, expect, it } from "vitest";

import {
  BACKGROUND_TILE_BUDGET,
  MAX_TABS,
  TOTAL_TILE_BUDGET,
  activeAfterClose,
  cycleTab,
  fileKeyOf,
  findDuplicate,
  resolveTabKey,
  tileBudgets,
} from "./tabs";

const key = (over: Partial<Parameters<typeof resolveTabKey>[0]> & { key: string }) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("document tabs", () => {
  const tabs = [
    { id: "a", sha256: "s1", fileKey: "a.pdf|10|1" },
    { id: "b", sha256: null, fileKey: "b.pdf|20|2" },
  ];

  it("finds the tab of the same document by sha256, or by file key before hashing", () => {
    expect(findDuplicate(tabs, { sha256: "s1" })?.id).toBe("a");
    expect(findDuplicate(tabs, { fileKey: "b.pdf|20|2" })?.id).toBe("b");
    expect(findDuplicate(tabs, { sha256: "s2", fileKey: "c.pdf|1|1" })).toBeNull();
    // The asking tab itself does not count.
    expect(findDuplicate(tabs, { sha256: "s1" }, "a")).toBeNull();
    expect(fileKeyOf({ name: "x.pdf", size: 3, lastModified: 7 })).toBe("x.pdf|3|7");
  });

  it("closing the active tab activates the right neighbour, else the left; others keep the active tab", () => {
    expect(activeAfterClose(["a", "b", "c"], "b", "b")).toBe("c");
    expect(activeAfterClose(["a", "b", "c"], "c", "c")).toBe("b");
    expect(activeAfterClose(["a", "b", "c"], "a", "c")).toBe("a");
    expect(activeAfterClose(["a"], "a", "a")).toBeNull();
    expect(activeAfterClose(["a"], "a", "zz")).toBe("a");
  });

  it("cycles through the tabs, wrapping around", () => {
    expect(cycleTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(cycleTab(["a", "b", "c"], "a", -1)).toBe("c");
    expect(cycleTab(["a", "b"], null, 1)).toBe("a");
    expect(cycleTab([], null, 1)).toBeNull();
  });

  it("splits the tile budget: background tabs keep a small share, the active tab the rest", () => {
    expect(tileBudgets(1)).toEqual({ active: TOTAL_TILE_BUDGET, background: BACKGROUND_TILE_BUDGET });
    const full = tileBudgets(MAX_TABS);
    expect(full.active + (MAX_TABS - 1) * full.background).toBe(TOTAL_TILE_BUDGET);
    expect(full.active).toBeGreaterThan(TOTAL_TILE_BUDGET / 2);
  });

  it("maps the tab keys: Ctrl / Alt + PageDown / PageUp cycle, Ctrl+F4 closes", () => {
    expect(resolveTabKey(key({ key: "PageDown", ctrlKey: true }))).toEqual({ type: "cycle", direction: 1 });
    expect(resolveTabKey(key({ key: "PageUp", ctrlKey: true }))).toEqual({ type: "cycle", direction: -1 });
    expect(resolveTabKey(key({ key: "PageDown", altKey: true }))).toEqual({ type: "cycle", direction: 1 });
    expect(resolveTabKey(key({ key: "PageUp", metaKey: true }))).toEqual({ type: "cycle", direction: -1 });
    expect(resolveTabKey(key({ key: "F4", ctrlKey: true }))).toEqual({ type: "close" });
    // Plain PageDown is the canvas's page key; Ctrl+Alt and Shift combinations are not ours.
    expect(resolveTabKey(key({ key: "PageDown" }))).toBeNull();
    expect(resolveTabKey(key({ key: "PageDown", ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveTabKey(key({ key: "PageDown", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveTabKey(key({ key: "F4", altKey: true }))).toBeNull();
  });
});
