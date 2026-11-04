"use client";

import {
  Angle,
  ArrowUpRight,
  ChevronDown,
  Circle,
  Cloud,
  CloudCog,
  Diameter,
  Droplets,
  Eraser,
  Hand,
  Hash,
  Hexagon,
  Highlighter,
  ImagePlus,
  MessageSquareText,
  MousePointer2,
  PaintBucket,
  Pen,
  Pentagon,
  Radius,
  Route,
  Ruler,
  RulerDimensionLine,
  Slash,
  Spline,
  Square,
  StickyNote,
  Stamp,
  Type,
  TypeOutline,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";
import { dismissHint, showHint } from "@/components/ui/hint-store";
import { pickImageFile } from "@/features/editor";
import { hasDocument, isLineTool, isMeasureTool, isTextTool, setTool, viewerStore, type LineTool, type TextTool, type MeasureTool, type ViewerTool } from "@/features/viewer";

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
const LIVE_TOOLS: ReadonlySet<string> = new Set<ViewerTool>(["select", "pan", "length", "polylength", "area", "count", "angle", "radius", "diameter", "line", "arrow", "polyline", "polygon", "rectangle", "ellipse", "cloud", "text", "callout", "typewriter", "note", "cloudplus", "pen", "highlight", "image", "dimension"]);

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
/** Story 4.10: the HintBar while Dynamic fill is armed. */
export const FILL_HINT =
  "Dynamic fill: press and hold inside a room; the fill spreads to the drawing's lines. Shift + drag paints, Ctrl + drag erases, Ctrl+Z undoes a stroke. Enter adds the area; Esc discards the fill, Esc again returns to Select.";
/** Story 5.4: the HintBar while a straight-line markup tool is armed. */
const SNAPS = "Points snap to the drawing (Alt: off, Shift: 45° steps).";
export const LINE_HINT = `Line: click the start and the end point. ${SNAPS} Esc cancels; Esc again returns to Select.`;
export const ARROW_HINT = `Arrow: click the start, then the point the arrow points to. ${SNAPS} Esc cancels; Esc again returns to Select.`;
export const POLYLINE_HINT = `Polyline: click each vertex; double-click or Enter finishes. Backspace removes the last vertex. ${SNAPS} Esc cancels; Esc again returns to Select.`;
export const POLYGON_HINT = `Polygon: click each corner; double-click, Enter or a click on the first corner closes it. Backspace removes the last corner. ${SNAPS} Esc cancels; Esc again returns to Select.`;
/** Story 5.5: the HintBar while Rectangle, Ellipse or Cloud is armed. */
const BOX_SNAPS = "Points snap to the drawing (Alt: off, Shift on the diagonal: a square).";
export const RECTANGLE_HINT = `Rectangle: drag from one corner to the opposite one, or click both. ${BOX_SNAPS} Esc cancels; Esc again returns to Select.`;
export const ELLIPSE_HINT = `Ellipse: drag across its box from corner to corner, or click both. ${BOX_SNAPS.replace("a square", "a circle")} Esc cancels; Esc again returns to Select.`;
export const CLOUD_HINT = `Cloud: click each corner; double-click, Enter or a click on the first corner closes it. Backspace removes the last corner. ${SNAPS} Esc cancels; Esc again returns to Select.`;
/** Story 5.6: the HintBar while a text tool is armed. */
const TYPING = "Type the text; Enter is a new line. Esc, Ctrl+Enter or a click elsewhere adds it.";
export const TEXT_HINT = `Text box: drag from one corner to the opposite one, or click both. ${TYPING}`;
export const CALLOUT_HINT = `Callout: click the point the leader points to, then where the text goes. ${TYPING}`;
export const TYPEWRITER_HINT = `Typewriter: click where the text starts. ${TYPING}`;
export const NOTE_HINT = `Note: click where the note goes. ${TYPING}`;
export const CLOUD_PLUS_HINT = `Cloud+: click each corner of the cloud and close it on the first corner (or Enter), then click where the text goes. ${TYPING}`;
/** Story 5.7: the HintBar while Pen or Highlight is armed. */
const STROKE = "Shift holds the stroke horizontal or vertical. Esc while drawing drops the stroke; Esc again returns to Select.";
export const PEN_HINT = `Pen: drag to draw freehand. ${STROKE}`;
export const HIGHLIGHT_HINT = `Highlight: drag over the sheet to highlight it. ${STROKE}`;
/** Story 5.8: the HintBar while Image (an image picked) or Dimension is armed. */
export const IMAGE_HINT = "Image: click where the image goes (its centre); then drag its handles to resize it. Esc cancels.";
export const DIMENSION_HINT = `Dimension: click the two points to dimension, then where its line goes. ${SNAPS} Esc cancels; Esc again returns to Select.`;
const TOOL_HINTS: Partial<Record<ViewerTool, string>> = {
  length: SNAP_PREVIEW_HINT,
  polylength: POLYLENGTH_HINT,
  area: AREA_HINT,
  count: COUNT_HINT,
  angle: ANGLE_HINT,
  radius: CIRCLE_HINT,
  diameter: CIRCLE_HINT,
  fill: FILL_HINT,
  line: LINE_HINT,
  arrow: ARROW_HINT,
  polyline: POLYLINE_HINT,
  polygon: POLYGON_HINT,
  rectangle: RECTANGLE_HINT,
  ellipse: ELLIPSE_HINT,
  cloud: CLOUD_HINT,
  text: TEXT_HINT,
  callout: CALLOUT_HINT,
  typewriter: TYPEWRITER_HINT,
  note: NOTE_HINT,
  cloudplus: CLOUD_PLUS_HINT,
  pen: PEN_HINT,
  highlight: HIGHLIGHT_HINT,
  image: IMAGE_HINT,
  dimension: DIMENSION_HINT,
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
  // Story 5.4 (D4): Line, Arrow, Polyline and Polygon share one button and a menu (LINE_TOOLS).
  { label: "Lines", tools: [] },
  {
    label: "Markup",
    tools: [
      { id: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
      { id: "ellipse", label: "Ellipse", icon: Circle, shortcut: "E" },
      { id: "pen", label: "Pen", icon: Pen, shortcut: "P" },
      { id: "highlight", label: "Highlight", icon: Highlighter, shortcut: "H" },
      // Story 5.8: Image picks a file first (no key, D4).
      { id: "image", label: "Image", icon: ImagePlus },
      { id: "stamp", label: "Stamp", icon: Stamp, shortcut: "S" },
    ],
  },
  // The measuring tools share one button and a menu (FlyoutGroup).
  { label: "Measure", tools: [] },
  {
    label: "White-out",
    tools: [{ id: "white-out", label: "White-out", icon: Eraser, shortcut: "Shift+W" }],
  },
  {
    label: "4541",
    tools: [{ id: "sprinkler-zone", label: "Sprinkler zone", icon: Droplets, shortcut: "J" }],
  },
];

/**
 * The measuring tools, in one slot: the rail shows the armed (or last armed) one and a menu
 * lists them all, as Revu's measure flyout does (founder 2026-11-01: the rail no longer
 * fits 768 px screens with one button per tool).
 */
export const MEASURE_TOOLS: readonly (Tool & { id: MeasureTool })[] = [
  { id: "length", label: "Length", icon: Ruler, shortcut: "Shift+Alt+L" },
  { id: "polylength", label: "Polylength", icon: Route, shortcut: "Shift+Alt+Q" },
  { id: "area", label: "Area", icon: Pentagon, shortcut: "Shift+Alt+A" },
  { id: "count", label: "Count", icon: Hash, shortcut: "Shift+Alt+C" },
  { id: "angle", label: "Angle", icon: Angle },
  { id: "radius", label: "Radius", icon: Radius },
  { id: "diameter", label: "Diameter", icon: Diameter },
  { id: "fill", label: "Dynamic fill", icon: PaintBucket, shortcut: "J" },
];
export const MORE_MEASURE_TOOLS = "More measure tools";

/** Story 5.4 (D4): the straight-line markup tools, in one slot as the measuring tools are; 5.8: Dimension too (no key, D4). */
type LineSlotTool = LineTool | "dimension";
const isLineSlotTool = (tool: ViewerTool): tool is LineSlotTool => isLineTool(tool) || tool === "dimension";
export const LINE_TOOLS: readonly (Tool & { id: LineSlotTool })[] = [
  { id: "line", label: "Line", icon: Slash, shortcut: "L" },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight, shortcut: "A" },
  { id: "polyline", label: "Polyline", icon: Spline, shortcut: "Shift+N" },
  { id: "polygon", label: "Polygon", icon: Hexagon, shortcut: "Shift+P" },
  { id: "dimension", label: "Dimension", icon: RulerDimensionLine },
];
export const MORE_LINE_TOOLS = "More line tools";

/** Story 5.6 (D4): Cloud and Cloud+ share the Cloud slot; the text tools the Text box slot. */
type CloudTool = "cloud" | "cloudplus";
const isCloudTool = (tool: ViewerTool): tool is CloudTool => tool === "cloud" || tool === "cloudplus";
export const CLOUD_TOOLS: readonly (Tool & { id: CloudTool })[] = [
  { id: "cloud", label: "Cloud", icon: Cloud, shortcut: "C" },
  { id: "cloudplus", label: "Cloud+", icon: CloudCog, shortcut: "K" },
];
export const MORE_CLOUD_TOOLS = "More cloud tools";
type TextSlotTool = Exclude<TextTool, "cloudplus">;
const isTextSlotTool = (tool: ViewerTool): tool is TextSlotTool => isTextTool(tool) && tool !== "cloudplus";
export const TEXT_TOOLS: readonly (Tool & { id: TextSlotTool })[] = [
  { id: "text", label: "Text box", icon: Type, shortcut: "T" },
  { id: "callout", label: "Callout", icon: MessageSquareText, shortcut: "Q" },
  { id: "typewriter", label: "Typewriter", icon: TypeOutline },
  { id: "note", label: "Note", icon: StickyNote },
];
export const MORE_TEXT_TOOLS = "More text tools";

/**
 * Tools sharing one rail slot (Measure, Story 4.11; Lines, Story 5.4): the slot shows the armed
 * (or last armed) one and a menu lists them all.
 */
function FlyoutGroup<T extends ViewerTool>({
  label,
  more,
  tools,
  member,
  open,
  active,
}: {
  label: string;
  more: string;
  tools: readonly (Tool & { id: T })[];
  member: (tool: ViewerTool) => tool is T;
  open: boolean;
  active: ViewerTool;
}) {
  const [last, setLast] = useState<T>(tools[0].id);
  // The slot follows the armed tool, whatever armed it (rail, menu or shortcut).
  if (member(active) && active !== last) setLast(active);
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = tools.find((t) => t.id === last) ?? tools[0];
  return (
    <>
      <ToolbarToggleGroup
        type="single"
        aria-label={label}
        className="flex-col"
        value={open && active === shown.id ? active : ""}
        onValueChange={(value: string) => {
          if (value) setTool(value as ViewerTool);
        }}
      >
        <ToolbarToggleItem
          value={shown.id}
          label={shown.label}
          icon={shown.icon}
          shortcut={shown.shortcut}
          size="md"
          disabled={!open}
          disabledReason={NO_DRAWING}
        />
      </ToolbarToggleGroup>
      <Menu open={open && menuOpen} onOpenChange={(next) => setMenuOpen(open && next)}>
        <MenuTrigger asChild>
          <ToolbarButton label={more} icon={ChevronDown} size="xs" className="h-4 w-8" disabled={!open} disabledReason={NO_DRAWING} />
        </MenuTrigger>
        <MenuContent side="left" align="start">
          <MenuRadioGroup value={member(active) ? active : ""} onValueChange={(value) => setTool(value as ViewerTool)}>
            {tools.map((tool) => (
              <MenuRadioItem key={tool.id} value={tool.id} shortcut={tool.shortcut}>
                {tool.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </>
  );
}

/** One rail group of buttons (the tools not yet live are disabled); Image (Story 5.8) asks for its file first (`onPickImage`). */
function ToolGroup({ label, tools, open, active, onPickImage }: { label: string; tools: readonly Tool[]; open: boolean; active: ViewerTool; onPickImage?: () => void }) {
  return (
    <ToolbarToggleGroup
      type="single"
      aria-label={label}
      className="flex-col"
      value={open && LIVE_TOOLS.has(active) ? active : ""}
      onValueChange={(value: string) => {
        // Clicking the active tool again keeps it: a tool is always active.
        if (value === "image") onPickImage?.();
        else if (LIVE_TOOLS.has(value)) setTool(value as ViewerTool);
      }}
    >
      {tools.map((tool) => (
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
  );
}

/** Right 44 px tool rail; every tool needs an open drawing. */
export function ToolRail() {
  const open = useStore(viewerStore, hasDocument);
  const active = useStore(viewerStore, (s) => s.tool);
  // Stories 4.1 / 4.5 / 4.6: while a measuring tool is armed (whatever armed it), the HintBar says how it works.
  const hint = open ? (TOOL_HINTS[active] ?? null) : null;
  const partial = useStore(viewerStore, (s) => s.snapPartial);
  const imageInput = useRef<HTMLInputElement>(null);
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
          {group.label === "Measure" ? (
            <FlyoutGroup label="Measure" more={MORE_MEASURE_TOOLS} tools={MEASURE_TOOLS} member={isMeasureTool} open={open} active={active} />
          ) : group.label === "Lines" ? (
            <FlyoutGroup label="Lines" more={MORE_LINE_TOOLS} tools={LINE_TOOLS} member={isLineSlotTool} open={open} active={active} />
          ) : group.label === "Markup" ? (
            // Story 5.6 (D4): Rectangle, Ellipse, the Cloud slot, the Text box slot, then Pen, Highlight and Stamp.
            <>
              <ToolGroup label="Markup" tools={group.tools.slice(0, 2)} open={open} active={active} />
              <FlyoutGroup label="Clouds" more={MORE_CLOUD_TOOLS} tools={CLOUD_TOOLS} member={isCloudTool} open={open} active={active} />
              <FlyoutGroup label="Text" more={MORE_TEXT_TOOLS} tools={TEXT_TOOLS} member={isTextSlotTool} open={open} active={active} />
              <ToolGroup label="Freehand" tools={group.tools.slice(2)} open={open} active={active} onPickImage={() => imageInput.current?.click()} />
            </>
          ) : (
            <ToolGroup label={group.label} tools={group.tools} open={open} active={active} />
          )}
        </Fragment>
      ))}
      {/* Story 5.8: the Image tool's file (PNG or JPEG; checked and decoded by the editor). */}
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Image file"
        data-testid="image-file-input"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pickImageFile(file);
        }}
      />
    </Toolbar>
  );
}
