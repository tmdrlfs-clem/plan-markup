// View and page commands for the workspace's toolbar, menus and status bar (Stories 3.2, 3.3). The mounted
// CanvasViewport registers its engine; with no document the commands do nothing
// (and the workspace shows them disabled).

import { createStore } from "zustand/vanilla";

import type { DocumentSearch } from "./document-search";
import type { CalibrationPickListener, ThumbnailBox, ThumbnailListener } from "./viewer-engine";

export interface ViewerCommandTarget {
  zoomStep(direction: 1 | -1): void;
  /** Story 3.7 (absent on test doubles): zoom to a percentage, 100 % = actual size. */
  zoomToPercent?(percent: number): void;
  fitPage(): void;
  fitWidth(): void;
  rotate(delta: 90 | -90): void;
  /** Shows page `index` (0-based); out of range does nothing. */
  goToPage(index: number): void;
  readonly currentPage: number;
  readonly pageCount: number;
  focusCanvas(): void;
  /** Story 3.4 (absent on test doubles): see ViewerEngine.thumbnail / sheetLabel. */
  thumbnail?(index: number, box: ThumbnailBox, listener: ThumbnailListener): () => void;
  sheetLabel?(index: number): () => void;
  /** Story 3.6 (absent on test doubles): the document's text search. */
  readonly search?: DocumentSearch;
  /** Story 4.3 (absent on test doubles): see ViewerEngine.startCalibrationPick. */
  startCalibrationPick?(listener: CalibrationPickListener): void;
  cancelCalibrationPick?(): void;
  clearCalibrationLine?(): void;
}

let target: ViewerCommandTarget | null = null;

/** Makes `engine` the target of the view commands; returns the unregister function. */
export function registerViewerEngine(engine: ViewerCommandTarget): () => void {
  target = engine;
  activeSearch.setState({ search: engine.search ?? null });
  return () => {
    if (target !== engine) return;
    target = null;
    activeSearch.setState({ search: null });
  };
}

/** The search of the active document tab (Story 3.6): the Search panel and F3 follow it. */
export const activeSearch = createStore<{ search: DocumentSearch | null }>(() => ({ search: null }));

export const viewerCommands = {
  zoomIn: () => target?.zoomStep(1),
  zoomOut: () => target?.zoomStep(-1),
  /** The status bar's zoom menu (Story 3.7): 50 / 100 / 200 / 400 %. */
  zoomTo: (percent: number) => target?.zoomToPercent?.(percent),
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
  /** Looks up a row's detected sheet number; the returned release cancels it once no row needs it. */
  sheetLabel: (index: number): (() => void) => target?.sheetLabel?.(index) ?? (() => undefined),
};

/** Story 4.3: the Calibrate dialog's two-point pick on the active drawing (without one it is cancelled at once). */
export const viewerCalibration = {
  startPick: (listener: CalibrationPickListener): void => {
    if (target?.startCalibrationPick) target.startCalibrationPick(listener);
    else listener.done(null);
  },
  cancelPick: (): void => target?.cancelCalibrationPick?.(),
  clearLine: (): void => target?.clearCalibrationLine?.(),
};

/** The commands without arguments (toolbar buttons and menu items). */
export type ViewerCommand = Exclude<keyof typeof viewerCommands, "goToPage" | "zoomTo">;
