// View commands for the workspace's toolbar and menus (Story 3.2). The mounted
// CanvasViewport registers its engine; with no document the commands do nothing
// (and the workspace shows them disabled).

export interface ViewerCommandTarget {
  zoomStep(direction: 1 | -1): void;
  fitPage(): void;
  fitWidth(): void;
  rotate(delta: 90 | -90): void;
}

let target: ViewerCommandTarget | null = null;

/** Makes `engine` the target of the view commands; returns the unregister function. */
export function registerViewerEngine(engine: ViewerCommandTarget): () => void {
  target = engine;
  return () => {
    if (target === engine) target = null;
  };
}

export const viewerCommands = {
  zoomIn: () => target?.zoomStep(1),
  zoomOut: () => target?.zoomStep(-1),
  fitPage: () => target?.fitPage(),
  fitWidth: () => target?.fitWidth(),
  rotateClockwise: () => target?.rotate(90),
  rotateCounterClockwise: () => target?.rotate(-90),
};

export type ViewerCommand = keyof typeof viewerCommands;
