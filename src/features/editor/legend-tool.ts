// Story 7.8 (FR38, UX-DR27): the Legend tool. A click places a legend centred
// on it, upright on screen, sized to the devices placed on its page so far;
// then Select has it. Its rows follow the markups live (painted, never stored);
// Properties edits its title and scope (this page or the whole document).

import { uuidv7 } from "@/core/ids/uuid";
import type { Point } from "@/core/markup/geometry";
import { DEFAULT_LEGEND_TITLE, legendMarkupAt, legendRows, legendScopeMarkups } from "@/core/markup/legend";
import type { LegendMarkup, LegendMeta, Markup } from "@/core/schema/markup";
import { setTool } from "@/features/viewer";

import { editorStore, markupsOf, setSelection } from "./editor-store";
import { lastViewOf } from "./text-tool";
import { executeOp } from "./undo-store";

export const ADD_LEGEND = "Add legend";

/** A new legend's title and scope (D: this page). */
export const NEW_LEGEND: LegendMeta = { title: DEFAULT_LEGEND_TITLE, scope: "page" };

/** The markups of `documentId` a legend of `meta` on page `pageId` counts. */
export function legendMarkups(documentId: string, meta: LegendMeta, pageId: string): Markup[] {
  return legendScopeMarkups(markupsOf(editorStore.getState(), documentId), meta.scope, pageId);
}

/** The legend a click at `point` would place on page `pageId` of `documentId`. */
export function legendAt(point: Point, documentId: string, pageId: string, now: Date = new Date()): LegendMarkup {
  const view = lastViewOf(pageId);
  const rows = legendRows(legendMarkups(documentId, NEW_LEGEND, pageId));
  return legendMarkupAt(NEW_LEGEND, rows, point, pageId, view?.toDevice ?? ((p) => ({ x: p.x, y: -p.y })), view?.userUnit ?? 1, uuidv7(), now.toISOString());
}

/** Places a legend at `point` (one undo step); Select then has it. */
export function placeLegend(point: Point, documentId: string, pageId: string): "done" {
  const markup = legendAt(point, documentId, pageId);
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_LEGEND);
  setTool("select");
  setSelection([markup.id]);
  return "done";
}
