// Story 7.2: "Add to Tool Chest…" asks for a tool made of the selected
// markups. The editor (the context menu) only sets the request; the Tool
// Chest's dialog answers it. Nothing here imports the editor.

import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import type { Markup } from "@/core/schema/markup";

export type AddToolRequest = {
  /** The selected markups, in drawing order. */
  markups: readonly Markup[];
  /** Their page's calibration and UserUnit (real size, Story 7.3). */
  calibration: Calibration | null;
  userUnit: number;
};

export const addToolStore = createStore<{ request: AddToolRequest | null }>(() => ({ request: null }));

/** Opens the Add to Tool Chest dialog for `request`. */
export function requestAddTool(request: AddToolRequest): void {
  addToolStore.setState({ request });
}

export function closeAddTool(): void {
  addToolStore.setState({ request: null });
}
