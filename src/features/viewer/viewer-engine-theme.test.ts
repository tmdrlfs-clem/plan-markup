// @vitest-environment jsdom
// Story 3.8 AC 1-2: a theme change recolours the canvas from the theme's tokens
// (re-read, not cached forever) and only redraws: no tile or preview is rendered again.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RenderClient } from "@/workers/rpc";

import { ViewerEngine, type ViewerCanvases } from "./viewer-engine";

afterEach(() => document.documentElement.setAttribute("data-theme", "blueprint"));

describe("ViewerEngine theme", () => {
  it("draws the backdrop in the theme's colour and re-reads it after a theme change, without new worker requests", async () => {
    const fills: string[] = [];
    const ctx = new Proxy(
      { fillStyle: "" } as Record<string, unknown>,
      {
        get: (target, key) => {
          if (key === "fillRect") return () => fills.push(String(target.fillStyle));
          if (key in target) return target[key as string];
          return () => undefined;
        },
        set: (target, key, value) => ((target[key as string] = value), true),
      },
    );
    const tiles = { width: 100, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const blank = { width: 100, height: 100, getContext: () => null } as unknown as HTMLCanvasElement;
    // The active canvas sits in the themed tree: its computed tokens are the theme's.
    const active = document.createElement("canvas");
    document.body.append(active);
    active.style.setProperty("--canvas-backdrop", "#111111");
    const request = vi.fn(() => ({ reqId: 1, promise: new Promise(() => undefined) }));
    const client = { request, cancel: vi.fn(), terminate: vi.fn() } as unknown as RenderClient;
    const frames: (() => void)[] = [];
    const canvases: ViewerCanvases = { tiles, markups: blank, active };
    const engine = new ViewerEngine(canvases, client, () => undefined, { requestFrame: (cb) => frames.push(cb), cancelFrame: () => undefined });
    engine.setViewport(100, 100, 1);
    frames.splice(0).forEach((f) => f());
    expect(fills.at(-1)).toBe("#111111");

    active.style.setProperty("--canvas-backdrop", "#222222");
    const before = request.mock.calls.length;
    document.documentElement.setAttribute("data-theme", "contrast");
    await new Promise((r) => setTimeout(r, 0)); // the MutationObserver
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((f) => f());
    expect(fills.at(-1)).toBe("#222222");
    expect(request.mock.calls.length).toBe(before);
    engine.destroy();
    active.remove();
  });
});
