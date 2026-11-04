// The editor store (Story 4.5, AR13): one zustand vanilla store outside React
// with the slices the architecture names. Components select from it; document
// data changes only through commands built from ops (commands.ts).
//
//   doc        markups by document (sha256), shared by the tabs (a document is open in one tab);
//              Story 5.12: its layers, and the active layer new markups go to
//   view       the active document tab, mirrored from the viewer
//   tools      the drawing in progress (Length, Story 4.5; more tools with Epic 5), a caption being moved (4.6)
//              and markups being moved (a drag or an arrow key held, 5.1), resized, rotated or copied (5.2),
//              the markups' context menu (5.3), the text being typed (5.6)
//   selection  selected markup ids (the Measurements panel, Story 4.11; Epic 5)
//   history    undo histories by document tab (the Story 4.3 undo stack)

import { createStore } from "zustand/vanilla";

import { layerLocked, layerShown, type Layer } from "@/core/schema/layer";
import type { Markup, TextMarkup } from "@/core/schema/markup";
import type { UndoHistory } from "@/core/undo/stack";
import { viewerStore, type DrawTool, type LayerView } from "@/features/viewer";

type Point = { x: number; y: number };

/**
 * A measurement being drawn (Length 4.5, Polylength 4.6, Area and Count 4.8; 5.4: a line, arrow,
 * polyline or polygon): its tool, its page and the points placed so far (user space).
 */
export type Drawing = {
  tool: DrawTool;
  pageId: string;
  pageIndex: number;
  points: readonly Point[];
  /** Story 5.6: a Cloud+'s closed cloud (its points then wait for the text's click). */
  ring?: readonly Point[];
  /** Story 5.7: a stroke's point from which Shift holds it straight (what follows is replaced). */
  anchor?: number;
  /** Story 5.9: an Underline or Strikethrough drag's selected glyph boxes (four points a quad) and text. */
  quads?: readonly Point[];
  selected?: string;
};

/** Story 5.6: a text markup placed and being typed: its draft (no text yet), its document and the tab that records it. */
export type TextEdit = { draft: TextMarkup; documentId: string; tabId: string | null };

/** Story 4.6: a caption being moved: its markup and the offset change so far (user space). */
export type CaptionDrag = { id: string; documentId: string; delta: Point };

/** Story 5.1: markups being moved (a drag or a held arrow key): their ids and the move so far (user space). */
export type MoveDrag = { ids: readonly string[]; documentId: string; delta: Point };

/** Story 5.2: a resize, rotation, vertex drag or copy in progress: markups changed (by id) and added, as they would be. */
export type Preview = { documentId: string; changed: Readonly<Record<string, Markup>>; added: readonly Markup[] };

/** Story 5.3: the markups' context menu, open: its page as shown, the right-click (user space) and where it opens (client px). */
export type MarkupMenu = { documentId: string; pageIndex: number; view: LayerView; point: Point; client: Point };

export type EditorState = {
  doc: {
    markups: Readonly<Record<string, readonly Markup[]>>;
    layers: Readonly<Record<string, readonly Layer[]>>;
    /** Story 5.12: the layer new markups go to, by document (absent or null: none). */
    activeLayer: Readonly<Record<string, string | null>>;
  };
  view: { tabId: string | null; documentId: string | null };
  tools: { drawing: Drawing | null; captionDrag: CaptionDrag | null; moveDrag: MoveDrag | null; preview: Preview | null; menu: MarkupMenu | null; textEdit: TextEdit | null };
  selection: { ids: readonly string[] };
  /** Histories by tab id ("" outside tabs). */
  history: { histories: Readonly<Record<string, UndoHistory>> };
};

export const EMPTY_EDITOR: EditorState = {
  doc: { markups: {}, layers: {}, activeLayer: {} },
  view: { tabId: null, documentId: null },
  tools: { drawing: null, captionDrag: null, moveDrag: null, preview: null, menu: null, textEdit: null },
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
  // Story 5.12: a hidden layer's markups are not shown (nor picked, nor walls for a fill).
  const layers = layersOf(state, documentId);
  return markupsOf(state, documentId).filter((m) => m.pageId === pageId && layerShown(layers, m.layerId));
}

