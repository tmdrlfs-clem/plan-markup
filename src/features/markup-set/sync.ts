"use client";

// Story 6.1 (A1, AR5): the server's markup set of the open file. Opening a PDF
// makes nothing; the first edit (or calibration) of a document asks the
// server for its set (made when the hash is new to the user: drawing, file,
// pages). Calibrations then save by the server's page ids, batched, after
// each op that changes them (do, undo and redo). Markups save from Story 6.2;
// a failed save is tried again with the next change (Story 6.3 queues them).

import { useEffect } from "react";

import type { Calibration } from "@/core/calibration/calibration";
import { opParts, type DocOp } from "@/core/commands/ops";
import { pageGeometryOf, setFilename, type CalibrationEntry, type EnsureMarkupSetInput, type MarkupSetIds } from "@/core/markup-set/markup-set";
import type { Result } from "@/lib/result";
import { subscribeAppliedOps } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { ensureMarkupSet, saveSetCalibrations } from "./actions";

/** Calibration changes wait this long for more before they are sent. */
export const SAVE_DELAY_MS = 300;

type Viewer = { documentId: string | null; fileName: string | null; pages: readonly Parameters<typeof pageGeometryOf>[0][]; calibrations: Readonly<Record<string, Calibration>> };

export type SyncDeps = {
  ensure: (input: EnsureMarkupSetInput) => Promise<Result<MarkupSetIds>>;
  save: (entries: CalibrationEntry[]) => Promise<Result<null>>;
  viewer: () => Viewer;
  delayMs?: number;
};

export type MarkupSetSync = {
  /** Hears an applied op. */
  onOp: (op: DocOp) => void;
  /** The set of `documentId` once known (tests). */
  ids: (documentId: string) => Promise<MarkupSetIds | null>;
  /** Sends what waits now (tests). */
  flush: () => Promise<void>;
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
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  const flush = async () => {
    timer = null;
    const batches = [...waiting];
    waiting.clear();
    await Promise.all(
      batches.map(async ([documentId, changes]) => {
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
    );
  };

  const schedule = () => {
    if (timer === null) timer = setTimeout(() => void flush(), deps.delayMs ?? SAVE_DELAY_MS);
  };

  const onOp = (op: DocOp) => {
    void ensure(op.documentId);
    const viewer = deps.viewer();
    for (const part of opParts(op)) {
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
      viewer: () => viewerStore.getState(),
    });
    const unsubscribe = subscribeAppliedOps(sync.onOp);
    return () => {
      unsubscribe();
      void sync.flush();
      sync.dispose();
    };
  }, []);
}
