import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import type { PageScales } from "@/core/scale/detect";
import type { ContentFlags, PageInfo } from "@/workers/render-protocol";

export type ViewerStatus = "empty" | "loading" | "ready" | "error";

/** File-level failures shown inline in the canvas area (AC 6). */
export type ViewerErrorCode = "invalid-pdf" | "password-required" | "read-failed" | "render-failed";

export const VIEWER_ERROR_TEXT: Record<ViewerErrorCode, string> = {
  "invalid-pdf": "This file is not a valid PDF.",
  "password-required": "This PDF is password-protected. Remove the password in another app and open it again.",
  "read-failed": "This file could not be read. Check that it is still there and open it again.",
  "render-failed": "This drawing could not be displayed.",
};

/**
 * Navigation tools of the viewer (Story 3.2), and the measuring tools Length
 * (Story 4.1: armed for snapping; it measures from Story 4.5) and Polylength (Story 4.6).
 * Calibrate (Story 4.3) is the Calibrate dialog's two-point pick, never
 * chosen from the ToolRail. Markup tools arrive with the editor.
 */
export type ViewerTool = "select" | "pan" | "zoom" | "length" | "polylength" | "calibrate";

/** Story 4.6: the measuring tools (they draw markups through the editor's painter). */
export type MeasureTool = "length" | "polylength";
export function isMeasureTool(tool: ViewerTool): tool is MeasureTool {
  return tool === "length" || tool === "polylength";
}

export type ViewerTimings = {
  /** From choosing the file to the first progressive snapshot painted (ms), if any. */
  firstPartialMs: number | null;
  /** From choosing the file to the complete low-resolution frame painted (ms). */
  firstFrameMs: number | null;
};

/**
 * Document-level viewer state. Per-frame data (tiles, the view transform) lives in the
 * ViewerEngine, never here: this store changes a handful of times per document.
 */
export interface ViewerState {
  status: ViewerStatus;
  /** The file being shown (or that failed). */
  file: File | null;
  /** Unique per open of a file in a tab (a retry too): document-level effects (notices) restart on a new value. */
  openSeq: number;
  fileName: string | null;
  pageCount: number;
  /** 0-based index of the shown page. */
  pageIndex: number;
  /** Page sizes in points with /Rotate applied (the Thumbnails panel's aspect ratios). */
  pages: PageInfo[];
  /** The open document's sha256 (thumbnails are per document), once known. */
  documentId: string | null;
  /** The document tab this state belongs to (Story 3.5); null outside tabs. */
  tabId: string | null;
  /** Cleaned /PageLabels of the document (null: none worth showing). */
  pageLabels: string[] | null;
  /** Sheet numbers detected from page text, by 0-based page (null: none found). */
  sheetLabels: Record<number, string | null>;
  /** Content flags of the current page, once known. */
  content: ContentFlags | null;
  error: ViewerErrorCode | null;
  /** Tiles that failed to render and can be retried (render error state). */
  failedTiles: number;
  /** The whole shown page failed to render (a multi-page document stays open; Retry). */
  pageFailed: boolean;
  timings: ViewerTimings;
  /** Zoom in percent of actual size (100 % = 96/72 CSS px per point, like Revu), once a page is shown. */
  zoom: number | null;
  /** The in-memory tile budget could not hold the visible tiles (memory warning, AC 5). */
  memoryPressure: boolean;
  /** The active tool (kept across documents). */
  tool: ViewerTool;
  /** Space or the middle button is held: pan without leaving `tool`. */
  tempPan: boolean;
  /**
   * Story 4.2: printed scales detected per 0-based page (pages not looked at
   * yet are absent). Keyed by page index: stable page ids arrive with saved
   * documents (AR8, Story 4.3 re-keys them).
   */
  pageScales: Record<number, PageScales>;
  /** Story 4.1 review S3: the shown page's snap index stopped at its segment cap (snapping covers part of it). */
  snapPartial: boolean;
  /**
   * Story 4.3: calibrations by stable page id (core/calibration pageIdOf: sha256 + page index,
   * AR8). In memory per tab until Epic 6 saves them with the markup set: they survive tab
   * switches, not reloads.
   */
  calibrations: Readonly<Record<string, Calibration>>;
  /** HintBar notices the user dismissed for this document (they stay hidden when its tab is shown again). */
  dismissedNotices: readonly string[];
}

/** The state with no drawing (a new tab starts from it). */
export const INITIAL_VIEWER_STATE: ViewerState = {
  status: "empty",
  file: null,
  openSeq: 0,
  fileName: null,
  pageCount: 0,
  pageIndex: 0,
  pages: [],
  documentId: null,
  tabId: null,
  pageLabels: null,
  sheetLabels: {},
  content: null,
  error: null,
  failedTiles: 0,
  pageFailed: false,
  timings: { firstPartialMs: null, firstFrameMs: null },
  zoom: null,
  memoryPressure: false,
  tool: "select",
  tempPan: false,
  snapPartial: false,
  pageScales: {},
  calibrations: {},
  dismissedNotices: [],
};

/** The active document tab's state (Story 3.5: viewer-tabs.ts swaps it per tab). */
export const viewerStore = createStore<ViewerState>(() => INITIAL_VIEWER_STATE);

/** Selects a tool (V, Shift+V, Z, the ToolRail). */
export function setTool(tool: ViewerTool): void {
  viewerStore.setState({ tool });
}

/** The user dismissed notice `id` for the shown document (kept per tab). */
export function dismissNotice(id: string): void {
  const { dismissedNotices } = viewerStore.getState();
  if (!dismissedNotices.includes(id)) viewerStore.setState({ dismissedNotices: [...dismissedNotices, id] });
}

/** Space / middle button: temporary pan on or off. */
export function setTempPan(tempPan: boolean): void {
  if (viewerStore.getState().tempPan !== tempPan) viewerStore.setState({ tempPan });
}

/** True while a drawing is shown (navigation commands are enabled). */
export function hasDocument(s: Pick<ViewerState, "status" | "pageCount">): boolean {
  return s.pageCount > 0 && s.status !== "error";
}

/** The canvas state of UX-DR12 for the current document. */
export type CanvasState = "loading" | "ready" | "image-only" | "render-error";

export function canvasStateOf(s: Pick<ViewerState, "status" | "content" | "failedTiles" | "error">): CanvasState {
  if (s.status === "error" || s.failedTiles > 0) return "render-error";
  if (s.status !== "ready") return "loading";
  return s.content?.imageOnly ? "image-only" : "ready";
}
