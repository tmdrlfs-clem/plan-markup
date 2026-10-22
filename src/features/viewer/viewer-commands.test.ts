import { describe, expect, it, vi } from "vitest";

import { registerViewerEngine, viewerCommands } from "./viewer-commands";

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
