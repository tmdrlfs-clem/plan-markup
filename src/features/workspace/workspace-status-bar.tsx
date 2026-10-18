"use client";

import { StatusBarItem } from "@/components/ui/status-bar-item";

/**
 * 24 px status bar. Fixed order once filled (UX-DR7): page pager · scale · snap toggles ·
 * cursor X/Y · zoom · save state. Until a drawing is open only the empty item shows.
 */
export function WorkspaceStatusBar() {
  return (
    <div role="status" aria-live="polite" className="flex h-6 items-center gap-1 px-1">
      <StatusBarItem label="No drawing open" />
    </div>
  );
}
