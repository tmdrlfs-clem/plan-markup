// Thumbnails panel geometry (Story 3.4): fixed-height rows, the visible window
// with overscan, the raster size steps and the list's keyboard moves. Pure
// functions, no React.

/** Raster width steps (CSS px): a panel resize re-renders only when the step changes (AC 6). */
export const THUMBNAIL_STEPS = [160, 240, 320, 400] as const;
/** Horizontal padding of a row around its thumbnail box (CSS px, each side). */
export const ROW_PADDING_X = 12;
/** A row's height besides the thumbnail box: padding, gap and the label line (CSS px). */
export const ROW_CHROME = 34;
/** Box aspect (height / width) limits: very tall or flat pages do not blow up the rows. */
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 1.42;
const DEFAULT_ASPECT = 0.75;

export type Box = { width: number; height: number };

/** The smallest raster step that covers `cssWidth` (the largest step beyond it). */
export function thumbnailStep(cssWidth: number): number {
  for (const step of THUMBNAIL_STEPS) if (step >= cssWidth) return step;
  return THUMBNAIL_STEPS[THUMBNAIL_STEPS.length - 1];
}

/** One box shape for the whole document: the tallest page's aspect, clamped. */
export function boxAspect(pages: readonly Box[]): number {
  let aspect = 0;
  for (const p of pages) if (p.width > 0 && p.height > 0) aspect = Math.max(aspect, p.height / p.width);
  return aspect > 0 ? Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect)) : DEFAULT_ASPECT;
}

export type ThumbnailLayout = {
  /** The thumbnail box in CSS px (every page is fitted into it). */
  box: Box;
  rowHeight: number;
  /** The box the raster is requested for, in device px (the width step x DPR). */
  deviceBox: Box;
};

/** Rows for a list `listWidth` CSS px wide at `dpr`. */
export function thumbnailLayout(listWidth: number, pages: readonly Box[], dpr: number): ThumbnailLayout {
  const aspect = boxAspect(pages);
  const width = Math.max(40, Math.floor(listWidth - 2 * ROW_PADDING_X));
  const height = Math.round(width * aspect);
  const step = thumbnailStep(width);
  const k = dpr > 0 ? dpr : 1;
  return {
    box: { width, height },
    rowHeight: height + ROW_CHROME,
    deviceBox: { width: Math.round(step * k), height: Math.round(step * aspect * k) },
  };
}

/** A page fitted into a box, in whole CSS px. */
export function fitInBox(page: Box, box: Box): Box {
  if (!(page.width > 0) || !(page.height > 0)) return { ...box };
  const scale = Math.min(box.width / page.width, box.height / page.height);
  return { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) };
}

/**
 * Rows to mount (inclusive range): the visible ones plus `overscan` screens
 * above and below (AC 2: ±1 screen). Empty (`last < first`) without rows.
 */
export function visibleRows(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 1,
): { first: number; last: number } {
  if (count <= 0 || !(rowHeight > 0)) return { first: 0, last: -1 };
  const extra = Math.max(0, viewportHeight) * overscan;
  const first = Math.min(count - 1, Math.max(0, Math.floor((scrollTop - extra) / rowHeight)));
  const last = Math.min(count - 1, Math.max(first, Math.ceil((scrollTop + viewportHeight + extra) / rowHeight) - 1));
  return { first, last };
}

/** The scrollTop that brings row `index` fully into view, or null when it already is. */
export function revealRow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) {
    // A row taller than the list shows its top (the thumbnail), not its label line.
    if (rowHeight >= viewportHeight) return top === scrollTop ? null : top;
    return Math.max(0, bottom - viewportHeight);
  }
  return null;
}

/** The row a list key moves the focus to, or null for other keys (AC 4). */
export function rowForKey(key: string, active: number, count: number, rowsPerScreen: number): number | null {
  if (count <= 0) return null;
  const page = Math.max(1, rowsPerScreen);
  let next: number;
  switch (key) {
    case "ArrowDown":
      next = active + 1;
      break;
    case "ArrowUp":
      next = active - 1;
      break;
    case "PageDown":
      next = active + page;
      break;
    case "PageUp":
      next = active - page;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return null;
  }
  return Math.min(count - 1, Math.max(0, next));
}
