"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { cx } from "@/components/ui/cx";
import { sheetLabelOf } from "@/core/pdf/sheet-label";
import type { PageInfo } from "@/workers/render-protocol";

import { thumbnailScroll } from "./thumbnail-scroll";
import { fitInBox, revealRow, rowForKey, thumbnailLayout, visibleRows, ROW_PADDING_X, type Box } from "./thumbnail-layout";
import { viewerCommands, viewerThumbnails } from "./viewer-commands";
import { hasDocument, viewerStore } from "./viewer-store";

/** Accessible name of a thumbnail: "Page 3, A1721" (the label omitted when unknown, AC 4). */
export function thumbnailName(index: number, label: string | null): string {
  return `Page ${index + 1}${label ? `, ${label}` : ""}`;
}

/**
 * Thumbnails panel (Story 3.4, UX-DR21): a virtualised list of the pages with
 * their number and sheet label. Shows the registry's empty text without a
 * drawing.
 */
export function ThumbnailsPanel({ emptyText }: { emptyText: string }) {
  const shown = useStore(viewerStore, hasDocument);
  const pages = useStore(viewerStore, (s) => s.pages);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const tabId = useStore(viewerStore, (s) => s.tabId);
  if (!shown || pages.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>{emptyText}</p>
      </div>
    );
  }
  // A new document (or tab) starts a fresh list (focus, rasters); each tab's scroll position comes back.
  const memoryKey = `${tabId ?? ""}:${documentId ?? ""}`;
  return <ThumbnailList key={memoryKey} memoryKey={memoryKey} pages={pages} />;
}

const readDpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/**
 * How long an overscan row (mounted, not on screen) waits before it asks for
 * its raster and sheet number: the visible rows go first, and rows a fling only
 * passes through never ask (3.4 review).
 */
export const OVERSCAN_DELAY_MS = 150;

function ThumbnailList({ pages, memoryKey }: { pages: PageInfo[]; memoryKey: string }) {
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const [size, setSize] = useState<Box>({ width: 280, height: 600 });
  const [measured, setMeasured] = useState(false);
  // The offset this tab left the list at, applied once the list is measured (AC 3 of 3.5).
  const pendingRestore = useRef(thumbnailScroll.get(memoryKey) ?? null);
  const skipReveal = useRef(false);
  const [dpr, setDpr] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  // Keyboard focus within the list; it follows the current page until the keys move it.
  const [moved, setMoved] = useState<{ forPage: number; index: number } | null>(null);
  const active = moved && moved.forPage === pageIndex ? moved.index : pageIndex;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      setSize({ width: el.clientWidth || 280, height: el.clientHeight || 600 });
      setDpr(readDpr());
      setMeasured(true);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // A DPR change alone (another monitor, browser zoom) resizes nothing: watch it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(readDpr());
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [dpr]);

  const layout = thumbnailLayout(size.width, pages, dpr);
  const { rowHeight } = layout;
  const range = visibleRows(scrollTop, size.height, rowHeight, pages.length);
  const onScreen = visibleRows(scrollTop, size.height, rowHeight, pages.length, 0);
  const rowsPerScreen = Math.max(1, Math.floor(size.height / rowHeight));

  // A tab shown again: its list as it was left, without revealing the current page.
  useLayoutEffect(() => {
    const el = listRef.current;
    const top = pendingRestore.current;
    if (!el || !measured || top === null) return;
    pendingRestore.current = null;
    el.scrollTop = top;
    setScrollTop(el.scrollTop);
    skipReveal.current = true;
  }, [measured, rowHeight]);

  // The current page (pager, keys, a click) stays in view (AC 3). Before paint, and the
  // window follows at once: the rows of the old scroll position never ask for anything.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || pendingRestore.current !== null) return;
    if (skipReveal.current) {
      skipReveal.current = false;
      return;
    }
    const top = revealRow(pageIndex, el.scrollTop, el.clientHeight || size.height, rowHeight);
    if (top === null) return;
    el.scrollTop = top;
    setScrollTop(el.scrollTop);
  }, [pageIndex, rowHeight, size.height]);

  // So does the row the keys moved to.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || moved === null) return;
    const top = revealRow(moved.index, el.scrollTop, el.clientHeight || size.height, rowHeight);
    if (top === null) return;
    el.scrollTop = top;
    setScrollTop(el.scrollTop);
  }, [moved, rowHeight, size.height]);

  // Navigates and hands the keyboard to the canvas, as Revu does (founder decision 2026-10-23).
  const go = (index: number) => {
    setMoved({ forPage: pageIndex, index });
    if (index !== pageIndex) viewerCommands.goToPage(index);
    viewerCommands.focusCanvas();
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      go(active);
      return;
    }
    const next = rowForKey(event.key, active, pages.length, rowsPerScreen);
    if (next === null) return;
    event.preventDefault();
    setMoved({ forPage: pageIndex, index: next });
  }

  // The window, plus the focused and the current row, so the active descendant always exists.
  const shownRows = new Set<number>([active, pageIndex]);
  for (let i = range.first; i <= range.last; i++) shownRows.add(i);
  const rows = [];
  for (const i of [...shownRows].sort((a, b) => a - b)) {
    const label = sheetLabelOf(i + 1, pageLabels?.[i], sheetLabels[i]);
    rows.push(
      <ThumbnailRow
        key={i}
        id={`${idBase}-page-${i}`}
        index={i}
        count={pages.length}
        visible={i >= onScreen.first && i <= onScreen.last}
        page={pages[i]}
        top={i * rowHeight}
        rowHeight={rowHeight}
        box={layout.box}
        deviceBox={layout.deviceBox}
        dpr={dpr}
        label={label?.short ?? null}
        needsLabel={label === null && !(i in sheetLabels)}
        current={i === pageIndex}
        active={i === active}
        onSelect={go}
      />,
    );
  }
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Page thumbnails"
      tabIndex={0}
      aria-activedescendant={`${idBase}-page-${active}`}
      data-testid="thumbnails"
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setScrollTop(top);
        thumbnailScroll.set(memoryKey, top);
      }}
      className="group h-full overflow-y-auto outline-none focus-ring"
    >
      <div className="relative" style={{ height: pages.length * rowHeight }}>
        {rows}
      </div>
    </div>
  );
}

