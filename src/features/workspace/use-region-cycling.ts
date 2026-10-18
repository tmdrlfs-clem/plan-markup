"use client";

import { useEffect } from "react";

/** Order is DOM order of `[data-region]` elements; hidden or unmounted regions are skipped. */
const REGION = "[data-region]";

const TABBABLE =
  "button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([type='hidden']):not([tabindex='-1']), " +
  "select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** While one of these has focus, F6 belongs to it (menus, popovers, dialogs). */
const OVERLAY = "[role='menu'], [role='dialog'], [role='alertdialog'], [role='listbox']";

function visibleRegions(root: Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(REGION)).filter(
    (region) => !region.hidden && !region.closest("[hidden]"),
  );
}

function focusRegion(region: HTMLElement) {
  const target = Array.from(region.querySelectorAll<HTMLElement>(TABBABLE)).find(
    (element) => !element.closest("[hidden]"),
  );
  (target ?? region).focus();
}

/** Moves focus to the next (F6) or previous (Shift+F6) region, wrapping around. */
export function cycleRegion(root: Document, direction: 1 | -1): void {
  const regions = visibleRegions(root);
  if (regions.length === 0) return;
  const active = root.activeElement;
  const current = regions.findIndex((region) => region.contains(active));
  const next =
    current === -1
      ? direction === 1
        ? 0
        : regions.length - 1
      : (current + direction + regions.length) % regions.length;
  focusRegion(regions[next]);
}

export function useRegionCycling(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "F6" || event.ctrlKey || event.altKey || event.metaKey) return;
      const active = document.activeElement;
      if (active instanceof Element && active.closest(OVERLAY)) return;
      // F6 is also the browser's address-bar key.
      event.preventDefault();
      cycleRegion(document, event.shiftKey ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
