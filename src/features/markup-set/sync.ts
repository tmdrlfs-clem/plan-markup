"use client";

// Stories 6.1–6.3 (A1, A4, AR5, AR10, NFR3, NFR37): the user's edits saved to
// their markup sets, whatever the network does.
//
// 1. An applied op (do, undo, redo) marks its document. About 300 ms later
//    the document's markups are diffed against what was last queued (a
//    snapshot of hashes in sessionStorage, so it lives as long as the editor's
//    own session) and the changes, with any calibration changes, go into the
//    local queue (IndexedDB) before anything is sent. Undo of a synced change
//    is simply the next change (a compensating op, A4).
// 2. The queue is sent in order, one request at a time: the set is asked for
//    (made on the first edit of a hash, Story 6.1) from what the queue
//    recorded about the file, client page keys become server page ids and each
//    op takes the markup's latest known server version as its base (so a
//    conflict re-bases itself). An entry leaves the queue only once the server
//    confirmed it.
// 3. A failure retries with exponential backoff capped at 30 s, at once on
//    `online`, on Ctrl+S and on Retry. The SaveIndicator shows the state.
// 4. Story 6.4: opening a file whose hash has a set (and that this browser
//    tab's session does not already hold) shows the set as last in step with
//    the server (IndexedDB) after the first frame, then the server's own;
//    edits made meanwhile win, and the queue goes before the server is asked.

import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { z } from "zod";

