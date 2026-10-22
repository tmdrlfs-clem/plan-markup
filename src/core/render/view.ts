// View transform for the PDF viewer (Story 3.2). Framework-free.
//
// Spaces:
// - PDF user space: points, origin at the view box's bottom-left, y up.
// - page space: points, origin at the page's top-left corner, y down, the
//   page's own /Rotate applied. This is pdf.js's viewport space at scale 1 and
//   the space of tiles.ts; PageInfo's width and height are in it.
// - screen: CSS px of the viewport, origin top-left, y down.
//
// A view is `{ zoom, centerX, centerY, rotation }`: `zoom` is CSS px per point
// (1 = actual size at 72 dpi = 100 %), (centerX, centerY) is the page-space
// point shown at the viewport centre, and `rotation` turns the view clockwise
// (view only: the PDF is never changed). Page -> screen is
//   screen = viewportCentre + zoom * R(rotation) * (p - centre).

import type { Size } from "./tiles";

export type Rotation = 0 | 90 | 180 | 270;
export type ViewState = { zoom: number; centerX: number; centerY: number; rotation: Rotation };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
/** Affine matrix in canvas `setTransform` order: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** 1 % and 6400 % of actual size. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;
/** One zoom step (keys, buttons): √2. */
export const ZOOM_STEP = Math.SQRT2;
/** Share of the page (per axis, capped at the viewport) that panning keeps on screen. */
export const MIN_VISIBLE = 0.1;

