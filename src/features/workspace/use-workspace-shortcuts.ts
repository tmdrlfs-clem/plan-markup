"use client";

import { useEffect, useRef } from "react";

import { LEFT_PANELS, MARKUPS_LIST, type LeftPanelId } from "./panel-registry";

export interface WorkspaceShortcutHandlers {
  open: () => void;
  showLeftPanel: (id: LeftPanelId) => void;
  toggleMarkupsList: () => void;
  hideAllPanels: () => void;
  /** Ctrl+F with the canvas focused: the Search panel, query field focused (Story 3.6). */
  search?: () => void;
  /** F3 / Shift+F3: next / previous search result. */
  searchStep?: (direction: 1 | -1) => void;
}

const CANVAS = "[data-testid='drawing-canvas']";
const SEARCH_PANEL = "[data-testid='search-panel']";

function onCanvas(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(CANVAS);
}

/** F3 acts on the canvas, in the Search panel, or with nothing focused. */
function searchScope(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target === document.body || target === document.documentElement || onCanvas(target) || target.closest(SEARCH_PANEL) !== null;
}

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

function inEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * Ctrl+O follows the printed letter (Dvorak, AZERTY); layouts without Latin letters
 * (Cyrillic, Hangul) fall back to the physical key.
 */
function isLetter(event: KeyboardEvent, letter: string): boolean {
  const key = event.key.toLowerCase();
  return /^[a-z]$/.test(key) ? key === letter : event.code === `Key${letter.toUpperCase()}`;
}

function resolve(event: KeyboardEvent, handlers: WorkspaceShortcutHandlers): (() => void) | null {
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && !event.altKey && !event.shiftKey && isLetter(event, "o")) return handlers.open;
  // Ctrl+F is in-app only with the canvas focused; elsewhere the browser keeps it (UX shortcut table).
  if (ctrl && !event.altKey && !event.shiftKey && isLetter(event, "f") && onCanvas(event.target) && handlers.search) return handlers.search;
  if (event.key === "F3" && !ctrl && !event.altKey && searchScope(event.target) && handlers.searchStep) {
    const step = handlers.searchStep;
    const direction = event.shiftKey ? -1 : 1;
    return () => step(direction);
  }
  if (inEditable(event.target)) return null;

  if (event.altKey && !ctrl && !event.shiftKey) {
    const panel = LEFT_PANELS.find((p) => p.code === event.code);
    if (panel) return () => handlers.showLeftPanel(panel.id);
    if (event.code === MARKUPS_LIST.code) return handlers.toggleMarkupsList;
  }
  if (event.shiftKey && !ctrl && !event.altKey && event.key === "F4") return handlers.hideAllPanels;
  return null;
}

/**
 * Handles one key event; returns true when it was a workspace shortcut. Alt combinations use
 * `code` because macOS turns Alt+X into "≈" in `key`. Only Ctrl+O works inside fields.
 * A held key (auto-repeat) is still claimed but runs the action only once.
 */
export function handleWorkspaceShortcut(event: KeyboardEvent, handlers: WorkspaceShortcutHandlers): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const action = resolve(event, handlers);
  if (!action) return false;
  if (!event.repeat) action();
  return true;
}

/** Workspace-level keys until the editor's command registry takes over. */
export function useWorkspaceShortcuts(handlers: WorkspaceShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // preventDefault also suppresses the browser's own Ctrl+O file dialog.
      if (handleWorkspaceShortcut(event, latest.current)) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
