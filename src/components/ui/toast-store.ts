import { createStore } from "zustand/vanilla";

export type ToastVariant = "neutral" | "success" | "warning" | "danger" | "info";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** At most one action (UX-DR33). */
  action?: ToastAction;
}

export interface ToastItem {
  id: string;
  /** Merge key: variant|title|description. */
  key: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  action?: ToastAction;
  /** How many identical toasts were merged into this one. */
  count: number;
  /** Bumped when a duplicate arrives so the view can restart the auto-dismiss timer. */
  restart: number;
}

export const MAX_VISIBLE_TOASTS = 3;

export interface ToastState {
  visible: ToastItem[];
  queue: ToastItem[];
}

export const toastStore = createStore<ToastState>(() => ({ visible: [], queue: [] }));

let nextId = 1;

function mergeKey(input: ToastInput): string {
  return `${input.variant ?? "neutral"}|${input.title}|${input.description ?? ""}`;
}

/** Shows a toast. Returns its id (the existing one when merged into a visible or queued duplicate). */
export function toast(input: ToastInput): string {
  const key = mergeKey(input);
  const { visible, queue } = toastStore.getState();

  const bump = (item: ToastItem): ToastItem => ({ ...item, count: item.count + 1, restart: item.restart + 1 });

  const shown = visible.find((t) => t.key === key);
  if (shown) {
    toastStore.setState({ visible: visible.map((t) => (t === shown ? bump(t) : t)) });
    return shown.id;
  }
  const waiting = queue.find((t) => t.key === key);
  if (waiting) {
    toastStore.setState({ queue: queue.map((t) => (t === waiting ? bump(t) : t)) });
    return waiting.id;
  }

  const item: ToastItem = {
    id: `toast-${nextId++}`,
    key,
    title: input.title,
    description: input.description,
    variant: input.variant ?? "neutral",
    action: input.action,
    count: 1,
    restart: 0,
  };
  if (visible.length < MAX_VISIBLE_TOASTS) toastStore.setState({ visible: [...visible, item] });
  else toastStore.setState({ queue: [...queue, item] });
  return item.id;
}

/** Closes a toast; the oldest queued toast takes its place. */
export function dismiss(id: string): void {
  const { visible, queue } = toastStore.getState();
  if (queue.some((t) => t.id === id)) {
    toastStore.setState({ queue: queue.filter((t) => t.id !== id) });
    return;
  }
  if (!visible.some((t) => t.id === id)) return;
  const remaining = visible.filter((t) => t.id !== id);
  const [promoted, ...rest] = queue;
  toastStore.setState({
    visible: promoted && remaining.length < MAX_VISIBLE_TOASTS ? [...remaining, promoted] : remaining,
    queue: promoted && remaining.length < MAX_VISIBLE_TOASTS ? rest : queue,
  });
}

/** Clears everything. Mainly for tests. */
export function resetToasts(): void {
  toastStore.setState({ visible: [], queue: [] });
}
