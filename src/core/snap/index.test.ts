import { describe, expect, it } from "vitest";

import { SEG_END_POINT, SEG_START_POINT, SEG_STRAIGHT } from "./extract";
import { SnapIndex, buildSnapIndex, indexSource, snapIndexBytes, snapIndexTransfer } from "./index";

const segments = (list: number[][]) => ({
  coords: new Float64Array(list.flat()),
  flags: new Uint8Array(list.length).fill(SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT),
  count: list.length,
  truncated: false,
});

describe("snap index", () => {
  it("finds the segments near a point, nearest first, at most `limit`, through a copy of its buffer (as transferred)", () => {
    const data = buildSnapIndex(segments([[0, 0, 10, 0], [0, 5, 10, 5], [100, 100, 110, 100]]));
    const index = new SnapIndex({ ...data, index: data.index!.slice(0) });
    expect(index.near(5, 1, 3, 10)).toEqual([0]);
    expect(index.near(5, 2, 4, 10).sort()).toEqual([0, 1]);
    expect(index.near(5, 2, 4, 1)).toHaveLength(1);
    expect(indexSource(index).near(105, 101, 2, 5)).toEqual([{ ax: 100, ay: 100, bx: 110, by: 100, flags: 7 }]);
    expect(snapIndexTransfer(data)).toHaveLength(3);
    expect(snapIndexBytes(data)).toBe(3 * 32 + 3 + data.index!.byteLength);
  });

  it("an empty page has no tree and finds nothing", () => {
    const data = buildSnapIndex(segments([]));
    expect(data.index).toBeNull();
    expect(new SnapIndex(data).near(0, 0, 10, 10)).toEqual([]);
    expect(snapIndexTransfer(data)).toHaveLength(2);
  });
});
