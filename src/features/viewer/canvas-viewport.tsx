"use client";

import { FileWarning, RotateCw } from "lucide-react";
import { useEffect, useRef, type DragEvent } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { RenderClient } from "@/workers/rpc";

import { currentSheetLabel } from "./page-pager";
import { registerViewerEngine } from "./viewer-commands";
import { ViewerEngine, type DeviceSize } from "./viewer-engine";
import { ViewerInput } from "./viewer-input";
import { VIEWER_ERROR_TEXT, canvasStateOf, openDocument, viewerStore, type ViewerState } from "./viewer-store";

export interface CanvasViewportProps {
  /** Opens the file picker (Open another file). */
  onOpen: () => void;
  /** Files dropped on the canvas. */
  onOpenFiles: (files: File[]) => void;
  /** Builds the render worker; tests pass a fake. */
  createWorker?: () => Worker;
}

function defaultWorker(): Worker {
  return new Worker(new URL("../../workers/render.worker.ts", import.meta.url), { type: "module" });
}

/**
 * The canvas backing-store size in whole device px. With device-pixel-content-box
 * support the observed size is used as is (when it still matches the current
 * layout and DPR; a DPR change can be measured before the observer reports).
 * Without it, the canvases' CSS size is set to whole device px (floored) so the
 * backing store maps 1:1 to the screen.
 */
