// The editing session per browser tab (Story 4.5 AC 6, UX-DR36): the undo
// history survives a reload until the browser tab closes. It is serialised to
// sessionStorage as ops, per user and document (sha256), together with the
// document state the ops act on (its markups and calibrations): opening the
// same PDF again in this browser tab restores all three. Closing a document
// tab drops its history (Story 4.3) but keeps its markups and calibrations for
// the session. Epic 6 replaces this with saving to the markup set.

import { useLayoutEffect } from "react";
import { z } from "zod";

import { calibrationSchema, type Calibration } from "@/core/calibration/calibration";
import { docOpSchema } from "@/core/commands/ops";
import { markupSchema } from "@/core/schema/markup";
import { EMPTY_HISTORY, UNDO_LIMIT, type UndoHistory } from "@/core/undo/stack";
import { tabsStore, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor, setDocMarkups } from "./editor-store";
import { commandOf, setTabHistory } from "./undo-store";

const entrySchema = z.object({ label: z.string().max(200), op: docOpSchema });
const recordSchema = z.object({
  v: z.literal(1),
  markups: z.array(markupSchema).max(10_000),
  calibrations: z.record(z.string().min(1).max(200), calibrationSchema),
  past: z.array(entrySchema).max(UNDO_LIMIT),
  future: z.array(entrySchema).max(UNDO_LIMIT),
});
export type SessionRecord = z.infer<typeof recordSchema>;

const KEY_PREFIX = "pm.editor.v1.";

export function sessionKey(userId: string, documentId: string): string {
  return `${KEY_PREFIX}${userId}.${documentId}`;
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Review R2: everything in a record belongs to its document: the markups' and
 * calibrations' page ids, and every op (an op for another document would
 * change that document's markups on undo).
 */
export function recordBelongsTo(record: SessionRecord, documentId: string): boolean {
  const page = `${documentId}:`;
  const ownPage = (id: string) => id.startsWith(page);
  const ownOp = (op: SessionRecord["past"][number]["op"]) =>
    op.documentId === documentId &&
    (op.kind === "calibrations.set"
      ? [...Object.keys(op.before), ...Object.keys(op.after)].every(ownPage)
      : // Story 5.3: a reorder names only ids of the document's own list.
        op.kind === "markups.reorder" ||
        (op.kind === "markups.update" ? [...op.before, ...op.after] : op.markups).every((m) => ownPage(m.pageId)));
  return (
    record.markups.every((m) => ownPage(m.pageId)) &&
    Object.keys(record.calibrations).every(ownPage) &&
    [...record.past, ...record.future].every((e) => ownOp(e.op))
  );
}

/** A stored record, or null when missing or unusable (never trusted unparsed; with `documentId`, only one wholly of that document). */
export function parseSessionRecord(raw: string | null, documentId?: string): SessionRecord | null {
  if (raw === null) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return documentId === undefined || recordBelongsTo(parsed.data, documentId) ? parsed.data : null;
  } catch {
    return null;
  }
}

function read(key: string, documentId: string): SessionRecord | null {
  try {
    return parseSessionRecord(storage()?.getItem(key) ?? null, documentId);
  } catch {
    return null;
  }
}

/** Review R3: this browser tab's records of other users go (a shared computer: the next user never inherits them). */
export function dropOtherUsersRecords(userId: string): void {
  try {
    const store = storage();
    if (!store) return;
    const own = `${KEY_PREFIX}${userId}.`;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(KEY_PREFIX) && !key.startsWith(own)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Blocked storage: nothing was kept either.
  }
}

/**
 * Review R4: which closed document tabs' histories leave the session. A tab
 * closed because its document is already open in another tab (Story 3.5: the
 * existing tab is shown instead) keeps that document's history.
 */
export function closedTabs(
  tabDocs: ReadonlyMap<string, string>,
  openTabIds: ReadonlySet<string>,
  activeDocumentId: string | null,
): { closed: string[]; dropHistoryOf: string[] } {
  const closed = [...tabDocs.keys()].filter((id) => !openTabIds.has(id));
  const stillOpen = new Set([...tabDocs].filter(([id]) => openTabIds.has(id)).map(([, doc]) => doc));
  if (activeDocumentId) stillOpen.add(activeDocumentId);
  const dropHistoryOf = [...new Set(closed.map((id) => tabDocs.get(id)!))].filter((doc) => !stillOpen.has(doc));
  return { closed, dropHistoryOf };
}

function write(key: string, record: SessionRecord): void {
  try {
    storage()?.setItem(key, JSON.stringify(record));
  } catch {
    // Storage full or blocked: the session is simply not kept over a reload.
  }
}