export function normalizeRotation(degrees: number): Rotation {
  const r = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

/** Exact cos/sin of a quarter-turn rotation. */
function cosSin(rotation: Rotation): [number, number] {
  switch (rotation) {
    case 0:
      return [1, 0];
    case 90:
      return [0, 1];
    case 180:
      return [-1, 0];
    case 270:
      return [0, -1];
  }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function multiplyMatrix(m: Matrix, n: Matrix): Matrix {
  // m ∘ n: apply n first, then m.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) throw new RangeError("matrix is not invertible");
  const [a, b, c, d, e, f] = m;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Page space -> screen (CSS px). */
export function pageToScreenMatrix(view: ViewState, viewport: Size): Matrix {
  const [cos, sin] = cosSin(view.rotation);
  const a = view.zoom * cos;
  const b = view.zoom * sin;
  const c = -view.zoom * sin;
  const d = view.zoom * cos;
  return [a, b, c, d, viewport.width / 2 - (a * view.centerX + c * view.centerY), viewport.height / 2 - (b * view.centerX + d * view.centerY)];
}

export function pageToScreen(view: ViewState, viewport: Size, p: Point): Point {
  return applyMatrix(pageToScreenMatrix(view, viewport), p);
}

export function screenToPage(view: ViewState, viewport: Size, p: Point): Point {
  return applyMatrix(invertMatrix(pageToScreenMatrix(view, viewport)), p);
}

/**
 * PDF user space -> page space, as pdf.js's PageViewport at scale 1 with the
 * page's /Rotate. `page` has the rotated size (PageInfo); `viewBox` is
 * [x0, y0, x1, y1] in user space (default: origin 0, the unrotated size).
 */
export function pdfToPageMatrix(
  page: { width: number; height: number; rotate: number },
  viewBox?: readonly [number, number, number, number],
): Matrix {
  const rotate = normalizeRotation(page.rotate);
  const sideways = rotate === 90 || rotate === 270;
  const [x0, y0, x1, y1] = viewBox ?? [0, 0, sideways ? page.height : page.width, sideways ? page.width : page.height];
  // pdf.js PageViewport: rotateA..D per /Rotate, y flipped.
  const [A, B, C, D] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotate];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const offsetX = sideways ? Math.abs(cy - y0) : Math.abs(cx - x0);
  const offsetY = sideways ? Math.abs(cx - x0) : Math.abs(cy - y0);
  return [A, B, C, D, offsetX - A * cx - C * cy, offsetY - B * cx - D * cy];
}

/** The page's size on screen orientation (sides swapped at 90° and 270°). */
export function rotatedSize(page: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270 ? { width: page.height, height: page.width } : { width: page.width, height: page.height };
}

/** Zooms by `factor` (clamped) keeping the page point under `screenPoint` fixed. */
export function zoomAt(view: ViewState, viewport: Size, screenPoint: Point, factor: number): ViewState {
  const anchor = screenToPage(view, viewport, screenPoint);
  const zoom = clampZoom(view.zoom * factor);
  const [cos, sin] = cosSin(view.rotation);
  // centre = anchor - R^-1 (screenPoint - viewportCentre) / zoom
  const dx = (screenPoint.x - viewport.width / 2) / zoom;
  const dy = (screenPoint.y - viewport.height / 2) / zoom;
  return { ...view, zoom, centerX: anchor.x - (cos * dx + sin * dy), centerY: anchor.y - (-sin * dx + cos * dy) };
}

/** The zoom one step (√2) in (`1`) or out (`-1`), clamped. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(zoom * ZOOM_STEP ** direction);
}

/** Moves the content by (dx, dy) screen px. */
export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  const [cos, sin] = cosSin(view.rotation);
  const ux = dx / view.zoom;
  const uy = dy / view.zoom;
  return { ...view, centerX: view.centerX - (cos * ux + sin * uy), centerY: view.centerY - (-sin * ux + cos * uy) };
}

/** Turns the view by ±90° about the viewport centre. */
export function rotateView(view: ViewState, delta: 90 | -90): ViewState {
  return { ...view, rotation: normalizeRotation(view.rotation + delta) };
}

/** The whole page, centred, `margin` CSS px free around it. */
export function fitPageView(page: Size, viewport: Size, rotation: Rotation, margin = 0): ViewState {
  const s = rotatedSize(page, rotation);
  const zoom = clampZoom(
    Math.min(Math.max(1, viewport.width - 2 * margin) / s.width, Math.max(1, viewport.height - 2 * margin) / s.height),
  );
  return { zoom, centerX: page.width / 2, centerY: page.height / 2, rotation };
}

/** The page's width fills the viewport; a page taller than the viewport starts at its top edge. */
export function fitWidthView(page: Size, viewport: Size, rotation: Rotation, margin = 0): ViewState {
  const s = rotatedSize(page, rotation);
  const zoom = clampZoom(Math.max(1, viewport.width - 2 * margin) / s.width);
  const centred: ViewState = { zoom, centerX: page.width / 2, centerY: page.height / 2, rotation };
  const height = s.height * zoom;
  if (height <= viewport.height - 2 * margin) return centred;
  const top = viewport.height / 2 - height / 2; // screen y of the page's top edge when centred
  return panBy(centred, 0, margin - top);
}

/** The screen bounding box of the page. */
function pageScreenBounds(view: ViewState, viewport: Size, page: Size): Rect {
  const m = pageToScreenMatrix(view, viewport);
  const pts = [
    applyMatrix(m, { x: 0, y: 0 }),
    applyMatrix(m, { x: page.width, y: 0 }),
    applyMatrix(m, { x: 0, y: page.height }),
    applyMatrix(m, { x: page.width, y: page.height }),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Clamps the zoom to 1 %–6400 % and pans so that at least MIN_VISIBLE of the
 * page (per axis; at most the whole viewport) stays on screen.
 */
export function clampView(view: ViewState, page: Size, viewport: Size): ViewState {
  const zoom = clampZoom(view.zoom);
  let out = zoom === view.zoom ? view : { ...view, zoom };
  const b = pageScreenBounds(out, viewport, page);
  const needX = Math.min(b.width * MIN_VISIBLE, viewport.width);
  const needY = Math.min(b.height * MIN_VISIBLE, viewport.height);
  let dx = 0;
  let dy = 0;
  if (b.x + b.width < needX) dx = needX - (b.x + b.width);
  else if (b.x > viewport.width - needX) dx = viewport.width - needX - b.x;
  if (b.y + b.height < needY) dy = needY - (b.y + b.height);
  else if (b.y > viewport.height - needY) dy = viewport.height - needY - b.y;
  if (dx !== 0 || dy !== 0) out = panBy(out, dx, dy);
  return out;
}

/** Zooms so that the screen rectangle `rect` fills the viewport (Zoom tool drag). */
export function zoomToRect(view: ViewState, viewport: Size, rect: Rect): ViewState {
  const centre = screenToPage(view, viewport, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const factor = Math.min(viewport.width / Math.max(1, rect.width), viewport.height / Math.max(1, rect.height));
  return { ...view, zoom: clampZoom(view.zoom * factor), centerX: centre.x, centerY: centre.y };
}

/** The page-space bounding box of the viewport. */
export function visibleBounds(view: ViewState, viewport: Size): Rect {
  const s = rotatedSize(viewport, view.rotation);
  const width = s.width / view.zoom;
  const height = s.height / view.zoom;
  return { x: view.centerX - width / 2, y: view.centerY - height / 2, width, height };
}

/** Status-bar zoom: percent of actual size at 72 dpi, rounded (1 pt = 1 CSS px = 100 %). */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
