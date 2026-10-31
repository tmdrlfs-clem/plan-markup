// The editor store (Story 4.5, AR13): one zustand vanilla store outside React
// with the slices the architecture names. Components select from it; document
// data changes only through commands built from ops (commands.ts).
//
//   doc        markups by document (sha256), shared by the tabs (a document is open in one tab)
//   view       the active document tab, mirrored from the viewer
//   tools      the drawing in progress (Length, Story 4.5; more tools with Epic 5) and a caption being moved (4.6)
//   selection  selected markup ids (Epic 5)
//   history    undo histories by document tab (the Story 4.3 undo stack)

import { createStore } from "zustand/vanilla";

import type { Markup } from "@/core/schema/markup";
import type { UndoHistory } from "@/core/undo/stack";
import { viewerStore, type MeasureTool } from "@/features/viewer";

type Point = { x: number; y: number };

/** A measurement being drawn (Length 4.5, Polylength 4.6, Area and Count 4.8): its tool, its page and the points placed so far (user space). */
export type Drawing = { tool: MeasureTool; pageId: string; pageIndex: number; points: readonly Point[] };

/** Story 4.6: a caption being moved: its markup and the offset change so far (user space). */
export type CaptionDrag = { id: string; documentId: string; delta: Point };

export type EditorState = {
  doc: { markups: Readonly<Record<string, readonly Markup[]>> };
  view: { tabId: string | null; documentId: string | null };
  tools: { drawing: Drawing | null; captionDrag: CaptionDrag | null };
  selection: { ids: readonly string[] };
  /** Histories by tab id ("" outside tabs). */
  history: { histories: Readonly<Record<string, UndoHistory>> };
};

export const EMPTY_EDITOR: EditorState = {
  doc: { markups: {} },
  view: { tabId: null, documentId: null },
  tools: { drawing: null, captionDrag: null },
  selection: { ids: [] },
  history: { histories: {} },
};

export const editorStore = createStore<EditorState>(() => EMPTY_EDITOR);

const NO_MARKUPS: readonly Markup[] = [];

/** A document's markups (empty when it has none). */
export function markupsOf(state: EditorState, documentId: string | null): readonly Markup[] {
  return (documentId && state.doc.markups[documentId]) || NO_MARKUPS;
}

/** The markups of one page (by stable page id), in drawing order. */
export function pageMarkups(state: EditorState, documentId: string | null, pageId: string): Markup[] {
  return markupsOf(state, documentId).filter((m) => m.pageId === pageId);
}

/** Sets a document's markups (commands.ts and the session restore only). */
export function setDocMarkups(documentId: string, markups: readonly Markup[]): void {
  editorStore.setState((s) => ({ doc: { markups: { ...s.doc.markups, [documentId]: markups } } }));
}

/** The drawing in progress (the tools only). */
export function setDrawing(drawing: Drawing | null): void {
  if (editorStore.getState().tools.drawing === drawing) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, drawing } }));
}

/** The caption being moved (the tools only). */
export function setCaptionDrag(captionDrag: CaptionDrag | null): void {
  if (editorStore.getState().tools.captionDrag === captionDrag) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, captionDrag } }));
}

/** Forgets everything (another user's workspace, tests). */
export function resetEditor(): void {
  editorStore.setState({ ...EMPTY_EDITOR, view: editorStore.getState().view }, true);
}

// The view slice follows the viewer's active tab.
function syncView(): void {
  const { tabId, documentId } = viewerStore.getState();
  const view = editorStore.getState().view;
  if (view.tabId !== tabId || view.documentId !== documentId) editorStore.setState({ view: { tabId, documentId } });
}
viewerStore.subscribe(syncView);
syncView();
