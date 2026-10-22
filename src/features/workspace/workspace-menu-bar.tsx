"use client";

import { FolderOpen, LogOut } from "lucide-react";
import { useStore } from "zustand";

import {
  MenuBar,
  MenuBarCheckboxItem,
  MenuBarContent,
  MenuBarItem,
  MenuBarMenu,
  MenuBarSeparator,
  MenuBarTrigger,
} from "@/components/ui/menu-bar";
import { hasDocument, viewerCommands, viewerStore, type ViewerCommand } from "@/features/viewer";

import { useLayout } from "./layout-context";
import { LEFT_PANELS, MARKUPS_LIST } from "./panel-registry";

export interface WorkspaceMenuBarProps {
  onOpen: () => void;
  onSignOut: () => void;
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

export function WorkspaceMenuBar({ onOpen, onSignOut }: WorkspaceMenuBarProps) {
  return (
    <MenuBar aria-label="Main menu">
      <MenuBarMenu>
        <MenuBarTrigger>File</MenuBarTrigger>
        <MenuBarContent>
          <MenuBarItem icon={FolderOpen} shortcut="Ctrl+O" onSelect={onOpen}>
            Open…
          </MenuBarItem>
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
          <Disabled label="Undo" shortcut="Ctrl+Z" />
          <Disabled label="Redo" shortcut="Ctrl+Y" />
          <MenuBarSeparator />
          <Disabled label="Copy" shortcut="Ctrl+C" />
          <Disabled label="Paste" shortcut="Ctrl+V" />
          <Disabled label="Delete" shortcut="Del" />
          <Disabled label="Select all" shortcut="Ctrl+A" />
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
          <Disabled label="Rotate pages…" />
          <Disabled label="Insert pages…" />
          <Disabled label="Delete pages…" />
          <Disabled label="Page labels…" />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Tools</MenuBarTrigger>
        <MenuBarContent>
          <Disabled label="Calibrate…" />
          <Disabled label="Tool Chest" />
          <Disabled label="4541 zones" />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Window</MenuBarTrigger>
        <MenuBarContent>
          <PanelItems />
        </MenuBarContent>
      </MenuBarMenu>

      <MenuBarMenu>
        <MenuBarTrigger>Settings</MenuBarTrigger>
        <MenuBarContent>
          <Disabled label="Keyboard shortcuts…" />
          <Disabled label="Theme" />
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
