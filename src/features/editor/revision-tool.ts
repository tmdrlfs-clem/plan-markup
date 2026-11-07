// Story 7.7 (FR37, UX-DR27): the Revision stamp tool. A click places a stamp
// centred on it, upright on screen: the revision after the document's latest
// one, today's date, the signed-in user's name and "As-built" (all editable in
// Properties); then Select has it, as after an image.

import { uuidv7 } from "@/core/ids/uuid";
import type { Point } from "@/core/markup/geometry";
import { newRevisionMeta, revisionMarkupAt } from "@/core/markup/revision";
import type { RevisionMarkup } from "@/core/schema/markup";
import { setTool } from "@/features/viewer";

import { editorStore, markupsOf, setSelection } from "./editor-store";
import { lastViewOf } from "./text-tool";
import { executeOp } from "./undo-store";

export const ADD_REVISION = "Add revision stamp";

let author = "";

/** The signed-in user's name, a new stamp's author (the workspace sets it). */
export function setRevisionAuthor(name: string): void {
  author = name;
}

/** The stamp a click at `point` would place on page `pageId` of `documentId`. */
export function revisionAt(point: Point, documentId: string, pageId: string, now: Date = new Date()): RevisionMarkup {
  const view = lastViewOf(pageId);
  const meta = newRevisionMeta(markupsOf(editorStore.getState(), documentId), author, now);
  return revisionMarkupAt(meta, point, pageId, view?.toDevice ?? ((p) => ({ x: p.x, y: -p.y })), view?.userUnit ?? 1, uuidv7(), now.toISOString());
}

/** Places a stamp at `point` (one undo step); Select then has it. */
export function placeRevision(point: Point, documentId: string, pageId: string): "done" {
  const markup = revisionAt(point, documentId, pageId);
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_REVISION);
  setTool("select");
  setSelection([markup.id]);
  return "done";
}