/** Sets a document's markups (commands.ts and the session restore only). */
export function setDocMarkups(documentId: string, markups: readonly Markup[]): void {
  editorStore.setState((s) => ({ doc: { ...s.doc, markups: { ...s.doc.markups, [documentId]: markups } } }));
}

const NO_LAYERS: readonly Layer[] = [];

/** Story 5.12: a document's layers, top first (empty when it has none). */
export function layersOf(state: EditorState, documentId: string | null): readonly Layer[] {
  return (documentId && state.doc.layers[documentId]) || NO_LAYERS;
}

/** Story 5.12: the document's active layer, if it still has it. */
export function activeLayerOf(state: EditorState, documentId: string | null): Layer | null {
  const id = documentId ? state.doc.activeLayer[documentId] : null;
  return (id && layersOf(state, documentId).find((l) => l.id === id)) || null;
}

/** Story 5.12: sets a document's layers (commands.ts and the session restore only); the active layer goes with a layer removed, hidden or locked. */
export function setDocLayers(documentId: string, layers: readonly Layer[]): void {
  editorStore.setState((s) => {
    const active = s.doc.activeLayer[documentId] ?? null;
    const still = active !== null && layers.some((l) => l.id === active && !l.hidden && !l.locked);
    // A hidden layer's markups leave the selection (they can no longer be seen or picked).
    const byId = new Map((s.doc.markups[documentId] ?? []).map((m) => [m.id, m]));
    const ids = s.selection.ids.filter((id) => {
      const m = byId.get(id);
      return !m || layerShown(layers, m.layerId);
    });
    return {
      doc: { ...s.doc, layers: { ...s.doc.layers, [documentId]: layers }, activeLayer: { ...s.doc.activeLayer, [documentId]: still ? active : null } },
      ...(ids.length !== s.selection.ids.length ? { selection: { ids } } : {}),
    };
  });
}

/** Story 5.12: the layer new markups go to (null: none); a hidden or locked layer cannot be active (D2). */
export function setActiveLayer(documentId: string, layerId: string | null): void {
  const layer = layerId === null ? null : layersOf(editorStore.getState(), documentId).find((l) => l.id === layerId);
  const next = layer && !layer.hidden && !layer.locked ? layer.id : null;
  if ((editorStore.getState().doc.activeLayer[documentId] ?? null) === next) return;
  editorStore.setState((s) => ({ doc: { ...s.doc, activeLayer: { ...s.doc.activeLayer, [documentId]: next } } }));
}

/** The document a page id belongs to (`sha256:index`). */
function documentOf(pageId: string): string {
  return pageId.slice(0, pageId.lastIndexOf(":"));
}

/** Story 5.12: whether `m` is shown (its layer is not hidden). */
export function isShown(m: Markup, state: EditorState = editorStore.getState()): boolean {
  return layerShown(layersOf(state, documentOf(m.pageId)), m.layerId);
}

/** Story 5.3: whether `m` is locked: by itself, or (Story 5.12) by its layer. */
export function isLocked(m: Markup, state: EditorState = editorStore.getState()): boolean {
  return !!m.locked || layerLocked(layersOf(state, documentOf(m.pageId)), m.layerId);
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

/** Story 5.1: markups being moved (the select tool only). */
export function setMoveDrag(moveDrag: MoveDrag | null): void {
  if (editorStore.getState().tools.moveDrag === moveDrag) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, moveDrag } }));
}

/** Story 5.2: the edit in progress shown in place (the select tool only). */
export function setPreview(preview: Preview | null): void {
  if (editorStore.getState().tools.preview === preview) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, preview } }));
}

/** Story 5.3: opens (or with null closes) the markups' context menu. */
export function setMarkupMenu(menu: MarkupMenu | null): void {
  if (editorStore.getState().tools.menu === menu) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, menu } }));
}

/** Story 5.6: the text being typed (the text tool only). */
export function setTextEdit(textEdit: TextEdit | null): void {
  if (editorStore.getState().tools.textEdit === textEdit) return;
  editorStore.setState((s) => ({ tools: { ...s.tools, textEdit } }));
}

/** Story 4.11: selects markups by id (none: clears); false when nothing changed. */
export function setSelection(ids: readonly string[]): boolean {
  const current = editorStore.getState().selection.ids;
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return false;
  editorStore.setState({ selection: { ids } });
  return true;
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
