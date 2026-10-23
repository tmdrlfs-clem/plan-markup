// The Search panel's shared UI state (Story 3.6): whether it is open (search
// highlights show only then, AC 6) and requests to focus its query field
// (Ctrl+F). Framework-free zustand store, like viewerStore.

import { createStore } from "zustand/vanilla";

export type SearchUiState = {
  /** The Search panel is mounted (open in the left panel area). */
  panelOpen: boolean;
  /** Bumped by Ctrl+F: the panel focuses and selects its query field. */
  focusRequest: number;
};

export const searchUi = createStore<SearchUiState>(() => ({ panelOpen: false, focusRequest: 0 }));

/** Ctrl+F: asks the (opening) Search panel to focus its query field. */
export function requestSearchFocus(): void {
  searchUi.setState((s) => ({ focusRequest: s.focusRequest + 1 }));
}
