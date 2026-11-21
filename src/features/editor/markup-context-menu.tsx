"use client";

// The markups' context menu (Story 5.3, FR33): a right-click on the canvas with
// Select (select-tool openMarkupMenu sets tools.menu) opens it where the click
// was, for the selection on that page: Copy, Paste, Delete; Group, Ungroup;
// Arrange and Align; Lock / Unlock; Select all. Items that cannot act are
// disabled. Closing it puts the focus back on the canvas. The Edit menu uses
// the same availability (useSelectionState). Story 7.2: Add to Tool Chest…
// makes the selection a tool (the Tool Chest's dialog asks where).

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  BringToFront,
  ClipboardPaste,
  Copy,
  Scissors,
  Group,
  Lock,
  LockOpen,
  PackagePlus,
  SendToBack,
  SquareDashedMousePointer,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useStore } from "zustand";

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from "@/components/ui/menu";
import { pageIdOf } from "@/core/calibration/calibration";
import { unitsOf, type AlignTo, type OrderStep } from "@/core/markup/arrange";
import type { Markup } from "@/core/schema/markup";
import { canBeTool } from "@/core/tools/tool";
import { requestAddTool } from "@/features/tool-chest/add-tool-store";
import { viewerCommands, viewerStore, type SelectionKey } from "@/features/viewer";

import { editorStore, isLocked, markupsOf, setMarkupMenu } from "./editor-store";
import { hasClipboard, ORDER_LABEL, selectionKey } from "./select-tool";

/** What the selection on a page allows (the context menu and the Edit menu). */
export type SelectionState = {
  selected: number;
  /** Markups not locked among them. */
  editable: number;
  /** Units (a group counts once). */
  units: number;
  /** Some are grouped. */
  grouped: boolean;
  locked: number;
  /** The page has markups (Select all). */
  any: boolean;
};

/** The selection `ids` on page `pageIndex` of the document with `markups`. */
export function selectionStateOf(ids: readonly string[], markups: readonly Markup[], documentId: string | null, pageIndex: number): SelectionState {
  const wanted = new Set(ids);
  const pageId = documentId ? pageIdOf(documentId, pageIndex) : "";
  const page = markups.filter((m) => m.pageId === pageId);
  const selected = page.filter((m) => wanted.has(m.id));
  const locked = selected.filter((m) => isLocked(m)).length;
  return {
    selected: selected.length,
    editable: selected.length - locked,
    units: unitsOf(selected).length,
    grouped: selected.some((m) => m.groupId),
    locked,
    any: page.length > 0,
  };
}

/** The selection's state on a page, for React. */
export function useSelectionState(documentId: string | null, pageIndex: number): SelectionState {
  const ids = useStore(editorStore, (s) => s.selection.ids);
  const markups = useStore(editorStore, (s) => markupsOf(s, documentId));
  // Story 5.12: a layer locked or unlocked changes what may change.
  useStore(editorStore, (s) => (documentId ? s.doc.layers[documentId] : undefined));
  return selectionStateOf(ids, markups, documentId, pageIndex);
}

/** Story 7.2: asks the Tool Chest to make the selection on a page a tool. */
export function addSelectionToToolChest(documentId: string, pageIndex: number, userUnit: number): boolean {
  const state = editorStore.getState();
  const wanted = new Set(state.selection.ids);
  const pageId = pageIdOf(documentId, pageIndex);
  const markups = markupsOf(state, documentId).filter((m) => m.pageId === pageId && wanted.has(m.id) && canBeTool(m));
  if (markups.length === 0) return false;
  const calibration = viewerStore.getState().calibrations[pageId] ?? null;
  requestAddTool({ markups, calibration, userUnit });
  return true;
}

const ARRANGE: readonly { step: OrderStep; shortcut: string; icon: typeof BringToFront }[] = [
  { step: "front", shortcut: "Ctrl+Shift+]", icon: BringToFront },
  { step: "forward", shortcut: "Ctrl+]", icon: ArrowUp },
  { step: "backward", shortcut: "Ctrl+[", icon: ArrowDown },
  { step: "back", shortcut: "Ctrl+Shift+[", icon: SendToBack },
];

