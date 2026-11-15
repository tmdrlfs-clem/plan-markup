"use client";

import { useLayoutEffect } from "react";

import { getTheme, setTheme } from "@/components/ui/tokens";

/**
 * The admin area is always Daylight. Its layout sets the theme on its own
 * wrapper for the server render; this also sets it on <html> while the admin
 * area is open, because dialogs and toasts render in a portal outside that
 * wrapper. The theme that was there (the workspace's) comes back on leaving.
 */
export function AdminTheme() {
  useLayoutEffect(() => {
    const previous = getTheme();
    setTheme("daylight");
    return () => setTheme(previous);
  }, []);
  return null;
}
