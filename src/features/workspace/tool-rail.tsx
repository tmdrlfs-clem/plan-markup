"use client";

import {
  Angle,
  ArrowUpRight,
  Circle,
  Cloud,
  Diameter,
  Droplets,
  Eraser,
  Hand,
  Hash,
  Highlighter,
  MousePointer2,
  Pen,
  Pentagon,
  Radius,
  Route,
  Ruler,
  Slash,
  Square,
  Stamp,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect } from "react";
import { useStore } from "zustand";

import { Toolbar, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";
import { dismissHint, showHint } from "@/components/ui/hint-store";
import { hasDocument, setTool, viewerStore, type ViewerTool } from "@/features/viewer";

import { NO_DRAWING } from "./workspace-toolbar";

interface Tool {
  id: string;
  label: string;
  icon: LucideIcon;
  /** None for tools without a default key (Story 4.9, D5: Angle, Radius, Diameter). */
  shortcut?: string;
}

/**
 * Tools that work today: Select and Pan (Story 3.2), and Length (snapping from
 * Story 4.1, measuring from Story 4.5). The others arrive with the editor.
 */
const LIVE_TOOLS: ReadonlySet<string> = new Set<ViewerTool>(["select", "pan", "length", "polylength", "area", "count", "angle", "radius", "diameter"]);

export const SNAP_PREVIEW_HINT_ID = "snap-preview";
/** Review S3: a page past the segment cap. */
export const SNAP_PARTIAL_NOTE = "This page is very large: snapping covers only part of its linework.";
export const SNAP_PREVIEW_HINT =
  "Length: click the start and the end point. Points snap to the drawing (Alt: off, Shift: 45° steps). Esc cancels a measurement; Esc again returns to Select.";
/** Story 4.6: the HintBar while Polylength is armed. */
export const POLYLENGTH_HINT =
  "Polylength: click each vertex; double-click or Enter finishes. Backspace removes the last vertex. Points snap to the drawing (Alt: off, Shift: 45° steps). Esc cancels a measurement; Esc again returns to Select.";
/** Story 4.8: the HintBar while Area or Count is armed. */
export const AREA_HINT =
  "Area: click each corner; double-click, Enter or a click on the first corner closes it. Backspace removes the last corner. Points snap to the drawing (Alt: off, Shift: 45° steps). Esc cancels; Esc again returns to Select.";
export const COUNT_HINT = "Count: click each item. Enter, a double-click or Esc finishes the count. Backspace removes the last marker.";
/** Story 4.9: the HintBar while Angle, Radius or Diameter is armed. */
export const ANGLE_HINT =
  "Angle: click the start of the first leg, the corner, then the end of the second leg. Backspace removes the last point. Points snap to the drawing (Alt: off, Shift: 45° steps). Esc cancels; Esc again returns to Select.";
export const CIRCLE_HINT =
  "Radius / Diameter: click three points on the circle or arc. Backspace removes the last point. Points snap to the drawing (Alt: off, Shift: 45° steps). Esc cancels; Esc again returns to Select.";
const TOOL_HINTS: Partial<Record<ViewerTool, string>> = {
  length: SNAP_PREVIEW_HINT,
  polylength: POLYLENGTH_HINT,
  area: AREA_HINT,
  count: COUNT_HINT,
  angle: ANGLE_HINT,
  radius: CIRCLE_HINT,
  diameter: CIRCLE_HINT,
};
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
      { id: "polylength", label: "Polylength", icon: Route, shortcut: "Shift+Alt+Q" },
      { id: "area", label: "Area", icon: Pentagon, shortcut: "Shift+Alt+A" },
      { id: "count", label: "Count", icon: Hash, shortcut: "Shift+Alt+C" },
      { id: "angle", label: "Angle", icon: Angle },
      { id: "radius", label: "Radius", icon: Radius },
      { id: "diameter", label: "Diameter", icon: Diameter },
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
  // Stories 4.1 / 4.5 / 4.6: while a measuring tool is armed (whatever armed it), the HintBar says how it works.
  const hint = open ? (TOOL_HINTS[active] ?? null) : null;
  const partial = useStore(viewerStore, (s) => s.snapPartial);
  useEffect(() => {
    if (!hint) return;
    showHint({ id: SNAP_PREVIEW_HINT_ID, variant: "info", text: partial ? `${hint} ${SNAP_PARTIAL_NOTE}` : hint });
    return () => dismissHint(SNAP_PREVIEW_HINT_ID);
  }, [hint, partial]);
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