const ALIGN: readonly { to: AlignTo; label: string; icon: typeof BringToFront }[] = [
  { to: "left", label: "Align left", icon: AlignStartVertical },
  { to: "centre", label: "Align centre", icon: AlignCenterVertical },
  { to: "right", label: "Align right", icon: AlignEndVertical },
  { to: "top", label: "Align top", icon: AlignStartHorizontal },
  { to: "middle", label: "Align middle", icon: AlignCenterHorizontal },
  { to: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

export function MarkupContextMenu() {
  const menu = useStore(editorStore, (s) => s.tools.menu);
  const s = useSelectionState(menu?.documentId ?? null, menu?.pageIndex ?? 0);
  if (!menu) return null;
  const at = { documentId: menu.documentId, pageIndex: menu.pageIndex, view: menu.view };
  const run = (key: SelectionKey) => () => void selectionKey(key, at);

  return (
    <Menu open onOpenChange={(open) => (open ? undefined : setMarkupMenu(null))}>
      <MenuTrigger asChild>
        {/* The menu takes its name from its trigger (aria-labelledby). */}
        <span aria-label="Markup" data-testid="markup-menu-anchor" style={{ position: "fixed", left: menu.client.x, top: menu.client.y, width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuContent
        align="start"
        sideOffset={0}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          viewerCommands.focusCanvas();
        }}
      >
        <MenuItem
          icon={Scissors}
          shortcut="Ctrl+X"
          disabled={s.editable === 0}
          onSelect={() => {
            if (selectionKey({ kind: "copy" }, at)) selectionKey({ kind: "delete" }, at);
          }}
        >
          Cut
        </MenuItem>
        <MenuItem icon={Copy} shortcut="Ctrl+C" disabled={s.selected === 0} onSelect={run({ kind: "copy" })}>
          Copy
        </MenuItem>
        <MenuItem icon={ClipboardPaste} shortcut="Ctrl+V" disabled={!hasClipboard()} onSelect={run({ kind: "paste", inPlace: false, at: menu.point })}>
          Paste
        </MenuItem>
        <MenuItem icon={Trash2} shortcut="Del" disabled={s.editable === 0} onSelect={run({ kind: "delete" })}>
          Delete
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Group} shortcut="Ctrl+G" disabled={s.units < 2} onSelect={run({ kind: "group" })}>
          Group
        </MenuItem>
        <MenuItem icon={Ungroup} shortcut="Ctrl+Shift+G" disabled={!s.grouped} onSelect={run({ kind: "ungroup" })}>
          Ungroup
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger disabled={s.selected === 0}>Arrange</MenuSubTrigger>
          <MenuSubContent>
            {ARRANGE.map((a) => (
              <MenuItem key={a.step} icon={a.icon} shortcut={a.shortcut} onSelect={run({ kind: "order", step: a.step })}>
                {ORDER_LABEL[a.step]}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger disabled={s.units < 2}>Align</MenuSubTrigger>
          <MenuSubContent>
            {ALIGN.map((a) => (
              <MenuItem key={a.to} icon={a.icon} onSelect={run({ kind: "align", to: a.to })}>
                {a.label}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        {s.locked > 0 ? (
          <MenuItem icon={LockOpen} onSelect={run({ kind: "lock", locked: false })}>
            Unlock
          </MenuItem>
        ) : (
          <MenuItem icon={Lock} disabled={s.selected === 0} onSelect={run({ kind: "lock", locked: true })}>
            Lock
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={PackagePlus} disabled={s.selected === 0} onSelect={() => void addSelectionToToolChest(menu.documentId, menu.pageIndex, menu.view.userUnit)}>
          Add to Tool Chest…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={SquareDashedMousePointer} shortcut="Ctrl+A" disabled={!s.any} onSelect={run({ kind: "all" })}>
          Select all
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
