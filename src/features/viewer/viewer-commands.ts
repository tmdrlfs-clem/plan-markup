// View and page commands for the workspace's toolbar, menus and status bar (Stories 3.2, 3.3). The mounted
// CanvasViewport registers its engine; with no document the commands do nothing
// (and the workspace shows them disabled).

import type { ThumbnailBox, ThumbnailListener } from "./viewer-engine";

export interface ViewerCommandTarget {
  zoomStep(direction: 1 | -1): void;
  fitPage(): void;
  fitWidth(): void;
  rotate(delta: 90 | -90): void;
  /** Shows page `index` (0-based); out of range does nothing. */
  goToPage(index: number): void;
  readonly currentPage: number;
  readonly pageCount: number;
  focusCanvas(): void;
  /** Story 3.4 (absent on test doubles): see ViewerEngine.thumbnail / requestSheetLabel. */
  thumbnail?(index: number, box: ThumbnailBox, listener: ThumbnailListener): () => void;
  requestSheetLabel?(index: number): void;
}

let target: ViewerCommandTarget | null = null;

/** Makes `engine` the target of the view commands; returns the unregister function. */
export function registerViewerEngine(engine: ViewerCommandTarget): () => void {
  target = engine;
  return () => {
    if (target === engine) target = null;
  };
}

export const viewerCommands = {
  zoomIn: () => target?.zoomStep(1),
  zoomOut: () => target?.zoomStep(-1),
  fitPage: () => target?.fitPage(),
  fitWidth: () => target?.fitWidth(),
  rotateClockwise: () => target?.rotate(90),
  rotateCounterClockwise: () => target?.rotate(-90),
  firstPage: () => target?.goToPage(0),
  previousPage: () => target?.goToPage(target.currentPage - 1),
  nextPage: () => target?.goToPage(target.currentPage + 1),
  lastPage: () => target?.goToPage(target.pageCount - 1),
  /** The page input and typed labels (0-based index). */
  goToPage: (index: number) => target?.goToPage(index),
  /** Back to the canvas (Escape in the page input). */
  focusCanvas: () => target?.focusCanvas(),
};

/** The Thumbnails panel's access to the mounted engine (nothing happens without one). */
export const viewerThumbnails = {
  request: (index: number, box: ThumbnailBox, listener: ThumbnailListener): (() => void) =>
    target?.thumbnail?.(index, box, listener) ?? (() => undefined),
  requestSheetLabel: (index: number) => target?.requestSheetLabel?.(index),
};

/** The commands without arguments (toolbar buttons and menu items). */
export type ViewerCommand = Exclude<keyof typeof viewerCommands, "goToPage">;
