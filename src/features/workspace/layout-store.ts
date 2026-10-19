import { createStore, type StoreApi } from "zustand/vanilla";

import {
  BOTTOM_SIZE,
  LEFT_SIZE,
  SERVER_LAYOUT,
  clampSize,
  type WorkspaceLayout,
} from "./layout-persistence";
import type { LeftPanelId } from "./panel-registry";

export interface LayoutActions {
  setLeftCollapsed: (collapsed: boolean) => void;
  setLeftSize: (size: number) => void;
  /** Opens and activates a panel; for the panel that is already open and active it collapses instead (Revu rail). */
  showLeftPanel: (id: LeftPanelId) => void;
  setBottomCollapsed: (collapsed: boolean) => void;
  /** Reads the current state, so two toggles in one frame cancel out. */
  toggleBottomCollapsed: () => void;
  setBottomSize: (size: number) => void;
  hideAllPanels: () => void;
  replace: (layout: WorkspaceLayout) => void;
}

export type LayoutState = WorkspaceLayout & LayoutActions;
export type LayoutStore = StoreApi<LayoutState>;

export function createLayoutStore(initial: WorkspaceLayout = SERVER_LAYOUT): LayoutStore {
  return createStore<LayoutState>()((set) => ({
    ...initial,
    setLeftCollapsed: (collapsed) => set((s) => ({ left: { ...s.left, collapsed } })),
    setLeftSize: (size) => set((s) => ({ left: { ...s.left, size: clampSize(size, LEFT_SIZE) } })),
    showLeftPanel: (id) =>
      set((s) =>
        !s.left.collapsed && s.left.active === id
          ? { left: { ...s.left, collapsed: true } }
          : { left: { ...s.left, collapsed: false, active: id } },
      ),
    setBottomCollapsed: (collapsed) => set((s) => ({ bottom: { ...s.bottom, collapsed } })),
    toggleBottomCollapsed: () => set((s) => ({ bottom: { ...s.bottom, collapsed: !s.bottom.collapsed } })),
    setBottomSize: (size) => set((s) => ({ bottom: { ...s.bottom, size: clampSize(size, BOTTOM_SIZE) } })),
    hideAllPanels: () =>
      set((s) => ({ left: { ...s.left, collapsed: true }, bottom: { ...s.bottom, collapsed: true } })),
    replace: (layout) => set({ left: layout.left, bottom: layout.bottom }),
  }));
}

export function layoutOf(state: LayoutState): WorkspaceLayout {
  return { left: state.left, bottom: state.bottom };
}