type RowProps = {
  id: string;
  index: number;
  count: number;
  /** On screen (not only in the overscan): asks for its raster at once. */
  visible: boolean;
  page: PageInfo;
  top: number;
  rowHeight: number;
  box: Box;
  deviceBox: Box;
  dpr: number;
  label: string | null;
  needsLabel: boolean;
  current: boolean;
  active: boolean;
  onSelect: (index: number) => void;
};

type RasterState = "pending" | "ready" | "failed";

function ThumbnailRow({ id, index, count, visible, page, top, rowHeight, box, deviceBox, dpr, label, needsLabel, current, active, onSelect }: RowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [raster, setRaster] = useState<{ key: string; state: RasterState }>({ key: "", state: "pending" });
  const fit = fitInBox(page, box);
  const requestKey = `${deviceBox.width}x${deviceBox.height}`;
  const state = raster.key === requestKey ? raster.state : "pending";
  const drawn = useRef<ImageBitmap | null>(null);
  // Bumped when the held raster could not be drawn (evicted): asks the engine again.
  const [attempt, setAttempt] = useState(0);

  // Requests start from a macrotask: at once on screen, later in the overscan.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (armed) return;
    const timer = setTimeout(() => setArmed(true), visible ? 0 : OVERSCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [armed, visible]);

  // The raster for this row's step; a new step (panel resize across a step) asks again (AC 6).
  const { width: boxWidthPx, height: boxHeightPx } = deviceBox;
  useEffect(() => {
    if (!armed) return;
    const key = `${boxWidthPx}x${boxHeightPx}`;
    return viewerThumbnails.request(index, { width: boxWidthPx, height: boxHeightPx }, (result) => {
      if ("error" in result) {
        drawn.current = null;
        setRaster({ key, state: "failed" });
        return;
      }
      drawn.current = result.bitmap;
      setRaster({ key, state: "ready" });
    });
  }, [armed, index, boxWidthPx, boxHeightPx, attempt]);

  // Draws the held raster before paint (a canvas size change clears it). While a new
  // step is pending, the previous raster stays shown.
  const shown = raster.state === "ready";
  useLayoutEffect(() => {
    if (raster.state !== "ready" || !drawn.current) return;
    if (paint(canvasRef.current, drawn.current)) return;
    drawn.current = null;
    setRaster({ key: "", state: "pending" });
    setAttempt((n) => n + 1);
  }, [raster, fit.width, fit.height, dpr]);

  // Pages without a page label: look up the detected sheet number for the rows shown
  // (released, and cancelled in the worker, when the row goes).
  useEffect(() => {
    if (armed && needsLabel) return viewerThumbnails.sheetLabel(index);
  }, [armed, index, needsLabel]);

  return (
    <div
      id={id}
      role="option"
      aria-setsize={count}
      aria-posinset={index + 1}
      aria-selected={current}
      aria-current={current ? "page" : undefined}
      aria-label={thumbnailName(index, label)}
      data-page={index + 1}
      data-state={state}
      onClick={() => onSelect(index)}
      className={cx(
        "absolute inset-x-0 flex cursor-pointer flex-col items-center gap-1 py-1.5 hover:bg-surface-2",
        active && "group-focus-visible:bg-surface-2",
      )}
      style={{ top, height: rowHeight, paddingLeft: ROW_PADDING_X, paddingRight: ROW_PADDING_X }}
    >
      <div className="flex items-center justify-center" style={{ width: box.width, height: box.height }}>
        <div
          className={cx(
            "relative flex items-center justify-center rounded-sm border border-border bg-surface-2",
            // The current page: an accent border drawn as a ring (no layout shift).
            current && "border-accent ring-2 ring-accent",
            active && "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent",
          )}
          style={{ width: fit.width, height: fit.height, boxSizing: "content-box" }}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cx("block h-full w-full bg-white", !shown && "invisible")}
            style={{ width: fit.width, height: fit.height }}
            width={Math.max(1, Math.round(fit.width * dpr))}
            height={Math.max(1, Math.round(fit.height * dpr))}
          />
          {state === "failed" ? (
            <ImageOff aria-hidden="true" size={16} data-testid="thumbnail-failed" className="absolute text-muted" />
          ) : null}
        </div>
      </div>
      <div className="flex h-4 w-full min-w-0 items-center justify-center gap-1 text-ws-xs">
        <span className={cx("num", current ? "font-semibold text-text" : "text-muted")}>{index + 1}</span>
        {label ? <span className="num truncate text-text">{label}</span> : null}
      </div>
    </div>
  );
}

/**
 * Draws a held raster into a row's canvas (its backing store already sized).
 * False when the bitmap is gone (the engine evicted and closed it): ask again.
 */
export function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap): boolean {
  // A closed ImageBitmap reports 0 x 0.
  if (!(bitmap.width > 0) || !(bitmap.height > 0)) return false;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return true; // nothing to draw into (jsdom): not the raster's fault
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return true;
  } catch {
    return false;
  }
}
