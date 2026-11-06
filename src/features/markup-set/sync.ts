"use client";

// Story 6.1 (A1, AR5): the server's markup set of the open file. Opening a PDF
// makes nothing; the first edit (or calibration) of a document asks the
// server for its set (made when the hash is new to the user: drawing, file,
// pages). Calibrations then save by the server's page ids, batched, after
// each op that changes them (do, undo and redo). Story 6.2: markup changes are
// diffed against what was last saved and sent as ops (one request in flight
// per document); a failed save is tried again with the next change (Story 6.3
// queues them).

import { useEffect } from "react";

import type { Calibration } from "@/core/calibration/calibration";
import { opParts, type DocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import { diffMarkups, MAX_OPS, type ApplyMarkupOpsInput, type MarkupChange, type MarkupOp, type MarkupOpResult, type SavedMarkup } from "@/core/markup-set/markup-ops";
import { pageGeometryOf, setFilename, type CalibrationEntry, type EnsureMarkupSetInput, type MarkupSetIds } from "@/core/markup-set/markup-set";
import type { Markup } from "@/core/schema/markup";
import type { Result } from "@/lib/result";
import { editorStore, subscribeAppliedOps } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { applyMarkupOps, ensureMarkupSet, saveSetCalibrations } from "./actions";

/** Changes wait this long for more before they are sent. */
export const SAVE_DELAY_MS = 300;
/** A request carries ops up to about this many bytes of JSON (more go in the next request; one op always goes). */
export const MAX_REQUEST_BYTES = 4_000_000;

type Viewer = { documentId: string | null; fileName: string | null; pages: readonly Parameters<typeof pageGeometryOf>[0][]; calibrations: Readonly<Record<string, Calibration>> };

export type SyncDeps = {
  ensure: (input: EnsureMarkupSetInput) => Promise<Result<MarkupSetIds>>;
  save: (entries: CalibrationEntry[]) => Promise<Result<null>>;
  /** Story 6.2: applies markup ops on the server. */
  apply: (input: ApplyMarkupOpsInput) => Promise<Result<MarkupOpResult[]>>;
  viewer: () => Viewer;
  /** Story 6.2: a document's markups in drawing order. */
  markups: (documentId: string) => readonly Markup[] | undefined;
  delayMs?: number;
  now?: () => number;
  newId?: () => string;
};

/** Story 6.2: a document's markups as last saved, and their server versions (kept after a delete, for its undo). */
type MarkupState = { saved: Map<string, SavedMarkup>; versions: Map<string, number>; dirty: boolean; sending: boolean };

export type MarkupSetSync = {
  /** Hears an applied op. */
  onOp: (op: DocOp) => void;
  /** The set of `documentId` once known (tests). */
  ids: (documentId: string) => Promise<MarkupSetIds | null>;
  /** Sends what waits now (tests). */
  flush: () => Promise<void>;
  /** The server version of a markup as last known (tests). */
  version: (documentId: string, markupId: string) => number | undefined;
  dispose: () => void;
};

/** Page index of a calibration key (`<sha256>:<index>`, core/calibration pageIdOf) of `documentId`; null for another document's. */
function pageIndexOf(key: string, documentId: string): number | null {
  if (!key.startsWith(`${documentId}:`)) return null;
  const index = Number(key.slice(documentId.length + 1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function createMarkupSetSync(deps: SyncDeps): MarkupSetSync {
  const sets = new Map<string, Promise<MarkupSetIds | null>>();
  /** Calibrations waiting to be sent, by document then calibration key (null: removed). */
  const waiting = new Map<string, Map<string, Calibration | null>>();
  const markupStates = new Map<string, MarkupState>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => uuidv7());

  const markupState = (documentId: string): MarkupState => {
    let state = markupStates.get(documentId);
    if (!state) markupStates.set(documentId, (state = { saved: new Map(), versions: new Map(), dirty: false, sending: false }));
    return state;
  };

  const ensure = (documentId: string): Promise<MarkupSetIds | null> => {
    const known = sets.get(documentId);
    if (known) return known;
    const viewer = deps.viewer();
    // Only the open document's pages are known here (ops run in the active tab).
    if (viewer.documentId !== documentId || viewer.pages.length === 0) return Promise.resolve(null);
    const input: EnsureMarkupSetInput = { sha256: documentId, filename: setFilename(viewer.fileName), pages: viewer.pages.map(pageGeometryOf) };
    const pending = deps.ensure(input).then(
      (result) => (result.ok ? result.data : null),
      () => null,
    );
    sets.set(documentId, pending);
    // A failure is forgotten, so the next edit asks again.
    void pending.then((ids) => {
      if (!ids && sets.get(documentId) === pending) sets.delete(documentId);
    });
    return pending;
  };

  /** The op for a change (the page id mapped from the client key by index), or null for a page the set does not know. */
  const opOf = (change: MarkupChange, state: MarkupState, documentId: string, ids: MarkupSetIds, clientTs: number): MarkupOp | null => {
    const base = { opId: newId(), clientTs };
    if (change.kind === "create") {
      const index = pageIndexOf(change.row.pageId, documentId);
      const pageId = index === null ? undefined : ids.pageIds[index];
      if (!pageId) return null;
      const { geometry, style, props } = change.row;
      return { ...base, markupId: change.row.id, kind: "create", type: change.row.type, pageId, baseVersion: state.versions.get(change.row.id) ?? 0, fields: { geometry, style, props, z: change.z } };
    }
    const baseVersion = state.versions.get(change.id) ?? 0;
    if (change.kind === "delete") return { ...base, markupId: change.id, kind: "delete", type: change.type, baseVersion };
    return { ...base, markupId: change.id, kind: "update", type: change.type, baseVersion, fields: change.fields };
  };

  /** Splits ops into requests of about MAX_REQUEST_BYTES (an image markup can be megabytes). */
  const requestsOf = (ops: readonly MarkupOp[]): MarkupOp[][] => {
    const requests: MarkupOp[][] = [[]];
    let bytes = 0;
    for (const op of ops) {
      const size = JSON.stringify(op).length;
      const last = requests[requests.length - 1];
      if (last.length > 0 && (bytes + size > MAX_REQUEST_BYTES || last.length >= MAX_OPS)) {
        requests.push([op]);
        bytes = size;
      } else {
        last.push(op);
        bytes += size;
      }
    }
    return requests;
  };

  /**
   * Sends a document's markup changes since the last save, one request at a
   * time per document. Only what the server confirmed becomes the saved state:
   * the rest is diffed again with the next change.
   */
  const sendMarkups = async (documentId: string): Promise<void> => {
    const state = markupState(documentId);
    if (state.sending || !state.dirty) return;
    state.sending = true;
    state.dirty = false;
    try {
      const ids = await ensure(documentId);
      if (!ids) {
        state.dirty = true;
        return;
      }
      // Markups on pages the set does not know stay local (they are never saved).
      const current = (deps.markups(documentId) ?? []).filter((m) => {
        const index = pageIndexOf(m.pageId, documentId);
        return index !== null && ids.pageIds[index] !== undefined;
      });
      const { changes, next } = diffMarkups(state.saved, current);
      if (changes.length === 0) {
        state.saved = next;
        return;
      }
      const clientTs = now();
      const ops = changes.map((c) => opOf(c, state, documentId, ids, clientTs)).filter((op): op is MarkupOp => op !== null);
      for (const batch of requestsOf(ops)) {
        const result = await deps.apply({ drawingId: ids.drawingId, ops: batch }).catch(() => null);
        if (!result?.ok) {
          state.dirty = true;
          return;
        }
        for (const r of result.data) {
          state.versions.set(r.markupId, r.version);
          const op = batch.find((o) => o.opId === r.opId);
          if (!op) continue;
          // Confirmed: the saved state takes the op's markup as it is now (or drops a deleted one).
          if (op.kind === "delete") state.saved.delete(op.markupId);
          else if (r.status === "missing") {
            // Unknown to the server (its create was never applied): made again next time.
            state.saved.delete(op.markupId);
            state.dirty = true;
          } else {
            const entry = next.get(op.markupId);
            if (entry) state.saved.set(op.markupId, entry);
          }
        }
      }
      // Unchanged markups whose saved entry only moved in the map (same object) are already there.
    } finally {
      state.sending = false;
      if (state.dirty) schedule();
    }
  };

  const flush = async () => {
    timer = null;
    const dirty = [...markupStates].filter(([, s]) => s.dirty).map(([id]) => id);
    const batches = [...waiting];
    waiting.clear();
    await Promise.all([
      ...dirty.map((documentId) => sendMarkups(documentId)),
      ...batches.map(async ([documentId, changes]) => {
        const ids = await ensure(documentId);
        const entries: CalibrationEntry[] = [];
        for (const [key, calibration] of changes) {
          const index = pageIndexOf(key, documentId);
          const pageId = index === null ? undefined : ids?.pageIds[index];
          if (pageId) entries.push({ pageId, calibration });
        }
        // Without a set (not made yet, offline) nothing is sent and everything is kept.
        const saved = ids !== null && (entries.length === 0 || (await deps.save(entries).catch(() => null))?.ok === true);
        if (!saved) {
          // Kept for the next change, unless a newer value is already waiting.
          const again = waiting.get(documentId) ?? new Map<string, Calibration | null>();
          for (const [key, value] of changes) if (!again.has(key)) again.set(key, value);
          waiting.set(documentId, again);
        }
      }),
    ]);
  };

  const schedule = () => {
    if (timer === null) timer = setTimeout(() => void flush(), deps.delayMs ?? SAVE_DELAY_MS);
  };

  const onOp = (op: DocOp) => {
    void ensure(op.documentId);
    const viewer = deps.viewer();
    for (const part of opParts(op)) {
      if (part.kind.startsWith("markups.")) {
        markupState(part.documentId).dirty = true;
        schedule();
      }
      if (part.kind !== "calibrations.set" || viewer.documentId !== part.documentId) continue;
      const changes = waiting.get(part.documentId) ?? new Map<string, Calibration | null>();
      for (const key of new Set([...Object.keys(part.before), ...Object.keys(part.after)])) changes.set(key, viewer.calibrations[key] ?? null);
      waiting.set(part.documentId, changes);
      schedule();
    }
    // A waiting retry goes with this change.
    if (waiting.size) schedule();
  };

  return {
    onOp,
    ids: (documentId) => sets.get(documentId) ?? Promise.resolve(null),
    flush,
    version: (documentId, markupId) => markupStates.get(documentId)?.versions.get(markupId),
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Keeps the signed-in user's markup sets in step with their edits (mounted once in the workspace). */
export function useMarkupSetSync(): void {
  useEffect(() => {
    const sync = createMarkupSetSync({
      ensure: ensureMarkupSet,
      save: saveSetCalibrations,
      apply: applyMarkupOps,
      viewer: () => viewerStore.getState(),
      markups: (documentId) => editorStore.getState().doc.markups[documentId],
    });
    const unsubscribe = subscribeAppliedOps(sync.onOp);
    return () => {
      unsubscribe();
      void sync.flush();
      sync.dispose();
    };
  }, []);
}
