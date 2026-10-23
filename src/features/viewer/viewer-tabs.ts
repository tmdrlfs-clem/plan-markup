// Open drawings as document tabs (Story 3.5).
//
// Each tab owns a ViewerEngine with its own render worker (one pdf.js document
// per worker; closing the tab terminates it, which frees everything the worker
// held). The canvases are shared: the CanvasViewport attaches them once as the
// host, and only the active tab's engine draws into them. A background engine
// is suspended (no drawing, no tile work) with a small tile budget; its
// document, preview, page views and remaining tiles stay, so switching back
// draws at once without re-parsing.
//
// `viewerStore` stays the state of the active tab (every component reads it as
// before). Each tab keeps a snapshot of that state: an engine's updates go to
// the store while its tab is active and to the snapshot otherwise; switching
// tabs puts the new tab's snapshot in the store.

import { createStore } from "zustand/vanilla";

import { toast } from "@/components/ui/toast-store";
import { MAX_TABS, activeAfterClose, cycleTab, fileKeyOf, findDuplicate, tileBudgets } from "@/core/documents/tabs";
import { sheetLabelOf } from "@/core/pdf/sheet-label";
import { RenderClient } from "@/workers/rpc";

import { registerViewerEngine } from "./viewer-commands";
import { ViewerEngine, type ViewerCanvases } from "./viewer-engine";
import { INITIAL_VIEWER_STATE, viewerStore, type ViewerState, type ViewerStatus } from "./viewer-store";

/** What the tab strip shows of a tab. */
export type DocumentTab = {
  id: string;
  fileName: string;
  /** The shown page's sheet number, else the file name (UX: sheet labels in tabs). */
  title: string;
  status: ViewerStatus;
  /** The document failed to open or render (the error shows in that tab only). */
  failed: boolean;
};

export type TabsState = { tabs: DocumentTab[]; activeId: string | null };

/** The tab strip's state. */
export const tabsStore = createStore<TabsState>(() => ({ tabs: [], activeId: null }));

/** The CanvasViewport: the shared canvases and how to switch the input and sizing to another engine. */
export type ViewerHost = {
  canvases: ViewerCanvases;
  createWorker: () => Worker;
  /** The active tab's engine changed (null: none). Attach input and size the canvases (setViewport). */
  activate: (engine: ViewerEngine | null) => void;
};

type Entry = {
  id: string;
  file: File;
  fileKey: string;
  sha256: string | null;
  snapshot: ViewerState;
  engine: ViewerEngine | null;
};

/** The tab title: the shown page's sheet number, else the file name. */
export function tabTitle(s: Pick<ViewerState, "pageIndex" | "pageLabels" | "sheetLabels" | "fileName">): string {
  const label = sheetLabelOf(s.pageIndex + 1, s.pageLabels?.[s.pageIndex], s.sheetLabels[s.pageIndex]);
  return label?.short ?? s.fileName ?? "";
}

const sameTab = (a: DocumentTab, b: DocumentTab) =>
  a.id === b.id && a.fileName === b.fileName && a.title === b.title && a.status === b.status && a.failed === b.failed;

class ViewerTabs {
  private entries: Entry[] = [];
  private activeId: string | null = null;
  private host: ViewerHost | null = null;
  private unregister: (() => void) | null = null;
  private seq = 0;

  constructor() {
    // The store is the active tab's state: keep its snapshot current (tool, temp pan, engine updates).
    viewerStore.subscribe((state) => {
      const entry = this.active();
      if (entry && state.tabId === entry.id) entry.snapshot = state;
      this.publish();
    });
  }

  // ---- queries --------------------------------------------------------------

  get count(): number {
    return this.entries.length;
  }

  get activeTabId(): string | null {
    return this.activeId;
  }

  /** The engine of a tab (tests, diagnostics). */
  engineOf(id: string): ViewerEngine | null {
    return this.find(id)?.engine ?? null;
  }

