"use client";

import { Info, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { IconButton } from "@/components/ui/icon-button";

const QUERY = "(max-width: 1279.98px)";
export const BANNER_DISMISSED_KEY = "pm.workspace.narrowBannerDismissed";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isNarrow(): boolean {
  return window.matchMedia(QUERY).matches;
}

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Below 1280 px: a dismissible notice above the menu bar (UX-DR37). Hidden for the session once dismissed. */
export function NarrowBanner() {
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false);
  const storedDismissed = useSyncExternalStore(
    () => () => {},
    readDismissed,
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (!narrow || storedDismissed || dismissedNow) return null;

  function dismiss() {
    setDismissedNow(true);
    try {
      window.sessionStorage.setItem(BANNER_DISMISSED_KEY, "1");
    } catch {
      // Without storage it only stays hidden until the next load.
    }
  }

  return (
    <div
      role="region"
      aria-label="Screen size notice"
      className="flex h-8 items-center gap-2 border-b border-border bg-surface-2 pl-3 pr-1 text-ws-md text-text"
    >
      <Info size={16} aria-hidden="true" className="shrink-0 text-info" />
      <p className="min-w-0 flex-1 truncate">Plan Markup is designed for screens 1280 px or wider</p>
      <IconButton label="Dismiss notice" icon={X} onClick={dismiss} />
    </div>
  );
}
