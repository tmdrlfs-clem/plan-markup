// Client-only bridge between the CSS theme variables and the canvas renderer.
// Never import this from src/core (it touches `document`).

import { DEFAULT_THEME, isTheme, type Theme } from "@/lib/theme";

export { DEFAULT_THEME, THEMES, isTheme, type Theme } from "@/lib/theme";

export interface CanvasTokens {
  /** Selection colour (accent) and its dark companion outline. */
  selection: string;
  selectionOutline: string;
  halo: string;
  snap: string;
  danger: string;
  warning: string;
  /** Story 4.5: a warning drawn on the white sheet ("Scale not set" captions). */
  canvasWarning: string;
  success: string;
  coverageFill: string;
  coverageOutline: string;
  zoneOutline: string;
  /** Search highlights (Story 3.6): every hit, the current hit, and its outline. */
  searchHit: string;
  searchCurrent: string;
  searchOutline: string;
  /** Canvas surround (surface-0). */
  surround: string;
  /** Story 3.8: the canvas around the sheet, the Zoom tool's rubber band, a failed tile's box. */
  backdrop: string;
  zoomRect: string;
  failedFill: string;
  failedStroke: string;
  /** Handle size in px. */
  handleSize: number;
  fontFamily: string;
}

const DEFAULT_HANDLE_SIZE = 8;

function readVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** Reads the canvas-relevant tokens from the live CSS variables on `el`. */
export function readCanvasTokens(
  el: HTMLElement = document.documentElement,
): CanvasTokens {
  const style = getComputedStyle(el);
  const handle = parseFloat(readVar(style, "--canvas-handle-size"));
  return {
    selection: readVar(style, "--accent"),
    selectionOutline: readVar(style, "--canvas-selection-outline"),
    halo: readVar(style, "--canvas-halo"),
    snap: readVar(style, "--canvas-snap"),
    danger: readVar(style, "--canvas-danger"),
    warning: readVar(style, "--warning"),
    canvasWarning: readVar(style, "--canvas-warning"),
    success: readVar(style, "--success"),
    coverageFill: readVar(style, "--canvas-coverage-fill"),
    coverageOutline: readVar(style, "--canvas-coverage-outline"),
    zoneOutline: readVar(style, "--canvas-zone"),
    searchHit: readVar(style, "--canvas-search-hit"),
    searchCurrent: readVar(style, "--canvas-search-current"),
    searchOutline: readVar(style, "--canvas-search-outline"),
    surround: readVar(style, "--surface-0"),
    backdrop: readVar(style, "--canvas-backdrop"),
    zoomRect: readVar(style, "--canvas-zoom-rect"),
    failedFill: readVar(style, "--canvas-failed-fill"),
    failedStroke: readVar(style, "--canvas-failed-stroke"),
    handleSize: Number.isFinite(handle) ? handle : DEFAULT_HANDLE_SIZE,
    fontFamily: readVar(style, "--font-inter") || getComputedStyle(el).fontFamily,
  };
}

/** The viewer's canvas colours (Story 3.8): the theme's, read from its tokens. */
export type ViewerPalette = Pick<
  CanvasTokens,
  "backdrop" | "zoomRect" | "failedFill" | "failedStroke" | "searchHit" | "searchCurrent" | "searchOutline" | "snap" | "halo" | "canvasWarning" | "selection" | "fontFamily"
>;

/**
 * Blueprint's values (globals.css, kept equal by tokens.test.ts), only for
 * tokens a page cannot read (no stylesheet: unit tests, a canvas outside the
 * themed tree). The theme's own values always win.
 */
export const VIEWER_PALETTE_FALLBACK: Readonly<ViewerPalette> = Object.freeze({
  backdrop: "#e5e7eb",
  zoomRect: "#c24e00",
  failedFill: "#f3f4f6",
  failedStroke: "#6b7280",
  searchHit: "rgba(255, 214, 0, 0.4)",
  searchCurrent: "rgba(255, 170, 0, 0.6)",
  searchOutline: "#8a5a00",
  // Story 4.1: the snap glyph (info blue, contrast-checked on the white sheet) and its halo.
  snap: "#2563c9",
  halo: "#ffffff",
  // Story 4.5: "Scale not set" captions (dark amber, readable on the white sheet).
  canvasWarning: "#8a6400",
  // Story 4.11: the selection outline (the accent, UX-DR13).
  selection: "#ff7a1a",
  fontFamily: "sans-serif",
});

/** The viewer's palette from `tokens`, an unreadable token falling back to Blueprint's value. */
export function viewerPalette(tokens: Partial<CanvasTokens> | null): ViewerPalette {
  const out = { ...VIEWER_PALETTE_FALLBACK };
  if (tokens) for (const key of Object.keys(out) as (keyof ViewerPalette)[]) if (tokens[key]) out[key] = tokens[key];
  return out;
}

export function getTheme(root: HTMLElement = document.documentElement): Theme {
  const value = root.getAttribute("data-theme");
  return isTheme(value) ? value : DEFAULT_THEME;
}

/** Sets `data-theme` on <html> (the workspace's theme store does this with persistence, Story 3.8). */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

type Listener = (tokens: CanvasTokens) => void;

const listeners = new Set<Listener>();
let observer: MutationObserver | null = null;

function ensureObserver(): void {
  // Outside a DOM (workers, node tests) there is no theme to follow.
  if (observer || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  observer = new MutationObserver(() => {
    const tokens = readCanvasTokens();
    for (const cb of [...listeners]) cb(tokens);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/**
 * Calls `cb` with fresh tokens after every `data-theme` change on <html>.
 * One MutationObserver is shared by all subscribers. Returns an unsubscribe function.
 */
export function subscribeCanvasTokens(cb: Listener): () => void {
  listeners.add(cb);
  ensureObserver();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}
