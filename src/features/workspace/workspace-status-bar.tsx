"use client";

import type { ReactNode } from "react";

import { StatusBarItem } from "@/components/ui/status-bar-item";
import type { Calibration } from "@/core/calibration/calibration";
import type { PageGeometry } from "@/core/render/view";
import { SaveIndicator } from "@/features/markup-set/save-indicator";
import { CursorReadout, PageSizeItem, ScaleIndicator, SnapToggles, ZoomItem, type ScaleState } from "@/features/viewer";

export interface WorkspaceStatusBarProps {
  fileName?: string | null;
  zoom?: number | null;
  /** The PagePager (Story 3.3); renders nothing without a drawing. */
  pager?: ReactNode;
  /** Polite announcement, e.g. "Page 3 of 12, A1721" (Story 3.3 AC 6). */
  announcement?: string;
  /** The shown page (points, /Rotate applied; its box and UserUnit for the cursor readout) (Story 3.7). */
  page?: PageGeometry | null;
  /** The shown page's scale (Story 3.7; detected 4.2, calibrated 4.3). */
  scale?: ScaleState | null;
  /** Story 4.3: the shown page's calibration (the cursor reads in real units) and the ScaleIndicator's action. */
  calibration?: Calibration | null;
  onCalibrate?: () => void;
}

/**
 * 24 px status bar in a fixed order (UX-DR7, Story 3.7 AC 1): file name · page
 * pager · page size · scale · snap toggles · cursor X/Y · zoom · save state
 * (Story 6.3's SaveIndicator). Until a drawing is open only
 * the empty item shows. The file name truncates first; below 1440 px the page
 * size shows as an icon with its size in the tooltip, so the bar fits 1280 px
 * on one line. Page changes are announced through a visually hidden polite
 * live region (the interactive items are not inside it); the cursor and zoom
 * are never announced (AC 7).
 */
export function WorkspaceStatusBar({
  fileName = null,
  zoom = null,
  pager = null,
  announcement = "",
  page = null,
  scale = null,
  calibration = null,
  onCalibrate,
}: WorkspaceStatusBarProps) {
  const open = fileName !== null;
  return (
    <div className="flex h-6 min-w-0 items-center gap-1 overflow-hidden px-1" data-testid="status-bar">
      <StatusBarItem
        label={fileName ?? "No drawing open"}
        tooltip={fileName ?? undefined}
        data-testid="status-file"
        className="min-w-0 shrink"
      />
      {open ? (
        <div className="flex shrink-0 items-center gap-1">
          {pager}
          {page ? <PageSizeItem page={page} /> : null}
          {scale ? <ScaleIndicator state={scale} onCalibrate={onCalibrate} /> : null}
          <SnapToggles />
          <CursorReadout page={page} calibration={calibration} />
          {zoom !== null ? <ZoomItem zoom={zoom} /> : null}
          {/* Story 6.3: the SaveIndicator. */}
          <SaveIndicator />
        </div>
      ) : null}
      <span role="status" aria-live="polite" data-testid="status-announcement" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
