// Open documents as tabs (Story 3.5): the pure rules of the tab list. No
// framework, no DOM: the viewer's tab manager applies them.

/** Most drawings open at once (AC 6): each tab keeps a render worker and its parsed PDF. */
export const MAX_TABS = 8;

/** Total in-memory tile budget shared by the open tabs (bytes). */
export const TOTAL_TILE_BUDGET = 256 * 1024 * 1024;

/** In-memory tile budget of each background tab (bytes); the active tab gets the rest. */
export const BACKGROUND_TILE_BUDGET = 16 * 1024 * 1024;

/** The fields of a tab the rules need. */
export type TabKey = {
  id: string;
  /** The file's sha256 once the worker hashed it. */
  sha256: string | null;
  /** name, size and modification time: a cheap guess at "the same file" before it is hashed. */
  fileKey: string;
};

/** `name|size|lastModified` of a file. */
export function fileKeyOf(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/**
 * The tab that already shows this document, if any: same sha256 (definitive)
 * or, before hashing, the same file key. `except` skips the asking tab.
 */
export function findDuplicate<T extends TabKey>(
  tabs: readonly T[],
  doc: { sha256?: string | null; fileKey?: string | null },
  except?: string,
): T | null {
  for (const tab of tabs) {
    if (tab.id === except) continue;
    if (doc.sha256 && tab.sha256 === doc.sha256) return tab;
    if (doc.fileKey && tab.fileKey === doc.fileKey) return tab;
  }
  return null;
}

/**
 * The tab to activate after closing `closing` (AC 4): the active one stays when
 * another tab closes; closing the active tab activates its right neighbour,
 * else the left one; null when no tab is left.
 */
export function activeAfterClose(ids: readonly string[], activeId: string | null, closing: string): string | null {
  const index = ids.indexOf(closing);
  if (index < 0) return activeId;
  if (activeId !== closing) return activeId;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** The next (+1) or previous (-1) tab, wrapping around; null without tabs. */
export function cycleTab(ids: readonly string[], activeId: string | null, direction: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index < 0) return ids[0];
  return ids[(index + direction + ids.length) % ids.length];
}

/**
 * Tile budgets for `count` open tabs (AC 6): each background tab keeps a small
 * budget, the active tab the rest of the shared total.
 */
export function tileBudgets(count: number): { active: number; background: number } {
  const background = Math.max(0, count - 1);
  return { active: TOTAL_TILE_BUDGET - background * BACKGROUND_TILE_BUDGET, background: BACKGROUND_TILE_BUDGET };
}

export type TabKeyEvent = {
  key: string;
  /** The physical key ("KeyW"); Alt+letter uses it, as macOS turns Option+W into "∑". */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type TabKeyAction = { type: "cycle"; direction: 1 | -1 } | { type: "close" };

/** The tab keys in the UX shortcut table form (tooltips, menus, aria-keyshortcuts). */
export const TAB_SHORTCUTS = {
  next: "Alt+PageDown Ctrl+PageDown",
  previous: "Alt+PageUp Ctrl+PageUp",
  close: "Alt+W Ctrl+F4",
} as const;

/**
 * The tab action of a key press (AC 2, AC 4; founder decision 2026-10-23).
 * Ctrl+Tab and Ctrl+W are the browser's, and Chrome also keeps Ctrl+PageDown /
 * Ctrl+PageUp / Ctrl+F4 unless the app is installed or full screen. So
 * Alt+PageDown / Alt+PageUp (next / previous) and Alt+W (close) are the
 * primary keys. The Ctrl keys stay as secondary ones wherever they reach the page.
 */
export function resolveTabKey(event: TabKeyEvent): TabKeyAction | null {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.shiftKey) return null;
  if (ctrl !== event.altKey) {
    if (event.key === "PageDown") return { type: "cycle", direction: 1 };
    if (event.key === "PageUp") return { type: "cycle", direction: -1 };
  }
  if (event.altKey && !ctrl && (event.code === "KeyW" || event.key.toLowerCase() === "w")) return { type: "close" };
  if (ctrl && !event.altKey && event.key === "F4") return { type: "close" };
  return null;
}
