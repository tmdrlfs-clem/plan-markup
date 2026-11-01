// Document operations (Story 4.5, AR13). Framework-free.
//
// Every document mutation is a serialisable op: the editor turns it into an
// undo command ({ do, undo, label }) and serialises the history as ops
// (UX-DR36: it survives a reload until the browser tab closes); Epic 6 sends
// the same ops to the server. An op's inverse undoes it.

import { z } from "zod";

import { calibrationSchema, type Calibration } from "@/core/calibration/calibration";
import { markupSchema, type Markup } from "@/core/schema/markup";

const documentId = z.string().min(1).max(128);
const calibrationMap = z.record(z.string().min(1).max(200), calibrationSchema.nullable());
/**
 * Review R1: where the markups are in the document's list (drawing order), one
 * index per markup: a removal records them so its undo puts each markup back
 * where it was, not on top. Absent on an add: the markups go on top.
 */
const positions = z.array(z.number().int().min(0).max(1_000_000)).max(10_000).optional();

export const docOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markups.add"), documentId, markups: z.array(markupSchema).max(10_000), at: positions }),
  z.object({ kind: z.literal("markups.remove"), documentId, markups: z.array(markupSchema).max(10_000), at: positions }),
  /** Story 4.6: markups changed in place (same ids), as they were and as they are. */
  z.object({ kind: z.literal("markups.update"), documentId, before: z.array(markupSchema).max(10_000), after: z.array(markupSchema).max(10_000) }),
  /**
   * Story 5.3: markups moved in the drawing order: `ids`, where they were
   * (`from`) and where they go (`to`), as positions in the list before and after.
   */
  z.object({
    kind: z.literal("markups.reorder"),
    documentId,
    ids: z.array(z.string().min(1).max(64)).max(10_000),
    from: z.array(z.number().int().min(0).max(1_000_000)).max(10_000),
    to: z.array(z.number().int().min(0).max(1_000_000)).max(10_000),
  }),
  /** Calibrations by page id before and after (null: none). */
  z.object({ kind: z.literal("calibrations.set"), documentId, before: calibrationMap, after: calibrationMap }),
]);

export type DocOp = z.infer<typeof docOpSchema>;

/** The op that undoes `op`. */
export function invertOp(op: DocOp): DocOp {
  switch (op.kind) {
    case "markups.add":
      return { kind: "markups.remove", documentId: op.documentId, markups: op.markups, ...(op.at ? { at: op.at } : {}) };
    case "markups.remove":
      return { kind: "markups.add", documentId: op.documentId, markups: op.markups, ...(op.at ? { at: op.at } : {}) };
    case "markups.update":
      return { kind: "markups.update", documentId: op.documentId, before: op.after, after: op.before };
    case "markups.reorder":
      return { kind: "markups.reorder", documentId: op.documentId, ids: op.ids, from: op.to, to: op.from };
    case "calibrations.set":
      return { kind: "calibrations.set", documentId: op.documentId, before: op.after, after: op.before };
  }
}

/**
 * The op removing the markups `ids` from `markups` (the document's list), with
 * their positions so its undo restores the drawing order. Null when none is there.
 */
export function removeMarkupsOp(documentId: string, markups: readonly Markup[], ids: Iterable<string>): DocOp | null {
  const wanted = new Set(ids);
  const at: number[] = [];
  const removed: Markup[] = [];
  markups.forEach((m, i) => {
    if (!wanted.has(m.id)) return;
    at.push(i);
    removed.push(m);
  });
  return removed.length > 0 ? { kind: "markups.remove", documentId, markups: removed, at } : null;
}

/** Inserts `items` at their positions in the list as it will be (ascending insertion restores it). */
function insertAt(list: Markup[], items: readonly Markup[], at: readonly number[]): Markup[] {
  const placed = items.map((m, i) => ({ m, at: at[i] })).sort((a, b) => a.at - b.at);
  for (const p of placed) list.splice(Math.min(p.at, list.length), 0, p.m);
  return list;
}

/**
 * Story 5.3: the op putting `markups` (the document's list) in `order` (the same ids, another
 * order), moving only the markups whose position changes; null when none does.
 */
export function reorderMarkupsOp(documentId: string, markups: readonly Markup[], order: readonly string[]): DocOp | null {
  const before = new Map(markups.map((m, i) => [m.id, i]));
  const ids: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  order.forEach((id, i) => {
    const was = before.get(id);
    if (was === undefined || was === i) return;
    ids.push(id);
    from.push(was);
    to.push(i);
  });
  return ids.length > 0 ? { kind: "markups.reorder", documentId, ids, from, to } : null;
}

/**
 * A document's markups after a markups op. An add puts the markups on top, or
 * back at their positions (`at`, the undo of a removal); an id already present
 * is replaced (a redo after a restore never duplicates). A removal drops them.
 */
export function applyMarkupsOp(markups: readonly Markup[], op: DocOp): Markup[] {
  if (op.kind === "markups.add") {
    const ids = new Set(op.markups.map((m) => m.id));
    const out = markups.filter((m) => !ids.has(m.id));
    const at = op.at;
    if (!at || at.length !== op.markups.length) return [...out, ...op.markups];
    // Ascending positions in the list as it was: inserting in that order restores it.
    return insertAt(out, op.markups, at);
  }
  if (op.kind === "markups.reorder") {
    // The moved markups out, then back at their new positions (ids no longer there are skipped).
    const byId = new Map(markups.map((m) => [m.id, m]));
    const moved: Markup[] = [];
    const at: number[] = [];
    op.ids.forEach((id, i) => {
      const m = byId.get(id);
      if (!m) return;
      moved.push(m);
      at.push(op.to[i]);
    });
    const ids = new Set(moved.map((m) => m.id));
    return insertAt(markups.filter((m) => !ids.has(m.id)), moved, at);
  }
  if (op.kind === "markups.update") {
    // In place: the drawing order stays; an id that is not there is not added.
    const next = new Map(op.after.map((m) => [m.id, m]));
    return markups.map((m) => next.get(m.id) ?? m);
  }
  if (op.kind === "markups.remove") {
    const ids = new Set(op.markups.map((m) => m.id));
    return markups.filter((m) => !ids.has(m.id));
  }
  return [...markups];
}

/** Calibrations by page id after a calibrations op. */
export function applyCalibrationsOp(calibrations: Readonly<Record<string, Calibration>>, op: DocOp): Record<string, Calibration> {
  const next = { ...calibrations };
  if (op.kind !== "calibrations.set") return next;
  for (const [id, value] of Object.entries(op.after)) {
    if (value) next[id] = value;
    else delete next[id];
  }
  return next;
}
