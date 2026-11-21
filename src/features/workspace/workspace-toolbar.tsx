"use client";

import { Toolbar as ToolbarPrimitive } from "radix-ui";
import {
  ClipboardPaste,
  Copy,
  FileSpreadsheet,
  FilePlus,
  FolderOpen,
  Paintbrush,
  Maximize,
  MoveHorizontal,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { useStore } from "zustand";

import { ToggleButton } from "@/components/ui/toggle-button";
import { openNewDocument } from "./new-document-dialog";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";
import { TextFormatBar, downloadMarkupSummary, copyFormat, dropFormat, formatPainter, markupsOf, activeUndoLabels, editorStore, hasClipboard, redoActive, undoActive, useSelectionState } from "@/features/editor";
import { openPrint } from "@/features/export";
import { saveNow } from "@/features/markup-set/sync";
import { hasDocument, viewerCommands, viewerStore, type SelectionCommand, type ViewerCommand } from "@/features/viewer";

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

/** Undo / Redo: the active drawing's next step, named in the tooltip. */
function UndoButtons() {
  const tabId = useStore(viewerStore, (s) => s.tabId);
  const open = useStore(viewerStore, hasDocument);
  const undo = useStore(editorStore, (s) => activeUndoLabels(s, tabId).undo);
  const redo = useStore(editorStore, (s) => activeUndoLabels(s, tabId).redo);
  if (!open) {
    return (
      <>
        <Needs label="Undo" icon={Undo2} shortcut="Ctrl+Z" />
        <Needs label="Redo" icon={Redo2} shortcut="Ctrl+Y" />
      </>
    );
  }
  return (
    <>
      <ToolbarButton
        label={undo ? `Undo ${undo}` : "Undo"}
        icon={Undo2}
        shortcut="Ctrl+Z"
        disabled={!undo}
        disabledReason="Nothing to undo"
        onClick={() => {
          undoActive();
          viewerCommands.focusCanvas();
        }}
      />
      <ToolbarButton
        label={redo ? `Redo ${redo}` : "Redo"}
        icon={Redo2}
        shortcut="Ctrl+Y"
        disabled={!redo}
        disabledReason="Nothing to redo"
        onClick={() => {
          redoActive();
          viewerCommands.focusCanvas();
        }}
      />
    </>
  );
}

/** Cut, Copy, Paste, Delete: the shown page's selection (as Edit and the markup menu). */
function ClipboardButtons() {
  const documentId = useStore(viewerStore, (s) => (hasDocument(s) ? s.documentId : null));
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const s = useSelectionState(documentId, pageIndex);
  const button = (label: string, icon: LucideIcon, shortcut: string, command: SelectionCommand, enabled: boolean, reason: string) =>
    !documentId ? (
      <Needs label={label} icon={icon} shortcut={shortcut} />
    ) : (
      <ToolbarButton
        label={label}
        icon={icon}
        shortcut={shortcut}
        disabled={!enabled}
        disabledReason={reason}
        onClick={() => {
          viewerCommands.selection(command);
          viewerCommands.focusCanvas();
        }}
      />
    );
  return (
    <>
      {button("Cut", Scissors, "Ctrl+X", "cut", s.editable > 0, "Select a markup first")}
      {button("Copy", Copy, "Ctrl+C", "copy", s.selected > 0, "Select a markup first")}
      {button("Paste", ClipboardPaste, "Ctrl+V", "paste", hasClipboard(), "Copy a markup first")}
      {button("Delete", Trash2, "Del", "delete", s.editable > 0, "Select a markup first")}
    </>
  );
}

/** Row 2: the text format bar while a drawing is open. */
function ToolOptions() {
  const open = useStore(viewerStore, hasDocument);
  if (open) return <TextFormatBar />;
  return (
    <div data-testid="tool-options" className="flex h-9 items-center border-b border-border bg-surface-2 px-3 text-ws-sm text-muted">
      Select a tool to see its options
    </div>
  );
}

/** The format painter (as Properties' Copy format): one markup's format, applied by the next click on a markup. */
function FormatPainterButton() {
  const documentId = useStore(viewerStore, (s) => (hasDocument(s) ? s.documentId : null));
  const painting = useStore(formatPainter, (s) => s.format !== null);
  const source = useStore(editorStore, (s) => {
    const ids = s.selection.ids;
    if (!documentId || ids.length === 0) return null;
    const chosen = new Set(ids);
    const selected = markupsOf(s, documentId).filter((m) => chosen.has(m.id));
    // One markup, or one group's (its first member).
    return selected.length === 1 || (selected.length > 0 && selected.every((m) => m.groupId && m.groupId === selected[0].groupId)) ? selected[0] : null;
  });
  if (!documentId) return <Needs label="Format painter" icon={Paintbrush} />;
  // A toolbar item: the toolbar's arrows reach it (one tab stop for the toolbar).
  return (
    <ToolbarPrimitive.Button asChild>
      <ToggleButton
        label="Format painter"
        tooltip={painting ? "Click a markup to apply the format (Esc cancels)" : "Copy the selected markup's format, then click a markup to apply it"}
        icon={Paintbrush}
        pressed={painting}
        disabled={!source && !painting}
        disabledReason="Select one markup first"
        onPressedChange={() => {
          if (painting) dropFormat();
          else if (source) copyFormat(source);
          viewerCommands.focusCanvas();
        }}
      />
    </ToolbarPrimitive.Button>
  );
}

/** Summary: the drawing's markups, as the Markups list shows them, downloaded as a CSV file. */
function SummaryButton({ author }: { author: string }) {
  const open = useStore(viewerStore, hasDocument);
  if (!open) return <Needs label="Markup summary (CSV)" icon={FileSpreadsheet} />;
  return <ToolbarButton label="Markup summary (CSV)" icon={FileSpreadsheet} onClick={() => downloadMarkupSummary(author)} />;
}

/** Row 1: document and view commands. Row 2: options of the active tool. */
export function WorkspaceToolbar({ onOpen, author = "" }: { onOpen: () => void; author?: string }) {
  return (
    <>
      <Toolbar aria-label="Document" className="border-b border-border">
        <ToolbarButton label="New…" icon={FilePlus} onClick={openNewDocument} />
        <ToolbarButton label="Open…" icon={FolderOpen} shortcut="Ctrl+O" onClick={onOpen} />
        {/* Story 6.3: saving is automatic; Save sends what waits now. */}
        <ToolbarButton label="Save" icon={Save} shortcut="Ctrl+S" onClick={() => saveNow()} />
        <PrintButton />
        <ToolbarSeparator />
        <UndoButtons />
        <ToolbarSeparator />
        <ClipboardButtons />
        <FormatPainterButton />
        <ToolbarSeparator />
        <SummaryButton author={author} />
        <ToolbarSeparator />
        <ViewButton label="Zoom out" icon={ZoomOut} shortcut="-" command="zoomOut" />
        <ViewButton label="Zoom in" icon={ZoomIn} shortcut="+" command="zoomIn" />
        <ViewButton label="Fit page" icon={Maximize} shortcut="Ctrl+9" command="fitPage" />
        <ViewButton label="Fit width" icon={MoveHorizontal} shortcut="Ctrl+0" command="fitWidth" />
        <ViewButton label="Rotate view counter-clockwise" icon={RotateCcw} command="rotateCounterClockwise" />
        <ViewButton label="Rotate view clockwise" icon={RotateCw} command="rotateClockwise" />
      </Toolbar>
      <ToolOptions />
    </>
  );
}
