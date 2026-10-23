import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { BACKGROUND_TILE_BUDGET, MAX_TABS, TOTAL_TILE_BUDGET } from "@/core/documents/tabs";

import { viewerCommands } from "./viewer-commands";
import type { ViewerCanvases, ViewerEngine } from "./viewer-engine";
import { setTool, viewerStore } from "./viewer-store";
import { openDocument, resetViewer, tabsStore, viewerTabs, type ViewerHost } from "./viewer-tabs";

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

  it(`caps the open drawings at ${MAX_TABS} with a quiet toast`, async () => {
    for (let i = 0; i < MAX_TABS; i++) await openFile(`d${i}.pdf`, `sha-${i}`);
    openDocument(file("one-more.pdf"));
    expect(tabsStore.getState().tabs).toHaveLength(MAX_TABS);
    expect(toastStore.getState().visible.at(-1)).toMatchObject({ variant: "info" });
    expect(toastStore.getState().visible.at(-1)?.title).toContain(`Up to ${MAX_TABS} drawings`);
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

  it("the tab title is the shown page's sheet number, else the file name; a failure marks only its tab", async () => {
    await openFile("A1721-L17.pdf", "sha-17");
    const w2 = await openFile("broken.pdf", "sha-x");
    expect(tabsStore.getState().tabs[0].title).toBe("A1721-L17.pdf");
    viewerStore.setState({ sheetLabels: { 0: "S-101" } });
    expect(tabsStore.getState().tabs[1].title).toBe("S-101");
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
