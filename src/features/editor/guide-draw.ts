/**
 * The 4541 panel's Add head line (founder feedback 2026-11-12: heads follow the
 * lights, so the designer shows where a row runs). It arms the Line tool in
 * head-line mode: each line drawn is a head line (a line markup flagged
 * `guide`), until another tool is chosen. Place heads puts a row on a line
 * along the rows, and prefers the crossings of lines across them.
 */
import { createStore } from "zustand/vanilla";

import type { Markup } from "@/core/schema/markup";
import { GUIDE_STYLE, GUIDE_SUBJECT, type GuideMarkup } from "@/core/sprinkler/heads";
import { setTool, viewerStore } from "@/features/viewer";

export const ADD_HEAD_LINE = "Add head line";

export const guideDrawStore = createStore<{ on: boolean }>(() => ({ on: false }));

let unsubscribe: (() => void) | null = null;

/** Arms the Line tool to draw head lines; choosing any other tool ends it. */
export function armGuideDraw(): void {
  guideDrawStore.setState({ on: true });
  setTool("line");
  unsubscribe ??= viewerStore.subscribe((s) => {
    if (s.tool !== "line") endGuideDraw();
  });
}

export function endGuideDraw(): void {
  if (guideDrawStore.getState().on) guideDrawStore.setState({ on: false });
  unsubscribe?.();
  unsubscribe = null;
}

/** Whether the Line tool's next line is a head line. */
export function makesGuide(): boolean {
  return guideDrawStore.getState().on && viewerStore.getState().tool === "line";
}

/** The head line a drawn line makes. */
export function guideOf(line: Extract<Markup, { type: "line" }>): GuideMarkup {
  return { ...line, style: GUIDE_STYLE, subject: GUIDE_SUBJECT, guide: true };
}
