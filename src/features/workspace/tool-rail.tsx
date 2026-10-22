"use client";

import {
  ArrowUpRight,
  Circle,
  Cloud,
  Droplets,
  Eraser,
  Hand,
  Hash,
  Highlighter,
  MousePointer2,
  Pen,
  Pentagon,
  Ruler,
  Slash,
  Square,
  Stamp,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { useStore } from "zustand";

import { Toolbar, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";
import { hasDocument, setTool, viewerStore, type ViewerTool } from "@/features/viewer";

import { NO_DRAWING } from "./workspace-toolbar";

interface Tool {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

/** Tools that work today (Story 3.2); the others arrive with the editor. */
const LIVE_TOOLS: ReadonlySet<string> = new Set<ViewerTool>(["select", "pan"]);
export const EDITOR_LATER = "Arrives with the markup editor";

/** UX-DR6 groups. Select and Pan work with a drawing open; the rest arrive with the editor. */
const GROUPS: { label: string; tools: Tool[] }[] = [
  {
    label: "Select and pan",
    tools: [
      { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
      { id: "pan", label: "Pan", icon: Hand, shortcut: "Shift+V" },
    ],
  },
  {
    label: "Markup",
    tools: [
      { id: "line", label: "Line", icon: Slash, shortcut: "L" },
      { id: "arrow", label: "Arrow", icon: ArrowUpRight, shortcut: "A" },
      { id: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
      { id: "ellipse", label: "Ellipse", icon: Circle, shortcut: "E" },
      { id: "cloud", label: "Cloud", icon: Cloud, shortcut: "C" },
      { id: "text", label: "Text box", icon: Type, shortcut: "T" },
      { id: "pen", label: "Pen", icon: Pen, shortcut: "P" },
      { id: "highlight", label: "Highlight", icon: Highlighter, shortcut: "H" },
      { id: "stamp", label: "Stamp", icon: Stamp, shortcut: "S" },
    ],
  },
  {
    label: "Measure",
    tools: [
      { id: "length", label: "Length", icon: Ruler, shortcut: "Shift+Alt+L" },
      { id: "area", label: "Area", icon: Pentagon, shortcut: "Shift+Alt+A" },
      { id: "count", label: "Count", icon: Hash, shortcut: "Shift+Alt+C" },
    ],
  },
  {
    label: "White-out",
    tools: [{ id: "white-out", label: "White-out", icon: Eraser, shortcut: "Shift+W" }],
  },
  {
    label: "4541",
    tools: [{ id: "sprinkler-zone", label: "Sprinkler zone", icon: Droplets, shortcut: "J" }],
  },
];

/** Right 44 px tool rail; every tool needs an open drawing. */
export function ToolRail() {
  const open = useStore(viewerStore, hasDocument);
  const active = useStore(viewerStore, (s) => s.tool);
  return (
    <Toolbar aria-label="Drawing tools" orientation="vertical" className="h-full overflow-y-auto">
      {GROUPS.map((group, index) => (
        <Fragment key={group.label}>
          {index > 0 ? <ToolbarSeparator className="my-1" /> : null}
          <ToolbarToggleGroup
            type="single"
            aria-label={group.label}
            className="flex-col"
            value={open && LIVE_TOOLS.has(active) ? active : ""}
            onValueChange={(value: string) => {
              // Clicking the active tool again keeps it: a tool is always active.
              if (LIVE_TOOLS.has(value)) setTool(value as ViewerTool);
            }}
          >
            {group.tools.map((tool) => (
              <ToolbarToggleItem
                key={tool.id}
                value={tool.id}
                label={tool.label}
                icon={tool.icon}
                shortcut={tool.shortcut}
                size="md"
                disabled={!(open && LIVE_TOOLS.has(tool.id))}
                disabledReason={open ? EDITOR_LATER : NO_DRAWING}
              />
            ))}
          </ToolbarToggleGroup>
        </Fragment>
      ))}
    </Toolbar>
  );
}
