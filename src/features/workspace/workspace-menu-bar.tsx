"use client";

import { FolderOpen, LogOut, Palette } from "lucide-react";
import { useStore } from "zustand";

import {
  MenuBar,
  MenuBarCheckboxItem,
  MenuBarContent,
  MenuBarItem,
  MenuBarMenu,
  MenuBarRadioGroup,
  MenuBarRadioItem,
  MenuBarSeparator,
  MenuBarSub,
  MenuBarSubContent,
  MenuBarSubTrigger,
  MenuBarTrigger,
} from "@/components/ui/menu-bar";
import { TAB_SHORTCUTS } from "@/core/documents/tabs";
import { calibrationOf, openCalibrate, openVerify } from "@/features/calibration";
import { activeUndoLabels, hasClipboard, redoActive, undoActive, editorStore, useSelectionState } from "@/features/editor";
import { hasDocument, tabsStore, viewerCommands, viewerStore, viewerTabs, type SelectionCommand, type ViewerCommand } from "@/features/viewer";
import { THEMES, THEME_LABELS, isTheme, type Theme } from "@/lib/theme";

import { useLayout } from "./layout-context";
import { LEFT_PANELS, MARKUPS_LIST } from "./panel-registry";

export interface WorkspaceMenuBarProps {
  onOpen: () => void;
  onSignOut: () => void;
  /** The workspace theme (Story 3.8): Settings > Appearance shows it checked and changes it. */
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
}

/** Commands that exist in the menus but need a drawing (or a later story) first. */
function Disabled({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <MenuBarItem disabled shortcut={shortcut}>
      {label}
    </MenuBarItem>
  );
}

/** A view command: enabled while a drawing is shown. */
function ViewItem({ label, shortcut, command }: { label: string; shortcut?: string; command: ViewerCommand }) {
  const open = useStore(viewerStore, hasDocument);
  return (
    <MenuBarItem disabled={!open} shortcut={shortcut} onSelect={() => viewerCommands[command]()}>
      {label}
    </MenuBarItem>
  );
}

/** Document tab commands (Story 3.5): the menu names the keys (Alt first; Chrome keeps the Ctrl ones). */
function TabItem({ label, shortcut, run, minTabs }: { label: string; shortcut: string; run: () => void; minTabs: number }) {
  const count = useStore(tabsStore, (s) => s.tabs.length);
  return (
    <MenuBarItem disabled={count < minTabs} shortcut={shortcut} onSelect={run}>
      {label}
    </MenuBarItem>
  );
}

/** Panel toggles shared by View and Window (Revu keeps them under Window). */
function PanelItems() {
  const left = useLayout((s) => s.left);
  const bottomCollapsed = useLayout((s) => s.bottom.collapsed);
  const showLeftPanel = useLayout((s) => s.showLeftPanel);
  const setBottomCollapsed = useLayout((s) => s.setBottomCollapsed);
  const hideAllPanels = useLayout((s) => s.hideAllPanels);

  return (
    <>
      {LEFT_PANELS.map((panel) => (
        <MenuBarCheckboxItem
          key={panel.id}
          shortcut={panel.shortcut}
          checked={!left.collapsed && left.active === panel.id}
          onCheckedChange={() => showLeftPanel(panel.id)}
        >
          {panel.title}
        </MenuBarCheckboxItem>
      ))}
      <MenuBarCheckboxItem
        shortcut={MARKUPS_LIST.shortcut}
        checked={!bottomCollapsed}
        onCheckedChange={(checked) => setBottomCollapsed(!checked)}
      >
        Markups list
      </MenuBarCheckboxItem>
      <MenuBarSeparator />
      <MenuBarItem shortcut="Shift+F4" onSelect={hideAllPanels}>
        Hide all panels
      </MenuBarItem>
    </>
  );
}

/** Document > Calibrate… and Tools > Calibrate… (Story 4.3): the shown page's Calibrate dialog. */
function CalibrateItem() {
  const open = useStore(viewerStore, hasDocument);
  return (
    <MenuBarItem disabled={!open} onSelect={() => openCalibrate()}>
      Calibrate…
    </MenuBarItem>
  );
}

/** Document > Verify calibration… and Tools > Verify calibration… (Story 4.4): only for a calibrated shown page. */
function VerifyItem() {
  const calibrated = useStore(viewerStore, (s) => hasDocument(s) && calibrationOf(s, s.pageIndex) !== null);
  return (
    // Review V1: a disabled item takes no pointer or focus, so a title would never show: the reason is in the item.
    <MenuBarItem disabled={!calibrated} onSelect={() => openVerify()}>
      Verify calibration…
      {calibrated ? null : (
        <span className="ml-2 text-ws-xs" data-testid="verify-disabled-reason">
          (calibrate this page first)
        </span>
      )}
    </MenuBarItem>
  );
}

/** Edit > Copy, Paste, Delete, Select all, Group, Ungroup (Story 5.3): the shown page's selection. */
function SelectionItems() {
  const documentId = useStore(viewerStore, (s) => (hasDocument(s) ? s.documentId : null));
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const s = useSelectionState(documentId, pageIndex);
  const item = (label: string, shortcut: string, command: SelectionCommand, enabled: boolean) => (
    <MenuBarItem disabled={!documentId || !enabled} shortcut={shortcut} onSelect={() => viewerCommands.selection(command)}>
      {label}
    </MenuBarItem>
  );
  return (
    <>
      {item("Copy", "Ctrl+C", "copy", s.selected > 0)}
      {item("Paste", "Ctrl+V", "paste", hasClipboard())}
      {item("Delete", "Del", "delete", s.editable > 0)}
      {item("Select all", "Ctrl+A", "all", s.any)}
      <MenuBarSeparator />
      {item("Group", "Ctrl+G", "group", s.units > 1)}
      {item("Ungroup", "Ctrl+Shift+G", "ungroup", s.grouped)}
    </>
  );
}

