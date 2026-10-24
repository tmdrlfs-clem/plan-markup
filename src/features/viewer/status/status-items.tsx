"use client";

// The status bar's page facts (Story 3.7, FR22, UX-DR7, UX-DR9): page size,
// ScaleIndicator, snap toggles, cursor X/Y and the zoom readout with its menu.
// Story 1.7 parts only (StatusBarItem, ToggleButton, Menu).

import { Grid3x3, Magnet, PenTool, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { StatusBarItem } from "@/components/ui/status-bar-item";
import { ToggleButton } from "@/components/ui/toggle-button";
import { sheetSize } from "@/core/pdf/page-size";
import { fromPageCorner, type PageGeometry } from "@/core/render/view";
import { DEFAULT_LENGTH_UNIT, formatCursor } from "@/core/units/format";
import type { Calibration } from "@/core/calibration/calibration";
import { formatCursorReal } from "@/core/calibration/units";

import { viewerCommands } from "../viewer-commands";
import { cursorStore } from "./cursor-store";
import type { ScaleState } from "./scale-state";
import { SNAP_KINDS, setSnap, snapSettings, type SnapKind } from "./snap-settings";

// ---- page size --------------------------------------------------------------------

/**
 * The shown page's paper size (AC 2): "A1 841 × 594 mm" from 1440 px wide;
 * narrower, only the sheet's orientation icon, the size in its tooltip.
 */
export function PageSizeItem({ page }: { page: { width: number; height: number } }) {
  const size = sheetSize(page.width, page.height, DEFAULT_LENGTH_UNIT);
  const dimensions = size.name ? size.label.slice(size.name.length + 1) : size.label;
  const tooltip = `Page size: ${size.name ? `${size.name}, ` : ""}${size.orientation}, ${dimensions}`;
  const icon = size.orientation === "portrait" ? RectangleVertical : RectangleHorizontal;
  return (
    <>
      <span className="hidden ws-md:contents">
        <StatusBarItem label={size.label} icon={icon} tooltip={tooltip} data-testid="status-page-size" />
      </span>
      <span className="contents ws-md:hidden">
        {/* Focusable, so keyboard users reach the size in its tooltip (review R3), like the pager's sheet label. */}
        <StatusBarItem
          label={size.label}
          icon={icon}
          iconOnly
          tooltip={tooltip}
          tabIndex={0}
          className="rounded-sm focus-ring"
          data-testid="status-page-size-icon"
        />
      </span>
    </>
  );
}

// ---- scale ---------------------------------------------------------------------------

/** What each scale state shows (UX-DR9): warning colour and icon until the scale is set. */
export function scaleItem(state: ScaleState): { label: string; tone: "warning" | "success"; tooltip: string } {
  switch (state.kind) {
    case "set":
      return { label: state.label, tone: "success", tooltip: `${state.tooltip ?? "The page is calibrated"}. Click to calibrate again` };
    case "detected":
      return {
        label: `Scale ${state.label} detected — Verify`,
        tone: "warning",
        tooltip: `${state.note ? `${state.note}. ` : ""}Read from the drawing; click to confirm it in Calibrate before measuring`,
      };
    case "conflict":
      return {
        label: "Scales disagree — Verify",
        tone: "warning",
        tooltip: `Printed scales disagree: ${state.readings.join("; ")}. Click to choose one in Calibrate`,
      };
    case "mixed":
      return {
        label: `${state.count} scales on page`,
        tone: "warning",
        tooltip: `Viewports on this page use different scales${state.list?.length ? `: ${state.list.join("; ")}` : ""}. Click to calibrate the page`,
      };
    default:
      return { label: "Scale not set", tone: "warning", tooltip: "Click to calibrate this page" };
  }
}

/**
 * The ScaleIndicator (AC 3). Story 4.3: with `onCalibrate` it is a button that
 * opens the Calibrate dialog (founder decision 2026-10-24: a detected scale is
 * only ever applied there). Without it (tests, no drawing) a plain item.
 */
export function ScaleIndicator({ state, onCalibrate }: { state: ScaleState; onCalibrate?: () => void }) {
  const { label, tone, tooltip } = scaleItem(state);
  // Story 4.2: a detected scale's tooltip carries information (the conversion, the list): reachable by keyboard.
  const informative = state.kind === "detected" || state.kind === "mixed" || state.kind === "conflict";
  return (
    <StatusBarItem
      label={label}
      tone={tone}
      tooltip={tooltip}
      data-testid="status-scale"
      data-scale={state.kind}
      // 4.2 review D7: whether the page's printed scales have been read (e2e waits for "done").
      data-detection={state.kind === "not-set" && state.pending ? "pending" : "done"}
      onClick={onCalibrate}
      tabIndex={informative && !onCalibrate ? 0 : undefined}
      className={informative && !onCalibrate ? "rounded-sm focus-ring" : undefined}
    />
  );
}

// ---- snap toggles ----------------------------------------------------------------------

const SNAP: Record<SnapKind, { label: string; icon: typeof Magnet; tooltip: string }> = {
  content: {
    label: "Snap to content",
    icon: Magnet,
    tooltip: "Snap to content: drawing and measuring tools will snap to the drawing's lines and points",
  },
  markup: {
    label: "Snap to markups",
    icon: PenTool,
    tooltip: "Snap to markups: drawing and measuring tools will snap to markup points and edges",
  },
  grid: {
    label: "Snap to grid",
    icon: Grid3x3,
    tooltip: "Snap to grid: drawing and measuring tools will snap to the grid",
  },
};

/** Content / markup / grid snap (AC 4). They only set the remembered preference; Story 4.1 snaps. */
export function SnapToggles() {
  const settings = useStore(snapSettings);
  return (
    <div role="group" aria-label="Snap" className="flex items-center" data-testid="status-snap">
      {SNAP_KINDS.map((kind) => (
        <ToggleButton
          key={kind}
          size="xs"
          label={SNAP[kind].label}
          icon={SNAP[kind].icon}
          tooltip={SNAP[kind].tooltip}
          pressed={settings[kind]}
          onPressedChange={(on) => setSnap(kind, on)}
        />
      ))}
    </div>
  );
}

// ---- cursor ------------------------------------------------------------------------------

/**
 * Cursor X/Y (AC 5): the store's PDF user space point shown in points from the
 * shown page's bottom-left corner (its box and UserUnit, review R1). The text
 * node is written straight from the cursor store (no React render per pointer
 * move) and never announced (aria-live off, AC 7). A minimum width keeps the
 * bar from shifting; a longer readout grows instead of overflowing (review R4).
 */
export function CursorReadout({ page = null, calibration = null }: { page?: PageGeometry | null; calibration?: Calibration | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = (point: { x: number; y: number } | null) => {
      const el = ref.current;
      const at = point && page ? fromPageCorner(page, point) : null;
      // Story 4.3: a calibrated page reads in its real units and precision.
      const text = calibration ? formatCursorReal(at, calibration) : formatCursor(at);
      if (el && el.textContent !== text) el.textContent = text;
    };
    write(cursorStore.getState().point);
    return cursorStore.subscribe((s) => write(s.point));
  }, [page, calibration]);
  return (
    <span
      aria-live="off"
      data-testid="status-cursor"
      className="num inline-flex h-6 min-w-[22ch] shrink-0 items-center whitespace-pre px-2 text-ws-xs text-text"
    >
      {/* A generic span cannot be named with aria-label (review R5): a hidden prefix instead. */}
      <span className="sr-only">Cursor position </span>
      <span ref={ref} data-testid="status-cursor-value" />
    </span>
  );
}

// ---- zoom --------------------------------------------------------------------------------

export const ZOOM_PRESETS = [50, 100, 200, 400] as const;

/** The zoom readout (AC 6, Revu-style: 100 % = actual size); a menu of fits and presets. */
export function ZoomItem({ zoom }: { zoom: number }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <StatusBarItem label={`${zoom}%`} asButton tooltip="Zoom (100 % = actual size)" data-testid="status-zoom" aria-label={`Zoom ${zoom}%`} />
      </MenuTrigger>
      <MenuContent side="top" align="end">
        <MenuItem shortcut="Ctrl+9" onSelect={() => viewerCommands.fitPage()}>
          Fit page
        </MenuItem>
        <MenuItem shortcut="Ctrl+0" onSelect={() => viewerCommands.fitWidth()}>
          Fit width
        </MenuItem>
        <MenuSeparator />
        {ZOOM_PRESETS.map((percent) => (
          <MenuItem key={percent} onSelect={() => viewerCommands.zoomTo(percent)}>
            {`${percent}%`}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
