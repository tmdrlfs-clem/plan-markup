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

export function sessionKey(userId: string, documentId: string): string {
  return `pm.editor.v1.${userId}.${documentId}`;
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** A stored record, or null when missing or unusable (never trusted unparsed). */
export function parseSessionRecord(raw: string | null): SessionRecord | null {
  if (raw === null) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function read(key: string): SessionRecord | null {
  try {
    return parseSessionRecord(storage()?.getItem(key) ?? null);
  } catch {
    return null;
  }
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
  const record = read(sessionKey(owner!, open.documentId));
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
  const open = new Set(tabs.tabs.map((t) => t.id));
  for (const [tabId, documentId] of [...tabDocs]) {
    if (open.has(tabId)) continue;
    tabDocs.delete(tabId);
    // A tab closed because its document is already open in another tab (Story 3.5) keeps that tab's history.
    const elsewhere = viewerStore.getState().documentId === documentId || [...tabDocs].some(([id, doc]) => doc === documentId && open.has(id));
    if (elsewhere) continue;
    const key = sessionKey(owner, documentId);
    const record = read(key);
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
