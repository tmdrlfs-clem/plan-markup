"use client";

import type { ReactNode } from "react";

import { StatusBarItem } from "@/components/ui/status-bar-item";

export interface WorkspaceStatusBarProps {
  fileName?: string | null;
  zoom?: number | null;
  /** The PagePager (Story 3.3); renders nothing without a drawing. */
  pager?: ReactNode;
  /** Polite announcement, e.g. "Page 3 of 12, A1721" (Story 3.3 AC 6). */
  announcement?: string;
}

/**
 * 24 px status bar. Fixed order once filled (UX-DR7): file name · page pager · scale ·
 * snap toggles · cursor X/Y · zoom · save state. Until a drawing is open only the empty
 * item shows; the other items arrive with their stories (3.7, 4.x). Page changes are
 * announced through a visually hidden polite live region, so the interactive pager is
 * not itself inside a live region.
 */
export function WorkspaceStatusBar({ fileName = null, zoom = null, pager = null, announcement = "" }: WorkspaceStatusBarProps) {
  return (
    <div className="flex h-6 items-center gap-1 px-1">
      <StatusBarItem label={fileName ?? "No drawing open"} tooltip={fileName ?? undefined} />
      {fileName !== null ? pager : null}
      {fileName !== null && zoom !== null ? <StatusBarItem label={zoom + "%"} tooltip="Zoom (100 % = actual size)" /> : null}
      <span role="status" aria-live="polite" data-testid="status-announcement" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
