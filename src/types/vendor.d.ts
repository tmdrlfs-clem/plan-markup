// Ambient declarations for dependencies that ship no TypeScript types.

declare module "pdfjs-dist/build/pdf.worker.mjs" {
  /** pdf.js's parser entry point; assigned to globalThis.pdfjsWorker for the in-thread ("fake") worker. */
  export const WorkerMessageHandler: unknown;
}

declare module "rbush" {
  export type BBox = { minX: number; minY: number; maxX: number; maxY: number };
  export default class RBush<T extends BBox = BBox> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(bbox: BBox): T[];
    collides(bbox: BBox): boolean;
    all(): T[];
  }
}
