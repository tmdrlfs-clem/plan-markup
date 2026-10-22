import { describe, expect, it, vi } from "vitest";

import { registerViewerEngine, viewerCommands } from "./viewer-commands";

describe("viewerCommands", () => {
  it("route to the registered engine and do nothing without one", () => {
    viewerCommands.zoomIn(); // nothing registered: no throw
    const engine = { zoomStep: vi.fn(), fitPage: vi.fn(), fitWidth: vi.fn(), rotate: vi.fn() };
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
    unregister();
    viewerCommands.fitPage();
    expect(engine.fitPage).toHaveBeenCalledTimes(1);
  });
});
