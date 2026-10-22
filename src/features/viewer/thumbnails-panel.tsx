"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { cx } from "@/components/ui/cx";
import { sheetLabelOf } from "@/core/pdf/sheet-label";
import type { PageInfo } from "@/workers/render-protocol";

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
  if (!shown || pages.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>{emptyText}</p>
      </div>
    );
  }
  // A new document starts a fresh list (scroll position, focus, rasters).
  return <ThumbnailList key={documentId ?? "document"} pages={pages} />;
}

const readDpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

function ThumbnailList({ pages }: { pages: PageInfo[] }) {
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const [size, setSize] = useState<Box>({ width: 280, height: 600 });
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
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const layout = thumbnailLayout(size.width, pages, dpr);
  const { rowHeight } = layout;
  const range = visibleRows(scrollTop, size.height, rowHeight, pages.length);
  const rowsPerScreen = Math.max(1, Math.floor(size.height / rowHeight));

  // The current page (pager, keys, a click) stays in view (AC 3).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = revealRow(pageIndex, el.scrollTop, el.clientHeight || size.height, rowHeight);
    if (top !== null) el.scrollTop = top;
  }, [pageIndex, rowHeight, size.height]);

  // So does the row the keys moved to.
  useEffect(() => {
    const el = listRef.current;
    if (!el || moved === null) return;
    const top = revealRow(moved.index, el.scrollTop, el.clientHeight || size.height, rowHeight);
    if (top !== null) el.scrollTop = top;
  }, [moved, rowHeight, size.height]);

  const go = (index: number) => {
    setMoved({ forPage: pageIndex, index });
    viewerCommands.goToPage(index);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active !== pageIndex) viewerCommands.goToPage(active);
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
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
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

function ThumbnailRow({ id, index, page, top, rowHeight, box, deviceBox, dpr, label, needsLabel, current, active, onSelect }: RowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [raster, setRaster] = useState<{ key: string; state: RasterState }>({ key: "", state: "pending" });
  const fit = fitInBox(page, box);
  const requestKey = `${deviceBox.width}x${deviceBox.height}`;
  const state = raster.key === requestKey ? raster.state : "pending";
  const drawn = useRef<ImageBitmap | null>(null);

  // The raster for this row's step; a new step (panel resize across a step) asks again (AC 6).
  const { width: boxWidthPx, height: boxHeightPx } = deviceBox;
  useEffect(() => {
    const key = `${boxWidthPx}x${boxHeightPx}`;
    return viewerThumbnails.request(index, { width: boxWidthPx, height: boxHeightPx }, (result) => {
      if ("error" in result) {
        drawn.current = null;
        setRaster({ key, state: "failed" });
        return;
      }
      drawn.current = result.bitmap;
      paint(canvasRef.current, result.bitmap);
      setRaster({ key, state: "ready" });
    });
  }, [index, boxWidthPx, boxHeightPx]);

  // A resize within the step only redraws the held raster into the new canvas size.
  useEffect(() => {
    if (state === "ready" && drawn.current) paint(canvasRef.current, drawn.current);
  }, [state, fit.width, fit.height, dpr]);

  // Pages without a page label: look up the detected sheet number for the rows shown.
  useEffect(() => {
    if (needsLabel) viewerThumbnails.requestSheetLabel(index);
  }, [index, needsLabel]);

  return (
    <div
      id={id}
      role="option"
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
            className={cx("block h-full w-full bg-white", state !== "ready" && "invisible")}
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

/** Draws a held raster into the row's canvas (its backing store already sized). */
function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } catch {
    // The engine evicted (closed) it meanwhile; the next request draws again.
  }
}
