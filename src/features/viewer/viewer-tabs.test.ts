import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { BACKGROUND_TILE_BUDGET, MAX_TABS, TOTAL_TILE_BUDGET } from "@/core/documents/tabs";

import { viewerCommands } from "./viewer-commands";
import type { ViewerCanvases, ViewerEngine } from "./viewer-engine";
import { dismissNotice, setTool, viewerStore } from "./viewer-store";
import { openDocument, openDocumentAs, openDocuments, resetViewer, tabsStore, viewerTabs, type ViewerHost } from "./viewer-tabs";

type Msg = { type: string; reqId: number; payload: unknown };

class FakeWorker {
  posted: Msg[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  postMessage(msg: Msg) {
    this.posted.push(msg);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  terminate() {
    this.terminated = true;
  }
  last(type: string): Msg {
    const msg = this.posted.filter((m) => m.type === type).at(-1);
    if (!msg) throw new Error(`no ${type}`);
    return msg;
  }
  reply(msg: Msg, payload: unknown) {
    for (const fn of this.listeners.get("message") ?? []) fn({ data: { type: "result", reqId: msg.reqId, payload } });
  }
}

const PAGE = { width: 1000, height: 700, rotate: 0 };
const bitmap = () => ({ width: 400, height: 280, close: vi.fn() }) as unknown as ImageBitmap;
const canvas = () =>
  ({ width: 0, height: 0, getContext: () => null, focus: vi.fn(), dataset: {} }) as unknown as HTMLCanvasElement;

let workers: FakeWorker[];
let activations: (ViewerEngine | null)[];
let detach: () => void;

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function attach() {
  const canvases: ViewerCanvases = { tiles: canvas(), markups: canvas(), active: canvas() };
  const host: ViewerHost = {
    canvases,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    activate: (engine) => {
      activations.push(engine);
      engine?.setViewport(800, 600, 1);
    },
  };
  detach = viewerTabs.attachHost(host);
}

const file = (name: string, size = 4, lastModified = 1) =>
  new File([new Uint8Array(size).fill(37)], name, { type: "application/pdf", lastModified });

/** Opens `name` and answers the worker's open with `sha` (`pages` pages). */
async function openFile(name: string, sha: string, pages = 3, f = file(name)) {
  openDocument(f);
  await flush();
  const w = workers.at(-1)!;
  w.reply(w.last("render.open"), { sha256: sha, pageCount: pages, pages: Array.from({ length: pages }, () => PAGE), pageLabels: null, fromCache: false });
  await flush();
  return w;
}

function answerPreview(w: FakeWorker) {
  const msg = w.last("render.preview");
  w.reply(msg, {
    tile: { page: 1, bucket: null, col: 0, row: 0, scale: 0.4, x: 0, y: 0, width: 400, height: 280, bitmap: bitmap(), fromCache: false, waitMs: 0, renderMs: 1 },
    content: null,
  });
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  workers = [];
  activations = [];
  resetViewer();
  toastStore.setState({ visible: [], queue: [] });
  attach();
});

afterEach(() => {
  detach();
  resetViewer();
  vi.unstubAllGlobals();
});

describe("viewerTabs", () => {
  it("opens each drawing in its own tab with its own worker; the new tab is active, the old one suspended", async () => {
    const w1 = await openFile("L17.pdf", "sha-17");
    const w2 = await openFile("L21.pdf", "sha-21");
    expect(workers).toHaveLength(2);
    const { tabs, activeId } = tabsStore.getState();
    expect(tabs.map((t) => t.fileName)).toEqual(["L17.pdf", "L21.pdf"]);
    expect(activeId).toBe(tabs[1].id);
    expect(viewerStore.getState().fileName).toBe("L21.pdf");
    expect(viewerStore.getState().tabId).toBe(tabs[1].id);
    const [e1, e2] = tabs.map((t) => viewerTabs.engineOf(t.id)!);
    expect(e1.isSuspended).toBe(true);
    expect(e2.isSuspended).toBe(false);
    // The canvas commands drive the active tab.
    viewerCommands.goToPage(1);
    expect([e1.currentPage, e2.currentPage]).toEqual([0, 1]);
    // Budgets: the background tab keeps a small share.
    expect(e1.tileBudget).toBe(BACKGROUND_TILE_BUDGET);
    expect(e2.tileBudget).toBe(TOTAL_TILE_BUDGET - BACKGROUND_TILE_BUDGET);
    expect(w1.terminated || w2.terminated).toBe(false);
  });

  it("keeps each tab's page, view and tool; a background engine's updates go to its own tab", async () => {
    const w1 = await openFile("a.pdf", "sha-a");
    answerPreview(w1);
    await flush();
    viewerCommands.goToPage(2);
    setTool("pan");
    const first = tabsStore.getState().activeId!;
    const w2 = await openFile("b.pdf", "sha-b");
    // The new tab starts with the tool in use, at its own first page.
    expect(viewerStore.getState()).toMatchObject({ pageIndex: 0, tool: "pan", fileName: "b.pdf" });
    setTool("zoom");
    // A late update of the background tab does not touch the shown tab.
    answerPreview(w2);
    await flush();
    viewerTabs.activate(first);
    expect(viewerStore.getState()).toMatchObject({ fileName: "a.pdf", pageIndex: 2, tool: "pan", pageCount: 3 });
    expect(viewerTabs.engineOf(first)!.currentPage).toBe(2);
    expect(viewerTabs.engineOf(first)!.isSuspended).toBe(false);
    // The re-activated engine was handed to the host (input, canvas size) and resumed without a new open.
    expect(activations.at(-1)).toBe(viewerTabs.engineOf(first));
    expect(w1.posted.filter((m) => m.type === "render.open")).toHaveLength(1);
    viewerTabs.cycle(1);
    expect(viewerStore.getState()).toMatchObject({ fileName: "b.pdf", tool: "zoom" });
    viewerTabs.cycle(1);
    expect(viewerStore.getState().fileName).toBe("a.pdf");
  });

  it("a file already open activates its tab: before hashing by name/size/date, after hashing by sha256", async () => {
    const same = file("a.pdf", 4, 5);
    await openFile("a.pdf", "sha-a", 3, same);
    await openFile("b.pdf", "sha-b");
    openDocument(same);
    await flush();
    expect(tabsStore.getState().tabs).toHaveLength(2);
    expect(viewerStore.getState().fileName).toBe("a.pdf");
    expect(workers).toHaveLength(2);
    // A renamed copy: opened, then closed once its hash matches; the original tab is shown.
    const copy = await openFile("a copy.pdf", "sha-a");
    await flush();
    expect(tabsStore.getState().tabs.map((t) => t.fileName)).toEqual(["a.pdf", "b.pdf"]);
    expect(viewerStore.getState().fileName).toBe("a.pdf");
    expect(copy.terminated).toBe(true);
  });

  it(`caps the open drawings at ${MAX_TABS} with one quiet toast, however many files are over`, async () => {
    for (let i = 0; i < MAX_TABS; i++) await openFile(`d${i}.pdf`, `sha-${i}`);
    openDocument(file("one-more.pdf"));
    expect(tabsStore.getState().tabs).toHaveLength(MAX_TABS);
    expect(toastStore.getState().visible.at(-1)).toMatchObject({ variant: "info" });
    expect(toastStore.getState().visible.at(-1)?.title).toBe(`Up to ${MAX_TABS} drawings can be open at once. Close one to open one-more.pdf.`);
    toastStore.setState({ visible: [], queue: [] });
    openDocuments([file("x.pdf"), file("y.pdf"), file("z.pdf"), file("d0.pdf")]);
    expect(tabsStore.getState().tabs).toHaveLength(MAX_TABS);
    const all = [...toastStore.getState().visible, ...toastStore.getState().queue];
    expect(all.map((t) => t.title)).toEqual([`Up to ${MAX_TABS} drawings can be open at once. Close one to open 3 files.`]);
    // d0.pdf was open already: its tab is shown.
    expect(viewerStore.getState().fileName).toBe("d0.pdf");
  });

  it("blank pages stand in for a set's document (its id, not the blank file's hash); the PDF itself replaces them (Story 6.6)", async () => {
    openDocumentAs(file("L17.pdf", 9), "sha-set");
    await flush();
    const blank = workers.at(-1)!;
    blank.reply(blank.last("render.open"), { sha256: "sha-blank", pageCount: 2, pages: [PAGE, PAGE], pageLabels: null, fromCache: false });
    await flush();
    expect(viewerStore.getState().documentId).toBe("sha-set");
    // Asking again shows the same tab.
    openDocumentAs(file("L17.pdf", 9, 2), "sha-set");
    await flush();
    expect(tabsStore.getState().tabs).toHaveLength(1);
    // The PDF itself: its tab stays, the stand-in closes.
    const real = await openFile("L17.pdf", "sha-set", 2, file("L17.pdf", 50, 3));
    await flush();
    expect(tabsStore.getState().tabs).toHaveLength(1);
    expect(blank.terminated).toBe(true);
    expect(real.terminated).toBe(false);
    expect(viewerStore.getState().documentId).toBe("sha-set");
  });

  it("a copy hashed in the background closes without taking the shown tab's place", async () => {
    await openFile("a.pdf", "sha-a");
    // The copy and another drawing open together (one drop): the other one is shown.
    openDocuments([file("a copy.pdf"), file("c.pdf")]);
    await flush();
    const [, copyWorker, cWorker] = workers;
    const shown = tabsStore.getState().activeId;
    expect(viewerStore.getState().fileName).toBe("c.pdf");
    copyWorker.reply(copyWorker.last("render.open"), { sha256: "sha-a", pageCount: 1, pages: [PAGE], pageLabels: null, fromCache: false });
    await flush();
    expect(copyWorker.terminated).toBe(true);
    expect(tabsStore.getState().tabs.map((t) => t.fileName)).toEqual(["a.pdf", "c.pdf"]);
    expect(tabsStore.getState().activeId).toBe(shown);
    expect(viewerStore.getState().fileName).toBe("c.pdf");
    expect(cWorker.terminated).toBe(false);
  });

  it("closing the shown tab with a target that is gone falls back to the neighbour: a tab is always active", async () => {
    await openFile("a.pdf", "sha-a");
    await openFile("b.pdf", "sha-b");
    await openFile("c.pdf", "sha-c");
    const [a, b, c] = tabsStore.getState().tabs.map((t) => t.id);
    viewerTabs.activate(b);
    viewerTabs.close(b, "doc-gone");
    expect(tabsStore.getState().activeId).toBe(c);
    // A background tab closing with a target never changes the shown tab.
    viewerTabs.close(a, c);
    expect(tabsStore.getState().activeId).toBe(c);
    expect(viewerStore.getState().fileName).toBe("c.pdf");
  });

  it("each open gets its own openSeq, never reused across tabs", async () => {
    await openFile("a.pdf", "sha-a");
    const seqA = viewerStore.getState().openSeq;
    await openFile("b.pdf", "sha-b");
    const seqB = viewerStore.getState().openSeq;
    viewerTabs.activate(tabsStore.getState().tabs[0].id);
    expect(viewerStore.getState().openSeq).toBe(seqA);
    await openFile("c.pdf", "sha-c");
    const seqC = viewerStore.getState().openSeq;
    expect(new Set([seqA, seqB, seqC]).size).toBe(3);
  });

  it("a dismissed notice stays dismissed in its tab only", async () => {
    await openFile("a.pdf", "sha-a");
    dismissNotice("image-only");
    const [a] = tabsStore.getState().tabs.map((t) => t.id);
    await openFile("b.pdf", "sha-b");
    expect(viewerStore.getState().dismissedNotices).toEqual([]);
    viewerTabs.activate(a);
    expect(viewerStore.getState().dismissedNotices).toEqual(["image-only"]);
  });

  it("another user's workspace starts empty: the previous user's tabs are closed", async () => {
    viewerTabs.setOwner("user-1");
    const w1 = await openFile("a.pdf", "sha-a");
    viewerTabs.setOwner("user-1");
    expect(tabsStore.getState().tabs).toHaveLength(1);
    viewerTabs.setOwner("user-2");
    expect(w1.terminated).toBe(true);
    expect(tabsStore.getState().tabs).toEqual([]);
    expect(viewerStore.getState()).toMatchObject({ status: "empty", fileName: null, file: null });
  });

  it("closing frees the tab's worker; the right neighbour, else the left, becomes active; the last returns to empty", async () => {
    const w1 = await openFile("a.pdf", "sha-a");
    const w2 = await openFile("b.pdf", "sha-b");
    const w3 = await openFile("c.pdf", "sha-c");
    const [a, b, c] = tabsStore.getState().tabs.map((t) => t.id);
    viewerTabs.activate(b);
    viewerTabs.close(b);
    expect(w2.terminated).toBe(true);
    expect(tabsStore.getState().activeId).toBe(c);
    viewerTabs.closeActive();
    expect(w3.terminated).toBe(true);
    expect(tabsStore.getState().activeId).toBe(a);
    expect(viewerTabs.engineOf(a)!.tileBudget).toBe(TOTAL_TILE_BUDGET);
    viewerTabs.close(a);
    expect(w1.terminated).toBe(true);
    expect(tabsStore.getState()).toEqual({ tabs: [], activeId: null });
    expect(viewerStore.getState().status).toBe("empty");
    expect(activations.at(-1)).toBeNull();
  });

  it("the tab title is always the file name (not the sheet number); a failure marks only its tab", async () => {
    await openFile("A1721-L17.pdf", "sha-17");
    const w2 = await openFile("broken.pdf", "sha-x");
    expect(tabsStore.getState().tabs[0].title).toBe("A1721-L17.pdf");
    viewerStore.setState({ sheetLabels: { 0: "S-101" } });
    expect(tabsStore.getState().tabs[1].title).toBe("broken.pdf");
    w2.posted.length = 0;
    // Retry opens the active tab's file again in the same tab.
    viewerTabs.retry();
    await flush();
    expect(w2.posted.some((m) => m.type === "render.open")).toBe(true);
    expect(viewerStore.getState().status).toBe("loading");
    for (const fn of (w2 as unknown as { listeners: Map<string, Set<(e: unknown) => void>> }).listeners.get("message") ?? []) {
      fn({ data: { type: "error", reqId: w2.last("render.open").reqId, code: "invalid-pdf", error: { name: "Error", message: "bad" } } });
    }
    await flush();
    const tabs = tabsStore.getState().tabs;
    expect(tabs.map((t) => t.failed)).toEqual([false, true]);
  });

  it("detaching the host destroys the engines; attaching again reopens the files", async () => {
    const w1 = await openFile("a.pdf", "sha-a");
    detach();
    expect(w1.terminated).toBe(true);
    attach();
    expect(workers).toHaveLength(2);
    expect(workers[1].posted.some((m) => m.type === "render.open")).toBe(false);
    await flush();
    expect(workers[1].posted.some((m) => m.type === "render.open")).toBe(true);
  });
});
