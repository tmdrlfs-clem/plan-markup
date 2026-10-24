// Spatial index of a page's snap segments (Story 4.1, AR15). Framework-free.
//
// Replaces the prototype's uniform grid (buildVecIndex: cells keyed in a Map,
// long segments in a side list) with a static flatbush 4.6.2 R-tree over the
// segments' boxes. The index lives in one ArrayBuffer, so it is built in a
// worker and handed to the main thread as a transferred buffer, together with
// the segments, and queried there synchronously at pointer speed.

import Flatbush from "flatbush";

import type { Segments } from "./extract";
import type { SnapSource } from "./resolve";

export type SnapIndexData = {
  /** The segments (x1, y1, x2, y2 per segment, user space points). */
  coords: Float64Array;
  /** SEG_* flags per segment. */
  flags: Uint8Array;
  /** Flatbush's buffer (Flatbush.from); null for a page without segments. */
  index: ArrayBuffer | null;
  count: number;
  truncated: boolean;
};

/** Builds the R-tree over `segments` (in the worker). */
export function buildSnapIndex(segments: Segments): SnapIndexData {
  const { coords, flags, count, truncated } = segments;
  if (count === 0) return { coords, flags, index: null, count, truncated };
  const tree = new Flatbush(count);
  for (let i = 0; i < count; i++) {
    const ax = coords[4 * i];
    const ay = coords[4 * i + 1];
    const bx = coords[4 * i + 2];
    const by = coords[4 * i + 3];
    tree.add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
  }
  tree.finish();
  return { coords, flags, index: tree.data as ArrayBuffer, count, truncated };
}

/** Bytes the index holds (segments, flags and the tree). */
export function snapIndexBytes(data: SnapIndexData): number {
  return data.coords.byteLength + data.flags.byteLength + (data.index?.byteLength ?? 0);
}

/** The transferables of `data` (worker → main thread, never structured-cloned). */
export function snapIndexTransfer(data: SnapIndexData): ArrayBuffer[] {
  const out = [data.coords.buffer as ArrayBuffer, data.flags.buffer as ArrayBuffer];
  if (data.index) out.push(data.index);
  return out;
}

/** A queryable page index on the main thread. */
export class SnapIndex {
  private readonly tree: Flatbush | null;

  constructor(readonly data: SnapIndexData) {
    this.tree = data.index ? Flatbush.from(data.index) : null;
  }

  get count(): number {
    return this.data.count;
  }

  /**
   * Ids of the segments whose box comes within `radius` of (x, y), at most
   * `limit` of them (bounded work per query, NFR6), nearest boxes first.
   */
  near(x: number, y: number, radius: number, limit: number): number[] {
    if (!this.tree) return [];
    return this.tree.neighbors(x, y, limit, radius);
  }
}

/** The drawing's linework as a snap source (resolve.ts), nearest segments first. */
export function indexSource(index: SnapIndex): SnapSource {
  const { coords, flags } = index.data;
  return {
    near(x, y, radius, limit) {
      return index.near(x, y, radius, limit).map((i) => ({
        ax: coords[4 * i],
        ay: coords[4 * i + 1],
        bx: coords[4 * i + 2],
        by: coords[4 * i + 3],
        flags: flags[i],
      }));
    },
  };
}
