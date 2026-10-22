"use client";

import { StatusBarItem } from "@/components/ui/status-bar-item";

/**
 * 24 px status bar. Fixed order once filled (UX-DR7): file name · page pager · scale ·
 * snap toggles · cursor X/Y · zoom · save state. Until a drawing is open only the empty
 * item shows; the other items arrive with their stories (3.3, 3.7, 4.x).
 */
export function WorkspaceStatusBar({ fileName = null }: { fileName?: string | null }) {
  return (
    <div role="status" aria-live="polite" className="flex h-6 items-center gap-1 px-1">
      <StatusBarItem label={fileName ?? "No drawing open"} tooltip={fileName ?? undefined} />
    </div>
  );
}
