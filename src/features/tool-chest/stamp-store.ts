// Story 7.3 (FR41, UX-DR19): the Tool Chest tool armed for placing (the
// viewer's Stamp tool places it at each click until Esc; S arms the last one
// again), and the tile being dragged onto the canvas (placed once). Nothing
// here imports the editor or the viewer.

import { createStore } from "zustand/vanilla";

import type { PlacedTool } from "@/core/tools/place";

export type StampTool = PlacedTool & { id: string; name: string };

export const stampStore = createStore<{ armed: StampTool | null; dragging: StampTool | null }>(() => ({ armed: null, dragging: null }));

/** The type a tile's drag carries (the drop reads the tool from `dragging`). */
export const TOOL_DRAG_TYPE = "application/x-plan-markup-tool";

export function setArmedStamp(tool: StampTool | null): void {
  stampStore.setState({ armed: tool });
}

export function setDraggedStamp(tool: StampTool | null): void {
  stampStore.setState({ dragging: tool });
}

/** Another user's workspace: nothing armed. */
export function resetStamps(): void {
  stampStore.setState({ armed: null, dragging: null });
}
