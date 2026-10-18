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

import { Toolbar, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";

import { NO_DRAWING } from "./workspace-toolbar";

interface Tool {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

/** UX-DR6 groups. Shortcuts are shown only; tools and their keys arrive with the editor. */
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
  return (
    <Toolbar aria-label="Drawing tools" orientation="vertical" className="h-full overflow-y-auto">
      {GROUPS.map((group, index) => (
        <Fragment key={group.label}>
          {index > 0 ? <ToolbarSeparator className="my-1" /> : null}
          <ToolbarToggleGroup type="single" aria-label={group.label} className="flex-col">
            {group.tools.map((tool) => (
              <ToolbarToggleItem
                key={tool.id}
                value={tool.id}
                label={tool.label}
                icon={tool.icon}
                shortcut={tool.shortcut}
                size="md"
                disabled
                disabledReason={NO_DRAWING}
              />
            ))}
          </ToolbarToggleGroup>
        </Fragment>
      ))}
    </Toolbar>
  );
}
