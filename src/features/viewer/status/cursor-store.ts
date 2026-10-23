// The pointer's position on the page for the status bar's X/Y readout
// (Story 3.7 AC 5). PDF user space units (points), origin at the bottom-left
// corner of the unrotated page, whatever the view's zoom and rotation. Written
// by the active tab's ViewerEngine at most once per animation frame; the
// readout subscribes to it and writes its text node directly (no React render
// per move). Story 4.1 writes the snapped point here instead.

import { createStore } from "zustand/vanilla";

export type CursorPoint = { x: number; y: number };

export const cursorStore = createStore<{ point: CursorPoint | null }>(() => ({ point: null }));

/** Sets the cursor point (null: off the page or no drawing); same values change nothing. */
export function setCursor(point: CursorPoint | null): void {
  const current = cursorStore.getState().point;
  if (point === current) return;
  if (point && current && point.x === current.x && point.y === current.y) return;
  cursorStore.setState({ point });
}
