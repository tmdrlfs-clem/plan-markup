// Story 5.10: the Properties panel's edits and the format painter (FR34). A
// change applies to the selected markups that are not locked, at once, as one
// undo step. The format painter copies one markup's style; a click with Select
// on a markup then applies it (to its group too), as one undo step, and the
// painter is put away (D3: one use, as Revu's single click); Esc, a click on
// empty page space or the button again put it away unused.

import { createStore } from "zustand/vanilla";

import { withGroups } from "@/core/markup/arrange";
import { formatOf, withChange, withFormat, type PropertyChange } from "@/core/markup/properties";
import type { Markup, MarkupStyle } from "@/core/schema/markup";
import { viewerStore } from "@/features/viewer";

import { editorStore, isLocked, markupsOf } from "./editor-store";
import { lockedNote } from "./select-tool";
import { executeOp } from "./undo-store";

export const CHANGE_PROPERTIES = "Change properties";
export const APPLY_FORMAT = "Apply format";

/** The undo label of a change of one field. */
const CHANGE_LABELS: Record<keyof PropertyChange, string> = {
  color: "Change colour",
  width: "Change line width",
  fill: "Change fill",
  opacity: "Change opacity",
  fontSize: "Change text size",
  dash: "Change dash",
  font: "Change font",
  bold: "Bold",
  italic: "Italic",
  underline: "Underline text",
  strike: "Strike through text",
  align: "Align text",
  cloud: "Cloud border",
  uri: "Change link",
  revision: "Edit revision stamp",
  legend: "Edit legend",
  subject: "Change subject",
  text: "Edit text",
};

/** The selected markups of `documentId`, as stored, in drawing order. */
export function selectedMarkups(documentId: string | null): Markup[] {
  const ids = new Set(editorStore.getState().selection.ids);
  return markupsOf(editorStore.getState(), documentId).filter((m) => ids.has(m.id));
}

/** Applies `change` to `markups` not locked, one undo step; false when nothing changed (a locked selection says why). */
export function changeProperties(documentId: string, markups: readonly Markup[], change: PropertyChange): boolean {
  const free = markups.filter((m) => !isLocked(m));
  if (free.length === 0) {
    if (markups.length > 0) lockedNote();
    return false;
  }
  const before: Markup[] = [];
  const after: Markup[] = [];
  for (const m of free) {
    const next = withChange(m, change);
    if (next === m) continue;
    before.push(m);
    after.push(next);
  }
  if (before.length === 0) return false;
  const keys = Object.keys(change) as (keyof PropertyChange)[];
  executeOp({ kind: "markups.update", documentId, before, after }, keys.length === 1 ? CHANGE_LABELS[keys[0]] : CHANGE_PROPERTIES);
  return true;
}

/** The format painter: the style copied, from which markup (null: put away). */
export const formatPainter = createStore<{ format: MarkupStyle | null; from: string | null }>(() => ({ format: null, from: null }));

/** Copies `m`'s format; the next click on a markup applies it. */
export function copyFormat(m: Markup): void {
  formatPainter.setState({ format: formatOf(m), from: m.id });
}

/** Puts the format painter away; false when it was not out. */
export function dropFormat(): boolean {
  if (!formatPainter.getState().format) return false;
  formatPainter.setState({ format: null, from: null });
  return true;
}

/**
 * Story 5.10: a Select press with the painter out: on a markup, applies the format to it and its
 * group (not locked ones), one undo step, and puts the painter away; on empty space, puts it away.
 * True when the press was the painter's.
 */
export function paintFormat(hit: Markup | null, documentId: string): boolean {
  const { format } = formatPainter.getState();
  if (!format) return false;
  dropFormat();
  if (!hit) return false;
  const page = markupsOf(editorStore.getState(), documentId).filter((m) => m.pageId === hit.pageId);
  const ids = new Set(withGroups(page, [hit.id]));
  const targets = page.filter((m) => ids.has(m.id));
  const free = targets.filter((m) => !isLocked(m));
  if (free.length === 0) {
    lockedNote();
    return true;
  }
  const before: Markup[] = [];
  const after: Markup[] = [];
  for (const m of free) {
    const next = withFormat(m, format);
    if (next === m) continue;
    before.push(m);
    after.push(next);
  }
  if (before.length > 0) executeOp({ kind: "markups.update", documentId, before, after }, APPLY_FORMAT);
  return true;
}

// Another tool or document puts the painter away.
viewerStore.subscribe((s, prev) => {
  if (s.tool !== prev.tool || s.documentId !== prev.documentId) dropFormat();
});
