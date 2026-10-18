import { describe, expect, it } from "vitest";

import {
  defaultLayout,
  loadLayout,
  parseLayout,
  saveLayout,
  serializeLayout,
  storageKey,
} from "./layout-persistence";
import { createLayoutStore, layoutOf } from "./layout-store";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const throwing: Storage = {
  length: 0,
  clear() {},
  key: () => null,
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
  removeItem() {},
};

describe("defaultLayout (UX-DR37)", () => {
  it.each([
    [1920, 1080, false, false],
    [1440, 900, false, false],
    [1366, 768, true, true],
    [1280, 720, true, true],
    [1920, 760, false, true],
  ])("%i x %i: left collapsed %s, bottom collapsed %s", (width, height, left, bottom) => {
    const layout = defaultLayout({ width, height });
    expect(layout.left.collapsed).toBe(left);
    expect(layout.bottom.collapsed).toBe(bottom);
    expect(layout.left).toMatchObject({ size: 280, active: "tool-chest" });
    expect(layout.bottom.size).toBe(200);
  });
});

describe("parseLayout", () => {
  const fallback = defaultLayout({ width: 1920, height: 1080 });

  it("round-trips a saved layout", () => {
    const layout = {
      left: { collapsed: true, size: 333, active: "layers" as const },
      bottom: { collapsed: false, size: 250 },
    };
    expect(parseLayout(serializeLayout(layout), fallback)).toEqual(layout);
  });

  it.each([
    ["missing", null],
    ["corrupt JSON", "{nope"],
    ["wrong version", JSON.stringify({ v: 2, left: {}, bottom: {} })],
    ["wrong shape", JSON.stringify({ v: 1, left: { collapsed: "no" }, bottom: {} })],
  ])("returns null when %s", (_name, raw) => {
    expect(parseLayout(raw, fallback)).toBeNull();
  });

  it("clamps sizes and replaces an unknown active panel", () => {
    const raw = JSON.stringify({
      v: 1,
      left: { collapsed: false, size: 9000, active: "gone" },
      bottom: { collapsed: false, size: 10 },
    });
    expect(parseLayout(raw, fallback)).toEqual({
      left: { collapsed: false, size: 420, active: "tool-chest" },
      bottom: { collapsed: false, size: 120 },
    });
  });
});

describe("loadLayout / saveLayout", () => {
  const viewport = { width: 1366, height: 768 };

  it("stores per user", () => {
    const storage = memoryStorage();
    const layout = defaultLayout({ width: 1920, height: 1080 });
    saveLayout(storage, "u1", layout);
    expect(storage.getItem(storageKey("u1"))).not.toBeNull();
    expect(loadLayout(storage, "u1", viewport)).toEqual(layout);
    expect(loadLayout(storage, "u2", viewport)).toEqual(defaultLayout(viewport));
  });

  it("falls back to the defaults when storage throws or is missing", () => {
    expect(loadLayout(throwing, "u1", viewport)).toEqual(defaultLayout(viewport));
    expect(loadLayout(undefined, "u1", viewport)).toEqual(defaultLayout(viewport));
    expect(() => saveLayout(throwing, "u1", defaultLayout(viewport))).not.toThrow();
  });
});

describe("layout store", () => {
  it("showLeftPanel opens, switches, and collapses the active open panel", () => {
    const store = createLayoutStore();
    const { showLeftPanel } = store.getState();
    expect(store.getState().left.collapsed).toBe(true);
    showLeftPanel("layers");
    expect(store.getState().left).toMatchObject({ collapsed: false, active: "layers" });
    showLeftPanel("properties");
    expect(store.getState().left).toMatchObject({ collapsed: false, active: "properties" });
    showLeftPanel("properties");
    expect(store.getState().left).toMatchObject({ collapsed: true, active: "properties" });
  });

  it("clamps sizes and hides all panels", () => {
    const store = createLayoutStore(defaultLayout({ width: 1920, height: 1080 }));
    store.getState().setLeftSize(100);
    store.getState().setBottomSize(9999);
    expect(layoutOf(store.getState())).toMatchObject({ left: { size: 220 }, bottom: { size: 480 } });
    store.getState().hideAllPanels();
    expect(store.getState().left.collapsed).toBe(true);
    expect(store.getState().bottom.collapsed).toBe(true);
  });
});