/** Edit > Undo / Redo (Story 4.3): the active drawing's next step, named ("Undo Calibrate page 1"). */
function UndoItems() {
  const tabId = useStore(viewerStore, (s) => s.tabId);
  const open = useStore(viewerStore, hasDocument);
  const undoLabel = useStore(editorStore, (s) => activeUndoLabels(s, tabId).undo);
  const redoLabel = useStore(editorStore, (s) => activeUndoLabels(s, tabId).redo);
  return (
    <>
      <MenuBarItem disabled={!open || !undoLabel} shortcut="Ctrl+Z" onSelect={() => undoActive()}>
        {undoLabel && open ? `Undo ${undoLabel}` : "Undo"}
      </MenuBarItem>
      <MenuBarItem disabled={!open || !redoLabel} shortcut="Ctrl+Y" onSelect={() => redoActive()}>
        {redoLabel && open ? `Redo ${redoLabel}` : "Redo"}
      </MenuBarItem>
    </>
  );
}

export function WorkspaceMenuBar({ onOpen, onSignOut, theme, onThemeChange }: WorkspaceMenuBarProps) {
  return (
    <MenuBar aria-label="Main menu">
      <MenuBarMenu>
        <MenuBarTrigger>File</MenuBarTrigger>
        <MenuBarContent>
          <MenuBarItem icon={FolderOpen} shortcut="Ctrl+O" onSelect={onOpen}>
            Open…
          </MenuBarItem>
          <TabItem label="Close drawing" shortcut={TAB_SHORTCUTS.close} run={() => viewerTabs.closeActive()} minTabs={1} />
          <Disabled label="Save" shortcut="Ctrl+S" />
          <Disabled label="Save as…" shortcut="Ctrl+Shift+S" />
          <Disabled label="Print…" shortcut="Ctrl+P" />
          <MenuBarSeparator />
          <Disabled label="Flatten…" shortcut="Ctrl+Shift+M" />
          <Disabled label="Export…" />
          <MenuBarSeparator />
          <MenuBarItem icon={LogOut} onSelect={onSignOut}>
            Sign out
          </MenuBarItem>
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Edit</MenuBarTrigger>
        <MenuBarContent>
          <UndoItems />
          <MenuBarSeparator />
          <SelectionItems />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>View</MenuBarTrigger>
        <MenuBarContent>
          <ViewItem label="Zoom in" shortcut="+" command="zoomIn" />
          <ViewItem label="Zoom out" shortcut="-" command="zoomOut" />
          <ViewItem label="Fit page" shortcut="Ctrl+9" command="fitPage" />
          <ViewItem label="Fit width" shortcut="Ctrl+0" command="fitWidth" />
          <MenuBarSeparator />
          <ViewItem label="Rotate view clockwise" command="rotateClockwise" />
          <ViewItem label="Rotate view counter-clockwise" command="rotateCounterClockwise" />
          <MenuBarSeparator />
          <PanelItems />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Document</MenuBarTrigger>
        <MenuBarContent>
          <CalibrateItem />
          <VerifyItem />
          <MenuBarSeparator />
          <Disabled label="Rotate pages…" />
          <Disabled label="Insert pages…" />
          <Disabled label="Delete pages…" />
          <Disabled label="Page labels…" />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Tools</MenuBarTrigger>
        <MenuBarContent>
          <CalibrateItem />
          <VerifyItem />
          <Disabled label="Tool Chest" />
          <Disabled label="4541 zones" />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Window</MenuBarTrigger>
        <MenuBarContent>
          <TabItem label="Next drawing" shortcut={TAB_SHORTCUTS.next} run={() => viewerTabs.cycle(1)} minTabs={2} />
          <TabItem label="Previous drawing" shortcut={TAB_SHORTCUTS.previous} run={() => viewerTabs.cycle(-1)} minTabs={2} />
          <MenuBarSeparator />
          <PanelItems />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Settings</MenuBarTrigger>
        <MenuBarContent>
          <Disabled label="Keyboard shortcuts…" />
          {/* Story 3.8: radio items in a submenu (no dialog): one click, the current theme checked. */}
          <MenuBarSub>
            <MenuBarSubTrigger icon={Palette}>Appearance</MenuBarSubTrigger>
            <MenuBarSubContent>
              <MenuBarRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (isTheme(value)) onThemeChange?.(value);
                }}
              >
                {THEMES.map((t) => (
                  <MenuBarRadioItem key={t} value={t}>
                    {THEME_LABELS[t]}
                  </MenuBarRadioItem>
                ))}
              </MenuBarRadioGroup>
            </MenuBarSubContent>
          </MenuBarSub>
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Help</MenuBarTrigger>
        <MenuBarContent>
          <Disabled label="Keyboard shortcuts" />
          <Disabled label="About Plan Markup" />
        </MenuBarContent>
      </MenuBarMenu>
    </MenuBar>
  );
}
