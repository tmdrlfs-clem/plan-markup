import { createStore } from "zustand/vanilla";

import type { ContentFlags } from "@/workers/render-protocol";

export type ViewerStatus = "empty" | "loading" | "ready" | "error";

/** File-level failures shown inline in the canvas area (AC 6). */
export type ViewerErrorCode = "invalid-pdf" | "password-required" | "read-failed" | "render-failed";

export const VIEWER_ERROR_TEXT: Record<ViewerErrorCode, string> = {
  "invalid-pdf": "This file is not a valid PDF.",
  "password-required": "This PDF is password-protected. Remove the password in another app and open it again.",
  "read-failed": "This file could not be read. Check that it is still there and open it again.",
  "render-failed": "This drawing could not be displayed.",
};

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
  /** The file being shown (or that failed); bumping `openSeq` asks the viewport to open it. */
  file: File | null;
  openSeq: number;
  fileName: string | null;
  pageCount: number;
  /** 0-based; the pager arrives in Story 3.3. */
  pageIndex: number;
  /** Content flags of the current page, once known. */
  content: ContentFlags | null;
  error: ViewerErrorCode | null;
  /** Tiles that failed to render and can be retried (render error state). */
  failedTiles: number;
  timings: ViewerTimings;
}

const INITIAL: ViewerState = {
  status: "empty",
  file: null,
  openSeq: 0,
  fileName: null,
  pageCount: 0,
  pageIndex: 0,
  content: null,
  error: null,
  failedTiles: 0,
  timings: { firstPartialMs: null, firstFrameMs: null },
};

export const viewerStore = createStore<ViewerState>(() => INITIAL);

/** Shows `file` in the viewer, replacing the current document (tabs arrive in Story 3.5). */
export function openDocument(file: File): void {
  viewerStore.setState((s) => ({
    ...INITIAL,
    status: "loading",
    file,
    fileName: file.name,
    openSeq: s.openSeq + 1,
  }));
}

/** Back to the empty workspace (tests, and closing the last tab later). */
export function resetViewer(): void {
  viewerStore.setState((s) => ({ ...INITIAL, openSeq: s.openSeq + 1 }));
}

/** The canvas state of UX-DR12 for the current document. */
export type CanvasState = "loading" | "ready" | "image-only" | "render-error";

export function canvasStateOf(s: Pick<ViewerState, "status" | "content" | "failedTiles" | "error">): CanvasState {
  if (s.status === "error" || s.failedTiles > 0) return "render-error";
  if (s.status !== "ready") return "loading";
  return s.content?.imageOnly ? "image-only" : "ready";
}