  private find(id: string | null): Entry | undefined {
    return id === null ? undefined : this.entries.find((e) => e.id === id);
  }

  private active(): Entry | undefined {
    return this.find(this.activeId);
  }

  // ---- opening and closing ----------------------------------------------------

  /**
   * Opens `file` in a new tab and activates it (AC 1). A file already open
   * (same name, size and date; after hashing, the same sha256) activates its
   * tab instead. Past MAX_TABS a quiet toast explains the limit (AC 6).
   */
  open(file: File): void {
    const fileKey = fileKeyOf(file);
    const duplicate = findDuplicate(this.entries, { fileKey });
    if (duplicate) {
      this.activate(duplicate.id);
      return;
    }
    if (this.entries.length >= MAX_TABS) {
      toast({ title: `Up to ${MAX_TABS} drawings can be open at once. Close one to open ${file.name}.`, variant: "info" });
      return;
    }
    const id = `doc-${++this.seq}`;
    const current = viewerStore.getState();
    this.entries.push({
      id,
      file,
      fileKey,
      sha256: null,
      // A new tab starts with the tool in use (the tool is per tab from then on).
      snapshot: this.loadingState(file, id, current.tool),
      engine: null,
    });
    this.activate(id);
    this.startEngine(this.find(id)!);
  }

  /** Opens the active tab's file again (Try again after a render failure). */
  retry(): void {
    const entry = this.active();
    if (!entry) return;
    viewerStore.setState(this.loadingState(entry.file, entry.id, viewerStore.getState().tool), true);
    if (entry.engine) void entry.engine.open(entry.file);
    else this.startEngine(entry);
  }

  /** Closes a tab and frees its render resources (AC 4); the neighbour (right, else left) becomes active. */
  close(id: string, activateInstead?: string): void {
    const entry = this.find(id);
    if (!entry) return;
    const next = activateInstead ?? activeAfterClose(this.entries.map((e) => e.id), this.activeId, id);
    this.entries = this.entries.filter((e) => e !== entry);
    if (this.activeId === id) {
      this.activeId = null;
      this.unregister?.();
      this.unregister = null;
    }
    // Terminates the tab's worker (pdf.js document and caches) and closes its bitmaps.
    entry.engine?.destroy();
    entry.engine = null;
    if (next && this.find(next)) {
      this.activate(next);
    } else if (this.entries.length === 0) {
      this.host?.activate(null);
      viewerStore.setState((s) => ({ ...INITIAL_VIEWER_STATE, openSeq: s.openSeq + 1, tool: s.tool }), true);
    }
    this.applyBudgets();
    this.publish();
  }

  /** Closes the active tab (Ctrl+F4). */
  closeActive(): void {
    if (this.activeId) this.close(this.activeId);
  }

  /** Closes every tab (tests; the workspace going away). */
  closeAll(): void {
    for (const entry of [...this.entries]) entry.engine?.destroy();
    this.entries = [];
    this.activeId = null;
    this.unregister?.();
    this.unregister = null;
    this.host?.activate(null);
    this.publish();
  }

  // ---- switching ----------------------------------------------------------------

  /** Shows tab `id`: the previous tab's engine is suspended, this one's resumes where it was (AC 3). */
  activate(id: string): void {
    const next = this.find(id);
    if (!next || this.activeId === id) return;
    const previous = this.active();
    previous?.engine?.suspend();
    this.activeId = id;
    // The new tab's state, as it was left (temporary pan never carries over).
    viewerStore.setState({ ...next.snapshot, tempPan: false }, true);
    this.unregister?.();
    this.unregister = next.engine ? registerViewerEngine(next.engine) : null;
    this.applyBudgets();
    this.host?.activate(next.engine);
    next.engine?.resume();
    this.publish();
  }

  /** The next / previous tab (Ctrl+PageDown / Ctrl+PageUp, Alt+PageDown / Alt+PageUp). */
  cycle(direction: 1 | -1): void {
    const id = cycleTab(
      this.entries.map((e) => e.id),
      this.activeId,
      direction,
    );
    if (id) this.activate(id);
  }

