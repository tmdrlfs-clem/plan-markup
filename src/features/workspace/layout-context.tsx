"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { loadLayout, saveLayout } from "./layout-persistence";
import { createLayoutStore, layoutOf, type LayoutState, type LayoutStore } from "./layout-store";

const LayoutStoreContext = createContext<LayoutStore | null>(null);

const SAVE_DEBOUNCE_MS = 200;

function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Owns the workspace layout store. The server renders the collapsed layout; on mount the
 * stored (or viewport default) layout is restored and later changes are saved per user.
 */
export function LayoutProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [store] = useState(() => createLayoutStore());

  useLayoutEffect(() => {
    const storage = localStorageOrUndefined();
    store
      .getState()
      .replace(loadLayout(storage, userId, { width: window.innerWidth, height: window.innerHeight }));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      saveLayout(storage, userId, layoutOf(store.getState()));
    };
    const flushPending = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      flush();
    };
    const unsubscribe = store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });
    // A reload or closed tab inside the debounce window still saves.
    window.addEventListener("pagehide", flushPending);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flushPending);
      flushPending();
    };
  }, [store, userId]);

  return <LayoutStoreContext.Provider value={store}>{children}</LayoutStoreContext.Provider>;
}

export function useLayoutStore(): LayoutStore {
  const store = useContext(LayoutStoreContext);
  if (!store) throw new Error("useLayoutStore must be used inside LayoutProvider");
  return store;
}

export function useLayout<T>(selector: (state: LayoutState) => T): T {
  return useStore(useLayoutStore(), selector);
}