export function measureDevice(
  rect: { width: number; height: number },
  dpr: number,
  observed: DeviceSize | null,
  exactBoxes: boolean,
  canvases: HTMLCanvasElement[],
): DeviceSize {
  const width = Math.max(1, rect.width) * dpr;
  const height = Math.max(1, rect.height) * dpr;
  if (exactBoxes) {
    if (observed && Math.abs(observed.width - width) <= 1 && Math.abs(observed.height - height) <= 1) return observed;
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const device = { width: Math.max(1, Math.floor(width + 1e-6)), height: Math.max(1, Math.floor(height + 1e-6)) };
  for (const c of canvases) {
    c.style.width = `${device.width / dpr}px`;
    c.style.height = `${device.height / dpr}px`;
  }
  return device;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * React host of the Canvas2D viewer (UX-DR12): tile canvas, static markups canvas and
 * active canvas sized to the viewport x DPR. The engine draws; React only mounts the
 * stack and renders the document-level states (loading bar, inline errors, tile retry).
 */
export function CanvasViewport({ onOpen, onOpenFiles, createWorker = defaultWorker }: CanvasViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLCanvasElement>(null);
  const markupsRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);

  const status = useStore(viewerStore, (s) => s.status);
  const error = useStore(viewerStore, (s) => s.error);
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const sheetLabel = useStore(viewerStore, (s) => currentSheetLabel(s)?.short ?? null);
  const failedTiles = useStore(viewerStore, (s) => s.failedTiles);
  const pageFailed = useStore(viewerStore, (s) => s.pageFailed);
  const content = useStore(viewerStore, (s) => s.content);
  const firstFrameMs = useStore(viewerStore, (s) => s.timings.firstFrameMs);
  const file = useStore(viewerStore, (s) => s.file);
  const state = canvasStateOf({ status, content, failedTiles, error });

  // One engine (and render worker) per mount.
  useEffect(() => {
    const host = hostRef.current;
    const tiles = tilesRef.current;
    const markups = markupsRef.current;
    const active = activeRef.current;
    if (!host || !tiles || !markups || !active) return;
    // A factory, so the client can start a new worker after a fatal failure (Try again).
    const client = new RenderClient(createWorker);
    const next = new ViewerEngine({ tiles, markups, active }, client, (patch: Partial<ViewerState>) =>
      viewerStore.setState(patch),
    );
    // The backing store must be exactly the canvas's device pixels, or the compositor
    // rescales it and blurs every hairline (AC 4). Browsers that report
    // device-pixel-content-box give that size; elsewhere the canvases' CSS size is
    // snapped down to whole device px.
    const canvases = [tiles, markups, active];
    let deviceBox: DeviceSize | null = null;
    let exactBoxes = false;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = host.getBoundingClientRect();
      next.setViewport(rect.width, rect.height, dpr, measureDevice(rect, dpr, deviceBox, exactBoxes, canvases));
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const box = entry.target === tiles ? entry.devicePixelContentBoxSize?.[0] : undefined;
              if (box) deviceBox = { width: box.inlineSize, height: box.blockSize };
            }
            measure();
          });
    observer?.observe(host);
    try {
      observer?.observe(tiles, { box: "device-pixel-content-box" });
      exactBoxes = observer !== null;
    } catch {
      // Not supported (Safari): measureDevice snaps the CSS size instead.
    }
    measure();
    window.addEventListener("resize", measure);
    // A DPR change (the window moved to another monitor, AC 4) does not always resize: watch
    // a resolution query for the current DPR and re-arm it after every change.
    let dprQuery: MediaQueryList | null = null;
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      dprQuery?.addEventListener("change", onDprChange);
    };
    const onDprChange = () => {
      measure();
      watchDpr();
    };
    watchDpr();
    const input = new ViewerInput(active, next);
    const unregister = registerViewerEngine(next);

    // Open the current file now, and every later one (openSeq bumps on each open).
    const openCurrent = (s: ViewerState) => {
      if (s.file && s.status === "loading") void next.open(s.file);
    };
    openCurrent(viewerStore.getState());
    const unsubscribe = viewerStore.subscribe((s, prev) => {
      if (s.openSeq !== prev.openSeq) openCurrent(s);
    });
    engineRef.current = next;
    return () => {
      unsubscribe();
      input.detach();
      unregister();
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      dprQuery?.removeEventListener("change", onDprChange);
      next.destroy();
      engineRef.current = null;
    };
  }, [createWorker]);

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    onOpenFiles(Array.from(event.dataTransfer.files));
  }

  const fileError = status === "error" && error !== null;
  const canvasClass = "absolute inset-0 h-full w-full";
  const label =
    pageCount > 0 ? `Drawing canvas, page ${pageIndex + 1} of ${pageCount}${sheetLabel ? `, ${sheetLabel}` : ""}` : "Drawing canvas";

  return (
    <div
      ref={hostRef}
      data-testid="canvas-viewport"
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative h-full w-full touch-none overflow-hidden select-none bg-surface-0"
    >
      <canvas ref={tilesRef} data-testid="tiles-canvas" aria-hidden="true" className={canvasClass} />
      <canvas ref={markupsRef} aria-hidden="true" className={canvasClass} />
      <canvas
        ref={activeRef}
        tabIndex={0}
        role="img"
        aria-label={label}
        data-testid="drawing-canvas"
        data-state={state}
        data-first-frame-ms={firstFrameMs === null ? undefined : Math.round(firstFrameMs)}
        className={`${canvasClass} focus-ring`}
      />

      {status === "loading" ? (
        <div
          role="progressbar"
          aria-label="Loading drawing"
          className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent-soft"
        >
          <div className="h-full w-1/3 bg-accent motion-safe:animate-progress" />
        </div>
      ) : null}

      {failedTiles > 0 && !fileError ? (
        <div
          role="alert"
          className="absolute right-3 top-3 flex items-center gap-2 rounded-md border border-strong bg-surface-1 py-1 pl-3 pr-1 text-ws-md shadow-2"
        >
          <span>{pageFailed ? "This page could not be drawn." : "Parts of the page could not be drawn."}</span>
          <Button size="sm" variant="secondary" onClick={() => engineRef.current?.retryFailedTiles()}>
            <RotateCw size={14} aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      {fileError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-0 p-6">
          <div
            role="alert"
            data-testid="viewer-error"
            data-code={error}
            className="flex max-w-[440px] flex-col items-center gap-3 text-center"
          >
            <FileWarning size={32} aria-hidden="true" className="text-danger" />
            <p className="text-ws-lg">{VIEWER_ERROR_TEXT[error]}</p>
            <div className="flex gap-2">
              {error === "render-failed" && file ? (
                <Button size="sm" variant="secondary" onClick={() => openDocument(file)}>
                  Try again
                </Button>
              ) : null}
              <Button size="sm" variant="primary" onClick={onOpen}>
                Open another file
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
