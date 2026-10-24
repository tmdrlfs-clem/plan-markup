// The workspace's appearance theme on the client (Story 3.8, FR69, UX-DR3).
//
// The workspace page is rendered with the theme from the user's profile, so
// the first paint is already right (no pre-paint script, no CSP change). The
// store only holds a choice made in this session (null: the profile's). The
// theme is applied to the workspace root (server-rendered) and to <html>, so
// portals (menus, tooltips, dialogs) and the canvas token bridge
// (subscribeCanvasTokens observes <html>) follow it; leaving the workspace puts
// <html> back to Blueprint (sign-in and PendingActivation are always Blueprint).
// A copy in localStorage is the fallback while no profile value is known.

import { useLayoutEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { toast } from "@/components/ui/toast-store";
import { DEFAULT_THEME, THEME_LABELS, isTheme, type Theme } from "@/lib/theme";

import { setTheme as saveThemeOnProfile } from "./actions";

export const themeStore = createStore<{ theme: Theme | null }>(() => ({ theme: null }));

export const THEME_STORAGE_KEY = "pm.theme.v1";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The theme last chosen in this browser, or null (missing, unreadable, unknown). */
export function readStoredTheme(store: Storage | undefined = storage()): Theme | null {
  try {
    const value = store?.getItem(THEME_STORAGE_KEY) ?? null;
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme, store: Storage | undefined = storage()): void {
  try {
    store?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage full or blocked: the profile still has it.
  }
}

/**
 * The workspace's theme: this session's choice, else the profile's (`initial`,
 * rendered by the server), else the browser's last choice, else Blueprint.
 * Applies it to <html> before paint and restores Blueprint when the workspace
 * unmounts (sign-out goes back to the Blueprint sign-in).
 */
export function useWorkspaceTheme(initial: Theme | null): Theme {
  const chosen = useStore(themeStore, (s) => s.theme);
  const theme = chosen ?? initial ?? DEFAULT_THEME;
  useLayoutEffect(() => {
    // No profile value (should not happen in the workspace): the browser's last choice.
    if (initial === null && themeStore.getState().theme === null) {
      const stored = readStoredTheme();
      if (stored) themeStore.setState({ theme: stored });
    } else if (initial !== null) {
      storeTheme(themeStore.getState().theme ?? initial);
    }
  }, [initial]);
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useLayoutEffect(() => {
    // A choice made in another tab of this browser (review T3): it already saved it on the profile.
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue) && event.newValue !== themeStore.getState().theme) {
        themeStore.setState({ theme: event.newValue });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useLayoutEffect(
    () => () => {
      // The next user (or the sign-in page) starts from their own profile, never this choice.
      themeStore.setState({ theme: null });
      document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
    },
    [],
  );
  return theme;
}

/**
 * Switches the workspace to `next` at once (chrome and canvas overlays), keeps
 * it in this browser and stores it on the profile. If the profile cannot be
 * updated the previous theme comes back with an error toast.
 */
export async function chooseTheme(next: Theme, current: Theme, save: typeof saveThemeOnProfile = saveThemeOnProfile): Promise<void> {
  if (next === current) return;
  themeStore.setState({ theme: next });
  storeTheme(next);
  let ok = false;
  try {
    ok = (await save(next)).ok;
  } catch {
    ok = false;
  }
  if (ok) return;
  // Only undo if nothing newer was chosen meanwhile.
  if (themeStore.getState().theme === next) {
    themeStore.setState({ theme: current });
    storeTheme(current);
  }
  toast({ title: `${THEME_LABELS[next]} could not be saved`, description: "The theme was not changed. Try again shortly.", variant: "danger" });
}
