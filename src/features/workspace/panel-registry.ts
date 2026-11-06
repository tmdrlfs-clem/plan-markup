import {
  Droplets,
  Images,
  Layers,
  Ruler,
  Search,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const LEFT_PANEL_IDS = [
  "tool-chest",
  "measurements",
  "sprinkler",
  "thumbnails",
  "search",
  "properties",
  "layers",
] as const;

export type LeftPanelId = (typeof LEFT_PANEL_IDS)[number];

export interface LeftPanelInfo {
  id: LeftPanelId;
  title: string;
  icon: LucideIcon;
  /** Shortcut in table form; bound by use-workspace-shortcuts via `code`. */
  shortcut: string;
  /** KeyboardEvent.code that opens the panel together with Alt (none: its own key, e.g. Search's Ctrl+F). */
  code: string | null;
  empty: string;
  hint?: string;
}

/** One place for the left rail panels: rail buttons, View/Window menus, shortcuts, empty states. */
export const LEFT_PANELS: readonly LeftPanelInfo[] = [
  {
    id: "tool-chest",
    title: "Tool Chest",
    icon: Wrench,
    shortcut: "Alt+X",
    code: "KeyX",
    empty: "No tool sets yet",
  },
  {
    id: "measurements",
    title: "Measurements",
    icon: Ruler,
    shortcut: "Alt+U",
    code: "KeyU",
    empty: "No measurements yet",
  },
  {
    id: "sprinkler",
    title: "4541",
    icon: Droplets,
    shortcut: "Alt+4",
    code: "Digit4",
    empty: "Open and calibrate a drawing to place sprinklers.",
  },
  {
    id: "thumbnails",
    title: "Thumbnails",
    icon: Images,
    shortcut: "Alt+T",
    code: "KeyT",
    empty: "No drawing open",
  },
  {
    // Story 3.6: Ctrl+F anywhere in the workspace while a drawing is open (not in dialog / form fields).
    id: "search",
    title: "Search",
    icon: Search,
    shortcut: "Ctrl+F",
    code: null,
    empty: "No drawing open",
  },
  {
    id: "properties",
    title: "Properties",
    icon: SlidersHorizontal,
    shortcut: "Alt+P",
    code: "KeyP",
    empty: "Nothing selected",
  },
  {
    id: "layers",
    title: "Layers",
    icon: Layers,
    shortcut: "Alt+Y",
    code: "KeyY",
    empty: "No layers yet",
  },
];

export function leftPanel(id: LeftPanelId): LeftPanelInfo {
  return LEFT_PANELS.find((panel) => panel.id === id) ?? LEFT_PANELS[0];
}

export const MARKUPS_LIST = { title: "Markups", shortcut: "Alt+L", code: "KeyL" } as const;
