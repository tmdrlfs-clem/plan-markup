// Snap toggles of the status bar (Story 3.7 AC 4): content, markup and grid.
// They do nothing yet; Story 4.1 reads this store to drive snapping. The
// state is remembered per user in localStorage, like the workspace layout.

import { useLayoutEffect } from "react";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

export type SnapKind = "content" | "markup" | "grid";
export type SnapSettings = Record<SnapKind, boolean>;

/** Revu's defaults: snap to content and markups on, grid off. */
export const DEFAULT_SNAP: SnapSettings = { content: true, markup: true, grid: false };

export const SNAP_KINDS: readonly SnapKind[] = ["content", "markup", "grid"];

export const snapSettings = createStore<SnapSettings>(() => DEFAULT_SNAP);

export function setSnap(kind: SnapKind, on: boolean): void {
  snapSettings.setState({ [kind]: on } as Partial<SnapSettings>);
}

const Stored = z.object({ v: z.literal(1), content: z.boolean(), markup: z.boolean(), grid: z.boolean() });

export function snapStorageKey(userId: string): string {
  return `pm.snap.v1.${userId}`;
}

/** A stored value, or null when it is missing or unusable (the defaults apply). */
export function parseSnap(raw: string | null): SnapSettings | null {
  if (raw === null) return null;
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { content, markup, grid } = parsed.data;
    return { content, markup, grid };
  } catch {
    return null;
  }
}

export function loadSnap(storage: Storage | undefined, userId: string): SnapSettings {
  try {
    return parseSnap(storage?.getItem(snapStorageKey(userId)) ?? null) ?? DEFAULT_SNAP;
  } catch {
    return DEFAULT_SNAP;
  }
}

export function saveSnap(storage: Storage | undefined, userId: string, settings: SnapSettings): void {
  try {
    storage?.setItem(snapStorageKey(userId), JSON.stringify({ v: 1, ...settings }));
  } catch {
    // Storage full or blocked: the toggles are simply not remembered.
  }
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const sameSnap = (a: SnapSettings, b: SnapSettings) => a.content === b.content && a.markup === b.markup && a.grid === b.grid;

/**
 * Restores the user's snap toggles on mount (replacing whatever the previous
 * user left in the store) and saves every change (the workspace shell). A
 * change saved by another browser tab of the same user is followed (review
 * R6), so the tabs never undo each other's toggles.
 */
export function useSnapSettingsPersistence(userId: string): void {
  useLayoutEffect(() => {
    const storage = localStorageOrUndefined();
    const key = snapStorageKey(userId);
    snapSettings.setState(loadSnap(storage, userId), true);
    const unsubscribe = snapSettings.subscribe((s) => saveSnap(storage, userId, s));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = parseSnap(event.newValue) ?? DEFAULT_SNAP;
      // Equal values change nothing (and are not saved back).
      if (!sameSnap(next, snapSettings.getState())) snapSettings.setState(next, true);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [userId]);
}
