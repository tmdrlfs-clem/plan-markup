"use client";

import { useEffect, useRef } from "react";

import { LEFT_PANELS, MARKUPS_LIST, type LeftPanelId } from "./panel-registry";

export interface WorkspaceShortcutHandlers {
  open: () => void;
  showLeftPanel: (id: LeftPanelId) => void;
  toggleMarkupsList: () => void;
  hideAllPanels: () => void;
}

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

function inEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * Handles one key event; returns true when it was a workspace shortcut. Alt combinations use
 * `code` because macOS turns Alt+X into "≈" in `key`. Only Ctrl+O works inside fields.
 */
export function handleWorkspaceShortcut(event: KeyboardEvent, handlers: WorkspaceShortcutHandlers): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && !event.altKey && !event.shiftKey && event.code === "KeyO") {
    handlers.open();
    return true;
  }
  if (inEditable(event.target)) return false;

  if (event.altKey && !ctrl && !event.shiftKey) {
    const panel = LEFT_PANELS.find((p) => p.code === event.code);
    if (panel) {
      handlers.showLeftPanel(panel.id);
      return true;
    }
    if (event.code === MARKUPS_LIST.code) {
      handlers.toggleMarkupsList();
      return true;
    }
  }
  if (event.shiftKey && !ctrl && !event.altKey && event.key === "F4") {
    handlers.hideAllPanels();
    return true;
  }
  return false;
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
