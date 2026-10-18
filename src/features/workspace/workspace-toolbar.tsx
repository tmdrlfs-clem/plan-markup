"use client";

import {
  FolderOpen,
  Maximize,
  MoveHorizontal,
  Printer,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

export const NO_DRAWING = "Open a drawing first";

function Needs({ label, icon, shortcut }: { label: string; icon: LucideIcon; shortcut?: string }) {
  return <ToolbarButton label={label} icon={icon} shortcut={shortcut} disabled disabledReason={NO_DRAWING} />;
}

/** Row 1: document and view commands. Row 2: options of the active tool. */
export function WorkspaceToolbar({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <Toolbar aria-label="Document" className="border-b border-border">
        <ToolbarButton label="Open…" icon={FolderOpen} shortcut="Ctrl+O" onClick={onOpen} />
        <Needs label="Save" icon={Save} shortcut="Ctrl+S" />
        <Needs label="Print…" icon={Printer} shortcut="Ctrl+P" />
        <ToolbarSeparator />
        <Needs label="Undo" icon={Undo2} shortcut="Ctrl+Z" />
        <Needs label="Redo" icon={Redo2} shortcut="Ctrl+Y" />
        <ToolbarSeparator />
        <Needs label="Zoom out" icon={ZoomOut} shortcut="-" />
        <Needs label="Zoom in" icon={ZoomIn} shortcut="+" />
        <Needs label="Fit page" icon={Maximize} shortcut="Ctrl+9" />
        <Needs label="Fit width" icon={MoveHorizontal} shortcut="Ctrl+0" />
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