  // ---- host ---------------------------------------------------------------------

  /**
   * The CanvasViewport mounted: engines are created for the open tabs (and
   * their files opened). Returns the detach, which destroys the engines (a
   * later attach opens the files again).
   */
  attachHost(host: ViewerHost): () => void {
    this.host = host;
    for (const entry of this.entries) if (!entry.engine) this.startEngine(entry);
    return () => {
      if (this.host !== host) return;
      this.unregister?.();
      this.unregister = null;
      for (const entry of this.entries) {
        entry.engine?.destroy();
        entry.engine = null;
      }
      this.host = null;
    };
  }

  // ---- internals ------------------------------------------------------------------

  private loadingState(file: File, tabId: string, tool: ViewerState["tool"]): ViewerState {
    return {
      ...INITIAL_VIEWER_STATE,
      status: "loading",
      file,
      fileName: file.name,
      openSeq: viewerStore.getState().openSeq + 1,
      tool,
      tabId,
    };
  }

  /** Creates the tab's engine on the host's canvases and opens its file. */
  private startEngine(entry: Entry): void {
    const host = this.host;
    if (!host || entry.engine) return;
    const engine = new ViewerEngine(host.canvases, new RenderClient(host.createWorker), (patch) => this.patch(entry.id, patch));
    entry.engine = engine;
    if (entry.id === this.activeId) {
      this.unregister?.();
      this.unregister = registerViewerEngine(engine);
      host.activate(engine);
    } else {
      engine.suspend();
    }
    this.applyBudgets();
    void engine.open(entry.file);
  }

  /** An engine's state update: to the store while its tab is active, else to its snapshot. */
  private patch(id: string, patch: Partial<ViewerState>): void {
    const entry = this.find(id);
    if (!entry) return;
    if (id === this.activeId) viewerStore.setState(patch);
    else entry.snapshot = { ...entry.snapshot, ...patch };
    if (patch.documentId) this.hashed(entry, patch.documentId);
    this.publish();
  }

  /** The worker hashed the file: a document already open in another tab activates that tab (AC 1). */
  private hashed(entry: Entry, sha256: string): void {
    entry.sha256 = sha256;
    const duplicate = findDuplicate(this.entries, { sha256 }, entry.id);
    // After the engine's update returns (it is still inside its open()).
    if (duplicate) queueMicrotask(() => this.close(entry.id, duplicate.id));
  }

  /** Background tabs keep a small tile budget, the active one the rest (AC 6). */
  private applyBudgets(): void {
    const budgets = tileBudgets(this.entries.length);
    for (const entry of this.entries) entry.engine?.setTileBudget(entry.id === this.activeId ? budgets.active : budgets.background);
  }

  private publish(): void {
    const tabs = this.entries.map(
      (e): DocumentTab => ({
        id: e.id,
        fileName: e.file.name,
        title: tabTitle(e.snapshot),
        status: e.snapshot.status,
        failed: e.snapshot.status === "error",
      }),
    );
    const current = tabsStore.getState();
    if (
      current.activeId === this.activeId &&
      current.tabs.length === tabs.length &&
      current.tabs.every((t, i) => sameTab(t, tabs[i]))
    ) {
      return;
    }
    tabsStore.setState({ tabs, activeId: this.activeId });
  }
}

/** The open drawings (one per document tab). */
export const viewerTabs = new ViewerTabs();

/** Opens `file` in a new document tab (or activates the tab that already shows it). */
export function openDocument(file: File): void {
  viewerTabs.open(file);
}

/** Closes every tab: back to the empty workspace (tests). */
export function resetViewer(): void {
  viewerTabs.closeAll();
  viewerStore.setState((s) => ({ ...INITIAL_VIEWER_STATE, openSeq: s.openSeq + 1 }), true);
}
