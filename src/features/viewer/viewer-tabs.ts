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
import { RenderClient } from "@/workers/rpc";

import { thumbnailScroll } from "./thumbnail-scroll";
import { registerViewerEngine } from "./viewer-commands";
import { ViewerEngine, type ViewerCanvases } from "./viewer-engine";
import { INITIAL_VIEWER_STATE, viewerStore, type ViewerState, type ViewerStatus } from "./viewer-store";

/** What the tab strip shows of a tab. */
export type DocumentTab = {
  id: string;
  fileName: string;
  /** The file name (founder decision 2026-10-23: never the sheet number). */
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
  /** Story 6.6: the document the file stands in for (blank pages of a markup set). */
  documentId?: string;
  snapshot: ViewerState;
  engine: ViewerEngine | null;
};

/**
 * The tab title: always the file name (founder decision 2026-10-23). A sheet
 * number would rename the tab of a set on every page, and two sets can share one.
 */
export function tabTitle(s: Pick<ViewerState, "fileName">): string {
  return s.fileName ?? "";
}

/** What `open` did with a file. */
export type OpenOutcome = "opened" | "activated" | "limit";

/** Each open of a file in a tab (a retry too) gets its own `openSeq`, never reused. */
let lastOpenSeq = 0;
const nextOpenSeq = () => ++lastOpenSeq;

const sameTab = (a: DocumentTab, b: DocumentTab) =>
  a.id === b.id && a.fileName === b.fileName && a.title === b.title && a.status === b.status && a.failed === b.failed;

class ViewerTabs {
  private entries: Entry[] = [];
  private activeId: string | null = null;
  private host: ViewerHost | null = null;
  private unregister: (() => void) | null = null;
  private seq = 0;
  private owner: string | null = null;

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
   * tab instead. Past MAX_TABS nothing opens ("limit"; openDocuments explains
   * it in one quiet toast, AC 6).
   */
  open(file: File, documentId?: string): OpenOutcome {
    const fileKey = fileKeyOf(file);
    const duplicate = findDuplicate(this.entries, { fileKey, sha256: documentId });
    if (duplicate) {
      this.activate(duplicate.id);
      return "activated";
    }
    if (this.entries.length >= MAX_TABS) return "limit";
    const id = `doc-${++this.seq}`;
    const current = viewerStore.getState();
    this.entries.push({
      id,
      file,
      fileKey,
      sha256: documentId ?? null,
      documentId,
      // A new tab starts with the tool in use (the tool is per tab from then on).
      snapshot: this.loadingState(file, id, current.tool),
      engine: null,
    });
    this.activate(id);
    this.startEngine(this.find(id)!);
    return "opened";
  }

  /** Opens the active tab's file again (Try again after a render failure). */
  retry(): void {
    const entry = this.active();
    if (!entry) return;
    viewerStore.setState(this.loadingState(entry.file, entry.id, viewerStore.getState().tool), true);
    if (entry.engine) void entry.engine.open(entry.file, entry.documentId);
    else this.startEngine(entry);
  }

  /**
   * Closes a tab and frees its render resources (AC 4). Closing the active tab
   * activates `activateInstead` when given and still open, else the neighbour
   * (right, else left); closing a background tab never changes the active one.
   */
  close(id: string, activateInstead?: string): void {
    const entry = this.find(id);
    if (!entry) return;
    const ids = this.entries.map((e) => e.id);
    const wasActive = this.activeId === id;
    const neighbour = activeAfterClose(ids, this.activeId, id);
    const next = wasActive && activateInstead && activateInstead !== id && this.find(activateInstead) ? activateInstead : neighbour;
    this.entries = this.entries.filter((e) => e !== entry);
    if (this.activeId === id) {
      this.activeId = null;
      this.unregister?.();
      this.unregister = null;
    }
    // Terminates the tab's worker (pdf.js document and caches) and closes its bitmaps.
    entry.engine?.destroy();
    entry.engine = null;
    thumbnailScroll.forgetTab(id);
    if (next && this.find(next)) {
      this.activate(next);
    } else if (this.entries.length === 0) {
      this.host?.activate(null);
      viewerStore.setState((s) => ({ ...INITIAL_VIEWER_STATE, openSeq: nextOpenSeq(), tool: s.tool }), true);
    }
    this.applyBudgets();
    this.publish();
  }

