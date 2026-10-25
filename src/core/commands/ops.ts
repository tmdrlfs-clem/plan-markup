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
    const placed = op.markups.map((m, i) => ({ m, at: at[i] })).sort((a, b) => a.at - b.at);
    for (const p of placed) out.splice(Math.min(p.at, out.length), 0, p.m);
    return out;
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
