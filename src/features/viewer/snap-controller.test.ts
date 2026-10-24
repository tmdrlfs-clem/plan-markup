import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEG_END_POINT, SEG_START_POINT, SEG_STRAIGHT } from "@/core/snap/extract";
import { buildSnapIndex } from "@/core/snap/index";
import type { SnapIndexResult } from "@/workers/render-protocol";

import { SnapController, clearSnapCache, extraSnapSources, isSnappingTool, snapCacheBytes } from "./snap-controller";

const LINE = SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT;
const result = (x: number): SnapIndexResult => ({
  ...buildSnapIndex({ coords: new Float64Array([x, 0, x + 10, 0]), flags: new Uint8Array([LINE]), count: 1, truncated: false }),
  opListMs: 1,
  extractMs: 1,
  buildMs: 1,
});

type Pending = { page: number; resolve: (r: SnapIndexResult) => void; reject: (e: unknown) => void; cancel: ReturnType<typeof vi.fn> };

function setup() {
  const calls: Pending[] = [];
  const request = (page: number) => {
    let resolve!: (r: SnapIndexResult) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<SnapIndexResult>((res, rej) => ((resolve = res), (reject = rej)));
    const cancel = vi.fn(() => reject(new Error("cancelled")));
    calls.push({ page, resolve, reject, cancel });
    return { promise, cancel };
  };
  const ready = vi.fn();
  const snap = new SnapController(request, ready);
  return { snap, calls, ready };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearSnapCache();
  extraSnapSources.markup = null;
  extraSnapSources.grid = null;
});

describe("SnapController", () => {
  it("builds the current page, then its neighbours one at a time; keeps them per document in a shared cache", async () => {
    const { snap, calls, ready } = setup();
    snap.setDocument("doc");
    snap.ensure(4, 10);
    snap.ensure(4, 10); // already building: nothing new
    expect(calls.map((c) => c.page)).toEqual([5]);
    calls[0].resolve(result(0));
    await flush();
    expect(ready).toHaveBeenCalledWith(4);
    expect(calls.map((c) => c.page)).toEqual([5, 6]);
    calls[1].resolve(result(0));
    await flush();
    expect(calls.map((c) => c.page)).toEqual([5, 6, 4]);
    calls[2].resolve(result(0));
    await flush();
    expect([snap.has(3), snap.has(4), snap.has(5)]).toEqual([true, true, true]);
    expect(snapCacheBytes()).toBeGreaterThan(0);
    // Another tab of the same document shares them.
    const other = setup();
    other.snap.setDocument("doc");
    other.snap.ensure(4, 10);
    expect(other.calls).toHaveLength(0);
  });

  it("cancel stops the build (asked again later); a failed page is not retried this session", async () => {
    const { snap, calls } = setup();
    snap.setDocument("doc");
    snap.ensure(0, 1);
    snap.cancel();
    expect(calls[0].cancel).toHaveBeenCalled();
    await flush();
    snap.ensure(0, 1);
    expect(calls).toHaveLength(2);
    calls[1].reject(new Error("render-failed"));
    await flush();
    snap.ensure(0, 1);
    expect(calls).toHaveLength(2);
    expect(snap.building).toBe(0);
  });

  it("resolves with the enabled sources only", async () => {
    const { snap, calls } = setup();
    snap.setDocument("doc");
    snap.ensure(0, 1);
    calls[0].resolve(result(0));
    await flush();
    const near = { x: 0.5, y: 0.5 };
    expect(snap.resolve(0, near, 2, null, { content: true, markup: true, grid: false })).toMatchObject({ type: "endpoint", x: 0, y: 0 });
    expect(snap.resolve(0, near, 2, null, { content: false, markup: true, grid: true })).toBeNull();
    extraSnapSources.markup = { near: () => [{ ax: 1, ay: 1, bx: 5, by: 5, flags: LINE }] };
    expect(snap.resolve(0, near, 2, null, { content: false, markup: true, grid: false })).toMatchObject({ type: "endpoint", x: 1, y: 1 });
    expect(snap.resolve(0, near, 2, null, { content: false, markup: false, grid: false })).toBeNull();
    expect(snap.stats(0)).toMatchObject({ count: 1, truncated: false });
  });

  it("only drawing and measuring tools snap", () => {
    expect(isSnappingTool("length")).toBe(true);
    expect(["select", "pan", "zoom"].some((t) => isSnappingTool(t as "select"))).toBe(false);
  });
});