  private closeGuard: ((id: string) => boolean) | null = null;

  /**
   * What a user's close asks first (the workspace: a PDF save of a changed drawing).
   * `guard` returns true when it took the close over (it closes the tab itself, or not).
   */
  setCloseGuard(guard: (id: string) => boolean): () => void {
    this.closeGuard = guard;
    return () => {
      if (this.closeGuard === guard) this.closeGuard = null;
    };
  }

  /** A user's close (the X, a middle click, Delete, Alt+W, File → Close drawing): the guard may ask first. */
  requestClose(id: string): void {
    if (!this.find(id) || this.closeGuard?.(id)) return;
    this.close(id);
  }

  /** Closes the active tab (Alt+W, Ctrl+F4), asking first like any user's close. */
  closeActive(): void {
    if (this.activeId) this.requestClose(this.activeId);
  }

  /** Closes every tab (tests; another user's workspace). */
  closeAll(): void {
    for (const entry of [...this.entries]) entry.engine?.destroy();
    this.entries = [];
    thumbnailScroll.clear();
    this.activeId = null;
    this.unregister?.();
    this.unregister = null;
    this.host?.activate(null);
    this.publish();
  }

  /**
   * The signed-in user whose drawings the tabs hold. The tabs survive the
   * client-side navigation of a sign-out, so a workspace mounting for another
   * user closes them first: nobody sees the previous user's drawings.
   */
  setOwner(userId: string): void {
    if (this.owner !== null && this.owner !== userId && (this.entries.length > 0 || viewerStore.getState().status !== "empty")) {
      this.closeAll();
      viewerStore.setState({ ...INITIAL_VIEWER_STATE, openSeq: nextOpenSeq() }, true);
    }
    this.owner = userId;
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
      openSeq: nextOpenSeq(),
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
    void engine.open(entry.file, entry.documentId);
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

  /**
   * The worker hashed the file. A document already open in another tab closes
   * this tab (AC 1); if this tab was shown, the existing one is shown instead,
   * and a tab in the background never takes the active tab's place.
   */
  private hashed(entry: Entry, sha256: string): void {
    entry.sha256 = sha256;
    const duplicate = findDuplicate(this.entries, { sha256 }, entry.id);
    if (!duplicate) return;
    // Story 6.6: the PDF itself replaces blank pages standing in for it.
    if (duplicate.documentId && !entry.documentId) {
      queueMicrotask(() => this.close(duplicate.id, entry.id));
      return;
    }
    // After the engine's update returns (it is still inside its open()).
    queueMicrotask(() => this.close(entry.id, duplicate.id));
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

/**
 * Opens each file in a new document tab (or activates the tab that already
 * shows it); the last one opened is shown. Files past the tab cap are not
 * opened, and one quiet toast says so (AC 6).
 */
export function openDocuments(files: readonly File[]): void {
  const skipped = files.filter((file) => viewerTabs.open(file) === "limit");
  if (skipped.length === 0) return;
  const what = skipped.length === 1 ? skipped[0].name : `${skipped.length} files`;
  toast({ title: `Up to ${MAX_TABS} drawings can be open at once. Close one to open ${what}.`, variant: "info" });
}

/** Opens `file` in a new document tab (or activates the tab that already shows it). */
export function openDocument(file: File): void {
  openDocuments([file]);
}

/** Closes every tab: back to the empty workspace (tests). */
export function resetViewer(): void {
  viewerTabs.closeAll();
  viewerStore.setState({ ...INITIAL_VIEWER_STATE, openSeq: nextOpenSeq() }, true);
}

/**
 * Story 6.6: opens `file` as the pages of document `documentId` (blank pages
 * standing in for a markup set's PDF), or shows the tab that already has it.
 */
export function openDocumentAs(file: File, documentId: string): void {
  if (viewerTabs.open(file, documentId) === "limit") {
    toast({ title: `Up to ${MAX_TABS} drawings can be open at once. Close one to open ${file.name}.`, variant: "info" });
  }
}
