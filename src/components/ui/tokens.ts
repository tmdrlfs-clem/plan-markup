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
    success: readVar(style, "--success"),
    coverageFill: readVar(style, "--canvas-coverage-fill"),
    coverageOutline: readVar(style, "--canvas-coverage-outline"),
    zoneOutline: readVar(style, "--canvas-zone"),
    searchHit: readVar(style, "--canvas-search-hit"),
    searchCurrent: readVar(style, "--canvas-search-current"),
    searchOutline: readVar(style, "--canvas-search-outline"),
    surround: readVar(style, "--surface-0"),
    handleSize: Number.isFinite(handle) ? handle : DEFAULT_HANDLE_SIZE,
    fontFamily: readVar(style, "--font-inter") || getComputedStyle(el).fontFamily,
  };
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