import type { Calibration } from "@/core/calibration/calibration";
import { opParts, type DocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import { diffMarkups, MAX_OPS, savedMarkup, savedMarkupSchema, type ApplyMarkupOpsInput, type MarkupChange, type MarkupOp, type MarkupOpResult, type SavedMarkup } from "@/core/markup-set/markup-ops";
import { pageGeometryOf, setFilename, type CalibrationEntry, type EnsureMarkupSetInput, type MarkupSetIds } from "@/core/markup-set/markup-set";
import type { Layer } from "@/core/schema/layer";
import type { Markup } from "@/core/schema/markup";
import type { LoadedMarkupSet } from "@/lib/db/markups";
import { openOpQueue, type CachedSet, type OpQueueBackend, type QueueEntry, type QueuedMarkupOp } from "@/lib/idb/op-queue";
import type { Result, ResultCode } from "@/lib/result";
import { editorStore, layersOf, setDocLayers, setDocMarkups, subscribeAppliedOps } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { applyMarkupOps, ensureMarkupSet, hasMarkupsOnOtherVersion, loadMarkupSet, saveSetCalibrations } from "./actions";
import { markOtherVersion } from "./markup-sets-ui";

/** Changes wait this long for more before they are queued and sent. */
export const SAVE_DELAY_MS = 300;
/** A request carries ops up to about this many bytes of JSON (one op always goes). */
export const MAX_REQUEST_BYTES = 4_000_000;
/** Retry delays: 1 s, doubling, at most 30 s. */
export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
/** Queue entries read per step. */
const HEAD = 500;

// ---------------------------------------------------------------------------
// Save status (UX-DR10).
// ---------------------------------------------------------------------------

/** saved ✓ · saving … · offline (waiting) · error (not synced, Retry) · local (session expired: sign in to save). */
export type SaveState = "saved" | "saving" | "offline" | "error" | "local";
export type SaveStatus = { state: SaveState; pending: number; lastSavedAt: number | null };

export const saveStatusStore = createStore<SaveStatus>(() => ({ state: "saved", pending: 0, lastSavedAt: null }));

// ---------------------------------------------------------------------------
// The snapshot of what was queued, per document.
// ---------------------------------------------------------------------------

export type SnapshotStore = {
  get: (documentId: string) => Map<string, SavedMarkup> | null;
  set: (documentId: string, saved: ReadonlyMap<string, SavedMarkup>) => void;
};

const snapshotRecordSchema = z.object({ v: z.literal(1), saved: z.array(z.tuple([z.string().max(64), savedMarkupSchema])).max(100_000) });

/** Snapshots in sessionStorage (`pm.sync.v1.<user>.<sha256>`): they last exactly as long as the editor session they describe. */
export function sessionSnapshots(userId: string): SnapshotStore {
  const key = (documentId: string) => `pm.sync.v1.${userId}.${documentId}`;
  return {
    get(documentId) {
      try {
        const raw = window.sessionStorage.getItem(key(documentId));
        if (raw === null) return null;
        const parsed = snapshotRecordSchema.safeParse(JSON.parse(raw));
        return parsed.success ? new Map(parsed.data.saved.map(([id, s]) => [id, s as SavedMarkup])) : null;
      } catch {
        return null;
      }
    },
    set(documentId, saved) {
      try {
        const entries = [...saved].map(([id, { type, z: order, geometry, style, props }]) => [id, { type, z: order, geometry, style, props }]);
        window.sessionStorage.setItem(key(documentId), JSON.stringify({ v: 1, saved: entries }));
      } catch {
        // Storage full or blocked: the snapshot lasts the page.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The sync.
// ---------------------------------------------------------------------------

type Viewer = { documentId: string | null; fileName: string | null; pages: readonly Parameters<typeof pageGeometryOf>[0][]; calibrations: Readonly<Record<string, Calibration>> };

export type SyncDeps = {
  userId: string;
  ensure: (input: EnsureMarkupSetInput) => Promise<Result<MarkupSetIds>>;
  save: (entries: CalibrationEntry[]) => Promise<Result<null>>;
  apply: (input: ApplyMarkupOpsInput) => Promise<Result<MarkupOpResult[]>>;
  viewer: () => Viewer;
  /** A document's markups in drawing order. */
  markups: (documentId: string) => readonly Markup[] | undefined;
  /** Story 6.4: the server's set of a file (null: none). */
  load: (sha256: string) => Promise<Result<LoadedMarkupSet | null>>;
  /** Story 6.4: what a restore sets. */
  setMarkups: (documentId: string, markups: readonly Markup[]) => void;
  setCalibrations: (documentId: string, calibrations: Readonly<Record<string, Calibration>>) => void;
  layers: (documentId: string) => readonly Layer[];
  setLayers: (documentId: string, layers: readonly Layer[]) => void;
  /** Story 6.5: whether a set has a file of this name with other bytes, and what to do when so. */
  otherVersion?: (input: { sha256: string; filename: string }) => Promise<Result<boolean>>;
  onOtherVersion?: (documentId: string) => void;
  queue: OpQueueBackend | Promise<OpQueueBackend>;
  snapshots?: SnapshotStore;
  /** False when the browser says it is offline. */
  online?: () => boolean;
  onStatus?: (status: SaveStatus) => void;
  delayMs?: number;
  now?: () => number;
  newId?: () => string;
};

export type MarkupSetSync = {
  /** Hears an applied op. */
  onOp: (op: DocOp) => void;
  /** Queues what waits and sends the queue; resolves when this round is done. */
  flush: () => Promise<void>;
  /** Sends now (Ctrl+S, Retry, `online`): the backoff starts again. */
  saveNow: () => Promise<void>;
  /** Story 6.4: brings back an opened document's set (once per page; resolves when done). */
  restore: (documentId: string) => Promise<void>;
  /** The set of `documentId` once known (tests). */
  ids: (documentId: string) => Promise<MarkupSetIds | null>;
  /** The server version of a markup as last known (tests). */
  version: (markupId: string) => number | undefined;
  status: () => SaveStatus;
  dispose: () => void;
};

/** Page index of a client page key (`<sha256>:<index>`) of `documentId`; null for another document's. */
function pageIndexOf(key: string, documentId: string): number | null {
  if (!key.startsWith(`${documentId}:`)) return null;
  const index = Number(key.slice(documentId.length + 1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Why a call failed, as a save state: thrown (no network) or offline → offline; signed out → local; else error. */
function failureState(code: ResultCode | null, online: boolean): SaveState {
  if (code === null || !online) return "offline";
  return code === "UNAUTHENTICATED" ? "local" : "error";
}

export function createMarkupSetSync(deps: SyncDeps): MarkupSetSync {
  const { userId } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => uuidv7());
  const online = deps.online ?? (() => true);
  const queueReady = Promise.resolve(deps.queue);

  const sets = new Map<string, Promise<MarkupSetIds | null>>();
  const inputs = new Map<string, EnsureMarkupSetInput>();
  const snapshots = new Map<string, Map<string, SavedMarkup>>();
  const versions = new Map<string, number>();
  /** Documents whose markups changed since they were last queued. */
  const dirty = new Set<string>();
  /** Story 6.4: documents edited in this page, and documents whose restore started. */
  const touched = new Set<string>();
  const restoring = new Set<string>();
  /** Calibration changes to queue, by document then key (null: removed). */
  const calibrations = new Map<string, Map<string, Calibration | null>>();

  let status: SaveStatus = { state: "saved", pending: 0, lastSavedAt: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;
  let queueing: Promise<void> = Promise.resolve();
  let draining: Promise<void> | null = null;

  const setStatus = (next: Partial<SaveStatus>) => {
    status = { ...status, ...next };
    deps.onStatus?.(status);
  };

  const snapshotOf = (documentId: string): Map<string, SavedMarkup> => {
    let saved = snapshots.get(documentId);
    if (!saved) snapshots.set(documentId, (saved = deps.snapshots?.get(documentId) ?? new Map()));
    return saved;
  };

  /** What the set of the open document is made from, kept in the queue's store for later (offline) sends. */
  const recordInput = (documentId: string, queue: OpQueueBackend) => {
    if (inputs.has(documentId)) return;
    const viewer = deps.viewer();
    // Only the open document's pages are known here (ops run in the active tab).
    if (viewer.documentId !== documentId || viewer.pages.length === 0) return;
    const input: EnsureMarkupSetInput = { sha256: documentId, filename: setFilename(viewer.fileName), pages: viewer.pages.map(pageGeometryOf) };
    inputs.set(documentId, input);
    void queue.putDoc(userId, documentId, input).catch(() => undefined);
  };

  const inputOf = async (documentId: string, queue: OpQueueBackend): Promise<EnsureMarkupSetInput | null> => {
    const known = inputs.get(documentId);
    if (known) return known;
    const stored = await queue.getDoc(userId, documentId).catch(() => null);
    if (stored) inputs.set(documentId, stored);
    return stored;
  };

  /** The set of a document (asked once; a failure is forgotten so the next send asks again). */
  const ensure = (documentId: string, input: EnsureMarkupSetInput): Promise<{ ids: MarkupSetIds | null; code: ResultCode | null }> => {
    const known = sets.get(documentId);
    if (known) return known.then((ids) => ({ ids, code: ids ? null : "INTERNAL" }));
    let code: ResultCode | null = null;
    const pending = deps.ensure(input).then(
      (result) => {
        if (result.ok) return result.data;
        code = result.code;
        return null;
      },
      () => null,
    );
    sets.set(documentId, pending);
    return pending.then((ids) => {
      if (!ids && sets.get(documentId) === pending) sets.delete(documentId);
      return { ids, code };
    });
  };

  // -------------------------------------------------------------------------
  // 1. Queue.
  // -------------------------------------------------------------------------

  const opOf = (change: MarkupChange, clientTs: number): QueuedMarkupOp => {
    const base = { opId: newId(), clientTs };
    if (change.kind === "create") {
      const { geometry, style, props } = change.row;
      return { ...base, markupId: change.row.id, kind: "create", type: change.row.type, pageKey: change.row.pageId, fields: { geometry, style, props, z: change.z } };
    }
    if (change.kind === "delete") return { ...base, markupId: change.id, kind: "delete", type: change.type };
    return { ...base, markupId: change.id, kind: "update", type: change.type, fields: change.fields };
  };

  const enqueueNow = async (): Promise<void> => {
    const queue = await queueReady;
    const entries: QueueEntry[] = [];
    const nextSnapshots = new Map<string, Map<string, SavedMarkup>>();
    const docs = [...dirty];
    dirty.clear();
    const clientTs = now();
    for (const documentId of docs) {
      const pages = inputs.get(documentId)?.pages.length ?? (await inputOf(documentId, queue))?.pages.length ?? 0;
      // Markups on pages the set cannot know stay local.
      const current = (deps.markups(documentId) ?? []).filter((m) => {
        const index = pageIndexOf(m.pageId, documentId);
        return index !== null && index < pages;
      });
      const { changes, next } = diffMarkups(snapshotOf(documentId), current);
      nextSnapshots.set(documentId, next);
      for (const change of changes) entries.push({ userId, documentId, kind: "markup", op: opOf(change, clientTs) });
    }
    const cals = [...calibrations];
    calibrations.clear();
    for (const [documentId, changes] of cals) {
      entries.push({ userId, documentId, kind: "calibrations", entries: [...changes].map(([key, calibration]) => ({ key, calibration })) });
    }
    if (entries.length > 0) {
      try {
        await queue.add(entries);
      } catch {
        // Not queued: everything stays waiting for the next change.
        for (const d of docs) dirty.add(d);
        for (const [documentId, changes] of cals) {
          const again = calibrations.get(documentId) ?? new Map<string, Calibration | null>();
          for (const [key, value] of changes) if (!again.has(key)) again.set(key, value);
          calibrations.set(documentId, again);
        }
        return;
      }
    }
    // Queued: the snapshots move on (durably beside the editor session).
    for (const [documentId, next] of nextSnapshots) {
      snapshots.set(documentId, next);
      deps.snapshots?.set(documentId, next);
    }
    if (entries.length > 0) setStatus({ state: online() ? "saving" : "offline", pending: await queue.count(userId).catch(() => status.pending) });
  };

  const enqueue = (): Promise<void> => (queueing = queueing.then(enqueueNow, enqueueNow));

  // -------------------------------------------------------------------------
  // 2. Send.
  // -------------------------------------------------------------------------

  /** The next request: one calibrations entry, or consecutive markup ops of one document (each markup once, about MAX_REQUEST_BYTES). */
  const batchOf = (head: readonly QueueEntry[]): QueueEntry[] => {
    const first = head[0];
    if (first.kind === "calibrations") return [first];
    const batch: QueueEntry[] = [];
    const markups = new Set<string>();
    let bytes = 0;
    for (const e of head) {
      if (e.kind !== "markup" || e.documentId !== first.documentId || markups.has(e.op.markupId)) break;
      const size = JSON.stringify(e.op).length;
      if (batch.length > 0 && (bytes + size > MAX_REQUEST_BYTES || batch.length >= MAX_OPS)) break;
      batch.push(e);
      markups.add(e.op.markupId);
      bytes += size;
    }
    return batch;
  };

  /** Sends one request; null when sent, else the failure code (null code: no network). */
  const send = async (queue: OpQueueBackend, batch: QueueEntry[]): Promise<{ failed: false } | { failed: true; code: ResultCode | null }> => {
    const documentId = batch[0].documentId;
    const input = await inputOf(documentId, queue);
    if (!input) {
      // What the set is made from was never recorded: it can never be sent.
      await queue.remove(batch.map((e) => e.seq!));
      return { failed: false };
    }
    const { ids, code } = await ensure(documentId, input);
    if (!ids) return { failed: true, code };
    const pageIdOf = (key: string) => {
      const index = pageIndexOf(key, documentId);
      return index === null ? undefined : ids.pageIds[index];
    };

    const first = batch[0];
    if (first.kind === "calibrations") {
      const entries = first.entries.flatMap((e) => {
        const pageId = pageIdOf(e.key);
        return pageId ? [{ pageId, calibration: e.calibration }] : [];
      });
      if (entries.length > 0) {
        const result = await deps.save(entries).catch(() => null);
        if (!result?.ok) return { failed: true, code: result ? result.code : null };
      }
      await queue.remove([first.seq!]);
      return { failed: false };
    }

    const markupEntries = batch.filter((e): e is Extract<QueueEntry, { kind: "markup" }> => e.kind === "markup");
    const unknown = markupEntries.map((e) => e.op.markupId).filter((id) => !versions.has(id));
    if (unknown.length > 0) for (const [id, v] of await queue.getVersions(userId, unknown).catch(() => new Map<string, number>())) versions.set(id, v);
    const ops: MarkupOp[] = [];
    for (const e of markupEntries) {
      const { pageKey, ...op } = e.op;
      const pageId = pageKey === undefined ? undefined : pageIdOf(pageKey);
      // A page the set does not have: never sendable (it leaves with the batch).
      if (op.kind === "create" && !pageId) continue;
      ops.push({ ...op, ...(pageId && op.kind === "create" ? { pageId } : {}), baseVersion: versions.get(op.markupId) ?? 0 });
    }
    if (ops.length > 0) {
      const result = await deps.apply({ drawingId: ids.drawingId, ops }).catch(() => null);
      if (!result?.ok) return { failed: true, code: result ? result.code : null };
      const confirmed = new Map<string, number>();
      for (const r of result.data) {
        versions.set(r.markupId, r.version);
        confirmed.set(r.markupId, r.version);
        const op = ops.find((o) => o.opId === r.opId);
        if (r.status === "missing" && op?.kind === "update") {
          // Unknown to the server (its create never reached it): made again with the next diff.
          snapshotOf(documentId).delete(r.markupId);
          deps.snapshots?.set(documentId, snapshotOf(documentId));
          dirty.add(documentId);
        }
      }
      await queue.putVersions(userId, confirmed).catch(() => undefined);
    }
    await queue.remove(markupEntries.map((e) => e.seq!));
    return { failed: false };
  };

  const scheduleRetry = () => {
    if (retryTimer !== null || disposed) return;
    const delay = Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
    attempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain();
    }, delay);
  };

  const drainNow = async (): Promise<void> => {
    const queue = await queueReady;
    let sent = false;
    for (;;) {
      if (disposed) return;
      const head = await queue.head(userId, HEAD).catch(() => [] as QueueEntry[]);
      if (head.length === 0) break;
      setStatus({ state: "saving", pending: Math.max(status.pending, head.length) });
      const outcome = await send(queue, batchOf(head)).catch(() => ({ failed: true as const, code: "INTERNAL" as ResultCode }));
      if (outcome.failed) {
        setStatus({ state: failureState(outcome.code, online()), pending: await queue.count(userId).catch(() => status.pending) });
        scheduleRetry();
        return;
      }
      sent = true;
      attempt = 0;
    }
    setStatus({ state: "saved", pending: 0, ...(sent ? { lastSavedAt: now() } : {}) });
    // Everything is on the server: the open document's set is cached as it is now (Story 6.4).
    const open = deps.viewer().documentId;
    if (sent && open && touched.has(open) && snapshots.has(open)) await queue.putSet(userId, open, cacheOf(open)).catch(() => undefined);
    if (dirty.size > 0) schedule();
  };

  const drain = (): Promise<void> => {
    if (draining) return draining;
    draining = drainNow().finally(() => {
      draining = null;
    });
    return draining;
  };

  // -------------------------------------------------------------------------
  // 4. Restore (Story 6.4).
  // -------------------------------------------------------------------------

  const calibrationsOf = (documentId: string): Record<string, Calibration> =>
    Object.fromEntries(Object.entries(deps.viewer().calibrations).filter(([key]) => key.startsWith(`${documentId}:`)));

  /** The document's set as queued (= on the server once the queue is empty). */
  const cacheOf = (documentId: string): CachedSet => {
    const saved = snapshotOf(documentId);
    const markups = (deps.markups(documentId) ?? []).filter((m) => saved.has(m.id));
    return { markups, z: markups.map((m) => saved.get(m.id)!.z), calibrations: calibrationsOf(documentId), layers: [...deps.layers(documentId)] };
  };

  /** Shows a set and makes it what was saved: the next diff sends only new changes. */
  const show = (documentId: string, markups: readonly Markup[], z: readonly number[], cals: Record<string, Calibration>) => {
    const saved = new Map<string, SavedMarkup>(markups.map((m, i) => [m.id, savedMarkup(m, z[i])]));
    snapshots.set(documentId, saved);
    deps.snapshots?.set(documentId, saved);
    deps.setMarkups(documentId, markups);
    if (deps.viewer().documentId === documentId) deps.setCalibrations(documentId, cals);
  };

  const pendingFor = async (queue: OpQueueBackend, documentId: string) =>
    (await queue.head(userId, HEAD).catch(() => [] as QueueEntry[])).some((e) => e.documentId === documentId);

  const restoreNow = async (documentId: string): Promise<void> => {
    const queue = await queueReady;
    // This browser tab's session already holds the document (a reload): it is the truth here.
    if (snapshots.has(documentId) || deps.snapshots?.get(documentId) || (deps.markups(documentId)?.length ?? 0) > 0) return;
    const fresh = () => !touched.has(documentId) && !disposed;

    // 1. As last in step with the server, from this computer.
    const cached = await queue.getSet(userId, documentId).catch(() => null);
    if (cached && fresh() && (deps.markups(documentId)?.length ?? 0) === 0) {
      show(documentId, cached.markups, cached.z, cached.calibrations);
      if (deps.layers(documentId).length === 0 && cached.layers.length > 0) deps.setLayers(documentId, cached.layers);
    }

    // 2. The server's: what waits in the queue goes first (a tab closed while offline).
    if (await pendingFor(queue, documentId)) await flush();
    if (await pendingFor(queue, documentId)) return;
    const result = await deps.load(documentId).catch(() => null);
    if (result?.ok && result.data === null) {
      // Story 6.5 (FR81): no set for these bytes; one for this filename tells the user (nothing is moved).
      const viewer = deps.viewer();
      if (deps.otherVersion && viewer.documentId === documentId && viewer.fileName) {
        const other = await deps.otherVersion({ sha256: documentId, filename: setFilename(viewer.fileName) }).catch(() => null);
        if (other?.ok && other.data) deps.onOtherVersion?.(documentId);
      }
      return;
    }
    if (!result?.ok || result.data === null || !fresh()) return;
    const set = result.data;
    sets.set(documentId, Promise.resolve(set.ids));
    const known = new Map(set.markups.map((e) => [e.markup.id, e.version]));
    for (const [id, v] of known) versions.set(id, v);
    await queue.putVersions(userId, known).catch(() => undefined);
    if (!fresh() || (await pendingFor(queue, documentId))) return;
    show(documentId, set.markups.map((e) => e.markup), set.markups.map((e) => e.z), set.calibrations);
    await queue.putSet(userId, documentId, { ...cacheOf(documentId), calibrations: set.calibrations }).catch(() => undefined);
    if (status.pending === 0) setStatus({ state: "saved" });
  };

  const restore = (documentId: string): Promise<void> => {
    if (restoring.has(documentId)) return Promise.resolve();
    restoring.add(documentId);
    return restoreNow(documentId).catch(() => undefined);
  };

  const flush = async () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    await enqueue();
    // A round already sending finishes first; then what was just queued goes.
    if (draining) await draining;
    await drain();
  };

  const schedule = () => {
    if (timer === null && !disposed) timer = setTimeout(() => void flush(), deps.delayMs ?? SAVE_DELAY_MS);
  };

  const onOp = (op: DocOp) => {
    touched.add(op.documentId);
    void queueReady.then((queue) => recordInput(op.documentId, queue));
    const viewer = deps.viewer();
    for (const part of opParts(op)) {
      if (part.kind.startsWith("markups.")) dirty.add(part.documentId);
      if (part.kind === "calibrations.set" && viewer.documentId === part.documentId) {
        const changes = calibrations.get(part.documentId) ?? new Map<string, Calibration | null>();
        for (const key of new Set([...Object.keys(part.before), ...Object.keys(part.after)])) changes.set(key, viewer.calibrations[key] ?? null);
        calibrations.set(part.documentId, changes);
      }
    }
    // Story 6.1: the first edit of a document asks for its set (made when the hash is new).
    void queueReady.then(async (queue) => {
      const input = await inputOf(op.documentId, queue);
      if (input) await ensure(op.documentId, input);
    });
    schedule();
  };

  const saveNow = async () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    attempt = 0;
    await flush();
  };

  // What an earlier page left in the queue goes now.
  void drain();

  return {
    onOp,
    flush,
    saveNow,
    restore,
    ids: (documentId) => sets.get(documentId) ?? Promise.resolve(null),
    version: (markupId) => versions.get(markupId),
    status: () => status,
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      timer = null;
      retryTimer = null;
    },
  };
}

/** Ctrl+S (⌘S): save now instead of the browser's save dialog. */
export function isSaveShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
}

let activeSync: MarkupSetSync | null = null;

/** Sends now (the SaveIndicator's Retry). */
export function saveNow(): void {
  void activeSync?.saveNow();
}

/** Keeps the signed-in user's markup sets in step with their edits (mounted once in the workspace). */
export function useMarkupSetSync(userId: string): void {
  useEffect(() => {
    saveStatusStore.setState({ state: "saved", pending: 0, lastSavedAt: null });
    const sync = createMarkupSetSync({
      userId,
      ensure: ensureMarkupSet,
      save: saveSetCalibrations,
      apply: applyMarkupOps,
      viewer: () => viewerStore.getState(),
      markups: (documentId) => editorStore.getState().doc.markups[documentId],
      load: loadMarkupSet,
      setMarkups: setDocMarkups,
      setCalibrations: (documentId, calibrations) =>
        viewerStore.setState((s) => ({
          calibrations: { ...Object.fromEntries(Object.entries(s.calibrations).filter(([key]) => !key.startsWith(`${documentId}:`))), ...calibrations },
        })),
      layers: (documentId) => layersOf(editorStore.getState(), documentId),
      setLayers: setDocLayers,
      otherVersion: hasMarkupsOnOtherVersion,
      onOtherVersion: markOtherVersion,
      queue: openOpQueue(),
      snapshots: sessionSnapshots(userId),
      online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      onStatus: (s) => saveStatusStore.setState(s),
    });
    activeSync = sync;
    const unsubscribe = subscribeAppliedOps(sync.onOp);
    // Story 6.4: an opened document's set comes back after its first frame (never before: rendering is not held up).
    const onViewer = (s: { status: string; documentId: string | null }) => {
      if (s.status === "ready" && s.documentId) {
        const documentId = s.documentId;
        setTimeout(() => void sync.restore(documentId), 0);
      }
    };
    onViewer(viewerStore.getState());
    const unsubscribeViewer = viewerStore.subscribe(onViewer);
    const onOnline = () => void sync.saveNow();
    const onOffline = () => {
      if (sync.status().pending > 0) saveStatusStore.setState({ state: "offline" });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      void sync.saveNow();
    };
    // Leaving the page: what waits is queued (best effort; the session keeps the edits).
    const onHide = () => void sync.flush();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      unsubscribe();
      unsubscribeViewer();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pagehide", onHide);
      void sync.flush().finally(() => sync.dispose());
      if (activeSync === sync) activeSync = null;
    };
  }, [userId]);
}
