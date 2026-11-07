"use client";

import {
  FolderOpen,
  Maximize,
  MoveHorizontal,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { useStore } from "zustand";

import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";
import { openPrint } from "@/features/export";
import { hasDocument, viewerCommands, viewerStore, type ViewerCommand } from "@/features/viewer";

export const NO_DRAWING = "Open a drawing first";

function Needs({ label, icon, shortcut }: { label: string; icon: LucideIcon; shortcut?: string }) {
  return <ToolbarButton label={label} icon={icon} shortcut={shortcut} disabled disabledReason={NO_DRAWING} />;
}

/** A view command: enabled while a drawing is shown. */
function ViewButton({ label, icon, shortcut, command }: { label: string; icon: LucideIcon; shortcut?: string; command: ViewerCommand }) {
  const open = useStore(viewerStore, hasDocument);
  if (!open) return <Needs label={label} icon={icon} shortcut={shortcut} />;
  return <ToolbarButton label={label} icon={icon} shortcut={shortcut} onClick={() => viewerCommands[command]()} />;
}

/** Story 8.3: Print… opens the print dialog while a drawing is shown. */
function PrintButton() {
  const open = useStore(viewerStore, hasDocument);
  if (!open) return <Needs label="Print…" icon={Printer} shortcut="Ctrl+P" />;
  return <ToolbarButton label="Print…" icon={Printer} shortcut="Ctrl+P" onClick={openPrint} />;
}

/** Row 1: document and view commands. Row 2: options of the active tool. */
export function WorkspaceToolbar({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <Toolbar aria-label="Document" className="border-b border-border">
        <ToolbarButton label="Open…" icon={FolderOpen} shortcut="Ctrl+O" onClick={onOpen} />
        <Needs label="Save" icon={Save} shortcut="Ctrl+S" />
        <PrintButton />
        <ToolbarSeparator />
        <Needs label="Undo" icon={Undo2} shortcut="Ctrl+Z" />
        <Needs label="Redo" icon={Redo2} shortcut="Ctrl+Y" />
        <ToolbarSeparator />
        <ViewButton label="Zoom out" icon={ZoomOut} shortcut="-" command="zoomOut" />
        <ViewButton label="Zoom in" icon={ZoomIn} shortcut="+" command="zoomIn" />
        <ViewButton label="Fit page" icon={Maximize} shortcut="Ctrl+9" command="fitPage" />
        <ViewButton label="Fit width" icon={MoveHorizontal} shortcut="Ctrl+0" command="fitWidth" />
        <ViewButton label="Rotate view counter-clockwise" icon={RotateCcw} command="rotateCounterClockwise" />
        <ViewButton label="Rotate view clockwise" icon={RotateCw} command="rotateClockwise" />
      </Toolbar>
      <div
        data-testid="tool-options"
        className="flex h-9 items-center border-b border-border bg-surface-2 px-3 text-ws-sm text-muted"
      >
        Select a tool to see its options
      </div>
    </>
  );
}