const entries = (commands: UndoHistory["past"]) =>
  commands.flatMap((c) => (c.op ? [{ label: c.label, op: c.op }] : []));

/** The signed-in user the session belongs to (null: not mounted). */
let owner: string | null = null;
let lastOwner: string | null = null;
/** Opens restored (tab : openSeq : sha256), so each open restores once and writes only after. */
const restored = new Set<string>();
/** The document each tab showed, for dropping its history when the tab closes. */
const tabDocs = new Map<string, string>();
/** What was last written per document, by reference (no rewrite per viewer update). */
const written = new Map<string, readonly unknown[]>();

function currentOpen(): { key: string; tabId: string; documentId: string } | null {
  const v = viewerStore.getState();
  if (!owner || !v.tabId || !v.documentId) return null;
  return { key: `${v.tabId}:${v.openSeq}:${v.documentId}`, tabId: v.tabId, documentId: v.documentId };
}

const ownCalibrations = (all: Readonly<Record<string, Calibration>>, documentId: string) =>
  Object.fromEntries(Object.entries(all).filter(([id]) => id.startsWith(`${documentId}:`)));

/** Restores the active document's session once per open (markups, calibrations, then its history). */
function restoreActive(): void {
  const open = currentOpen();
  if (!open || restored.has(open.key)) return;
  restored.add(open.key);
  tabDocs.set(open.tabId, open.documentId);
  const record = read(sessionKey(owner!, open.documentId), open.documentId);
  if (!record) return;
  if (markupsOf(editorStore.getState(), open.documentId).length === 0 && record.markups.length > 0) setDocMarkups(open.documentId, record.markups);
  const calibrations = ownCalibrations(record.calibrations, open.documentId);
  if (Object.keys(viewerStore.getState().calibrations).length === 0 && Object.keys(calibrations).length > 0) viewerStore.setState({ calibrations });
  const history = editorStore.getState().history.histories[open.tabId] ?? EMPTY_HISTORY;
  if (history.past.length === 0 && history.future.length === 0 && (record.past.length > 0 || record.future.length > 0)) {
    setTabHistory(open.tabId, {
      past: record.past.map((e) => commandOf(e.op, e.label)),
      future: record.future.map((e) => commandOf(e.op, e.label)),
    });
  }
}

/** Writes the active document's session when its markups, calibrations or history changed. */
function writeActive(): void {
  const open = currentOpen();
  if (!open || !restored.has(open.key)) return;
  const editor = editorStore.getState();
  const markups = markupsOf(editor, open.documentId);
  const calibrations = viewerStore.getState().calibrations;
  const history = editor.history.histories[open.tabId] ?? EMPTY_HISTORY;
  const refs = [markups, calibrations, history];
  const last = written.get(open.documentId);
  if (last && last.every((r, i) => r === refs[i])) return;
  written.set(open.documentId, refs);
  write(sessionKey(owner!, open.documentId), {
    v: 1,
    markups: [...markups],
    calibrations: ownCalibrations(calibrations, open.documentId),
    past: entries(history.past),
    future: entries(history.future),
  });
}

function sync(): void {
  restoreActive();
  writeActive();
}

// A closed document tab keeps its markups and calibrations for the session, not its history.
tabsStore.subscribe((tabs) => {
  if (!owner) return;
  const { closed, dropHistoryOf } = closedTabs(tabDocs, new Set(tabs.tabs.map((t) => t.id)), viewerStore.getState().documentId);
  for (const tabId of closed) {
    tabDocs.delete(tabId);
    // Its opens are done with (the set never grows past the open tabs).
    for (const key of [...restored]) if (key.startsWith(`${tabId}:`)) restored.delete(key);
  }
  for (const documentId of dropHistoryOf) {
    const key = sessionKey(owner, documentId);
    const record = read(key, documentId);
    if (record) write(key, { ...record, past: [], future: [] });
    written.delete(documentId);
  }
});

/** Keeps the session of the signed-in user's documents (the workspace shell). Another user starts empty. */
export function useEditorSession(userId: string): void {
  useLayoutEffect(() => {
    if (lastOwner !== null && lastOwner !== userId) {
      resetEditor();
      restored.clear();
      tabDocs.clear();
      written.clear();
    }
    owner = userId;
    lastOwner = userId;
    dropOtherUsersRecords(userId);
    sync();
    const offViewer = viewerStore.subscribe(sync);
    const offEditor = editorStore.subscribe(writeActive);
    return () => {
      offViewer();
      offEditor();
      owner = null;
    };
  }, [userId]);
}

/** Tests: forgets what was restored and written. */
export function resetSessionTracking(): void {
  restored.clear();
  tabDocs.clear();
  written.clear();
  lastOwner = null;
}
