import { createStore } from "zustand/vanilla";

export type HintVariant = "info" | "warning" | "danger";

export interface HintAction {
  label: string;
  onAction: () => void;
}

export interface Hint {
  /** Stable id of the notice ("image-only"); showing the same id again replaces it. */
  id: string;
  variant: HintVariant;
  text: string;
  action?: HintAction;
  /** Called when the user dismisses the notice (Dismiss), not when the code hides it. */
  onDismiss?: () => void;
}

export interface HintState {
  /** The one visible notice (UX-DR11: one at a time), or null. */
  hint: Hint | null;
}

export const hintStore = createStore<HintState>(() => ({ hint: null }));

/** Shows a file-level notice, replacing the current one. */
export function showHint(hint: Hint): void {
  hintStore.setState({ hint });
}

/** Hides the notice; with an id, only when that notice is the visible one. */
export function dismissHint(id?: string): void {
  const current = hintStore.getState().hint;
  if (!current || (id !== undefined && current.id !== id)) return;
  hintStore.setState({ hint: null });
}
