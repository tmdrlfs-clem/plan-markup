import { describe, expect, it, vi } from "vitest";

import { registerViewerEngine, viewerCommands, viewerThumbnails } from "./viewer-commands";

describe("viewerCommands", () => {
  it("route to the registered engine and do nothing without one", () => {
    viewerCommands.zoomIn(); // nothing registered: no throw
    const engine = {
      zoomStep: vi.fn(),
      fitPage: vi.fn(),
      fitWidth: vi.fn(),
      rotate: vi.fn(),
      goToPage: vi.fn(),
      focusCanvas: vi.fn(),
      currentPage: 2,
      pageCount: 5,
    };
    const unregister = registerViewerEngine(engine);
    viewerCommands.zoomIn();
    viewerCommands.zoomOut();
    viewerCommands.fitPage();
    viewerCommands.fitWidth();
    viewerCommands.rotateClockwise();
    viewerCommands.rotateCounterClockwise();
    expect(engine.zoomStep.mock.calls).toEqual([[1], [-1]]);
    expect(engine.fitPage).toHaveBeenCalledTimes(1);
    expect(engine.fitWidth).toHaveBeenCalledTimes(1);
    expect(engine.rotate.mock.calls).toEqual([[90], [-90]]);
    viewerCommands.firstPage();
    viewerCommands.previousPage();
    viewerCommands.nextPage();
    viewerCommands.lastPage();
    viewerCommands.goToPage(3);
    expect(engine.goToPage.mock.calls).toEqual([[0], [1], [3], [4], [3]]);
    viewerCommands.focusCanvas();
    expect(engine.focusCanvas).toHaveBeenCalledTimes(1);
    unregister();
    viewerCommands.fitPage();
    expect(engine.fitPage).toHaveBeenCalledTimes(1);
  });
});

describe("viewerThumbnails", () => {
  it("route thumbnail and sheet-label requests to the engine; without one they do nothing", () => {
    const listener = vi.fn();
    expect(viewerThumbnails.request(0, { width: 100, height: 80 }, listener)()).toBeUndefined();
    viewerThumbnails.requestSheetLabel(0);
    const cancel = vi.fn();
    const engine = {
      zoomStep: vi.fn(),
      fitPage: vi.fn(),
      fitWidth: vi.fn(),
      rotate: vi.fn(),
      goToPage: vi.fn(),
      focusCanvas: vi.fn(),
      currentPage: 0,
      pageCount: 2,
      thumbnail: vi.fn(() => cancel),
      requestSheetLabel: vi.fn(),
    };
    const unregister = registerViewerEngine(engine);
    viewerThumbnails.request(1, { width: 100, height: 80 }, listener)();
    viewerThumbnails.requestSheetLabel(1);
    expect(engine.thumbnail).toHaveBeenCalledWith(1, { width: 100, height: 80 }, listener);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(engine.requestSheetLabel).toHaveBeenCalledWith(1);
    unregister();
    expect(listener).not.toHaveBeenCalled();
  });
});
