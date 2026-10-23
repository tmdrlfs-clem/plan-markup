// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hintStore } from "@/components/ui/hint-store";
import { TooltipProvider } from "@/components/ui/tooltip";

import { measureDevice } from "./canvas-viewport";
import { DocumentViewer, IMAGE_ONLY_HINT } from "./document-viewer";
import { viewerStore } from "./viewer-store";
import { openDocument, resetViewer } from "./viewer-tabs";

class FakeWorker {
  posted: { type: string; reqId: number }[] = [];
  terminated = false;
  postMessage(msg: { type: string; reqId: number }) {
    this.posted.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  terminate() {
    this.terminated = true;
  }
}

let worker: FakeWorker;
const createWorker = () => {
  worker = new FakeWorker();
  return worker as unknown as Worker;
};

function setup(onOpen = vi.fn(), onOpenFiles = vi.fn()) {
  const view = render(
    <TooltipProvider>
      <DocumentViewer onOpen={onOpen} onOpenFiles={onOpenFiles} createWorker={createWorker} />
    </TooltipProvider>,
  );
  return { onOpen, onOpenFiles, ...view };
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  resetViewer();
  hintStore.setState({ hint: null });
});

describe("measureDevice", () => {
  const canvases = () => [document.createElement("canvas"), document.createElement("canvas")];

  it("uses the observed device-pixel-content-box size as is", () => {
    const cs = canvases();
    expect(measureDevice({ width: 800.4, height: 600.2 }, 1.25, { width: 1001, height: 750 }, true, cs)).toEqual({ width: 1001, height: 750 });
    expect(cs[0].style.width).toBe("");
  });

  it("ignores a stale observation (DPR changed first) and rounds meanwhile", () => {
    expect(measureDevice({ width: 800, height: 600 }, 2, { width: 1000, height: 750 }, true, canvases())).toEqual({ width: 1600, height: 1200 });
  });

  it("without device-pixel-content-box snaps the canvases' CSS size down to whole device px", () => {
    const cs = canvases();
    const device = measureDevice({ width: 800.5, height: 600.3 }, 1.5, null, false, cs);
    expect(device).toEqual({ width: 1200, height: 900 });
    for (const c of cs) expect([c.style.width, c.style.height]).toEqual(["800px", "600px"]);
  });
});

describe("CanvasViewport", () => {
  it("is a focusable, labelled canvas stack with no spinner (loading shows in the document tab)", async () => {
    openDocument(new File(["%PDF"], "L17.pdf", { type: "application/pdf" }));
    setup();
    const canvas = screen.getByTestId("drawing-canvas");
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas).toHaveAttribute("aria-label", "Drawing canvas");
    expect(canvas).toHaveAttribute("data-state", "loading");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    act(() => viewerStore.setState({ status: "ready", pageCount: 12, pageIndex: 2 }));
    expect(canvas).toHaveAttribute("aria-label", "Drawing canvas, page 3 of 12");
    expect(canvas).toHaveAttribute("data-state", "ready");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // The file is read and sent to the worker.
    await vi.waitFor(() => expect(worker.posted.map((m) => m.type)).toContain("render.open"));
  });

  it.each([
    ["invalid-pdf", "This file is not a valid PDF."],
    ["password-required", "This PDF is password-protected. Remove the password in another app and open it again."],
  ] as const)("shows the %s error inline with Open another file", async (code, text) => {
    const user = userEvent.setup();
    openDocument(new File(["x"], "bad.pdf"));
    const { onOpen } = setup();
    act(() => viewerStore.setState({ status: "error", error: code }));
    const alert = screen.getByTestId("viewer-error");
    expect(alert).toHaveTextContent(text);
    expect(screen.getByTestId("drawing-canvas")).toHaveAttribute("data-state", "render-error");
    await user.click(screen.getByRole("button", { name: "Open another file" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("re-measures at the new devicePixelRatio when the window moves to another monitor", () => {
    const queries: { media: string; listeners: Set<() => void> }[] = [];
    const original = window.matchMedia;
    window.matchMedia = ((media: string) => {
      const q = { media, listeners: new Set<() => void>() };
      queries.push(q);
      return {
        media,
        matches: true,
        addEventListener: (_: string, fn: () => void) => q.listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => q.listeners.delete(fn),
      };
    }) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    try {
      openDocument(new File(["%PDF"], "a.pdf"));
      const { unmount } = setup();
      const tiles = screen.getByTestId("tiles-canvas") as HTMLCanvasElement;
      expect(tiles.width).toBe(1); // jsdom lays out nothing: 1 CSS px x DPR 1
      expect(queries.at(-1)?.media).toBe("(resolution: 1dppx)");
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
      act(() => queries.at(-1)?.listeners.forEach((fn) => fn()));
      expect(tiles.width).toBe(2);
      expect(queries.at(-1)?.media).toBe("(resolution: 2dppx)"); // re-armed for the next change
      expect(queries.at(-2)?.listeners.size).toBe(0);
      unmount();
      expect(queries.at(-1)?.listeners.size).toBe(0);
    } finally {
      window.matchMedia = original;
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    }
  });

  it("offers Retry when tiles failed", () => {
    openDocument(new File(["%PDF"], "a.pdf"));
    setup();
    act(() => viewerStore.setState({ status: "ready", failedTiles: 2 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Parts of the page could not be drawn.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByTestId("drawing-canvas")).toHaveAttribute("data-state", "render-error");
    act(() => viewerStore.setState({ failedTiles: 1, pageFailed: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be drawn.");
  });

  it("opens dropped files and sets the window title; an image-only page raises the HintBar notice", () => {
    openDocument(new File(["%PDF"], "scan.pdf"));
    const { onOpenFiles, unmount } = setup();
    expect(document.title).toBe("scan.pdf — Plan Markup");
    const files = [new File(["%PDF"], "next.pdf")];
    fireEvent.drop(screen.getByTestId("canvas-viewport"), { dataTransfer: { files, types: ["Files"] } });
    expect(onOpenFiles).toHaveBeenCalledWith(files);
    act(() => viewerStore.setState({ status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } }));
    expect(hintStore.getState().hint).toMatchObject({ id: "image-only", variant: "info", text: IMAGE_ONLY_HINT });
    expect(screen.getByTestId("drawing-canvas")).toHaveAttribute("data-state", "image-only");
    unmount();
    expect(hintStore.getState().hint).toBeNull();
    expect(worker.terminated).toBe(true);
  });
});
