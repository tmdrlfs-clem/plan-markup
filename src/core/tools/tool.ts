// Story 7.2 (FR40, AR19): a tool, the reusable form of configured markups.
//
// The content keeps the markups' geometry and style as drawn, moved so their
// bounds' centre is the origin (placing puts that centre at the click), on no
// page, layer or group, unlocked. Measured sizes are kept with the source
// page's calibration and UserUnit, so a tool can be placed at real size on
// another calibrated page (Story 7.3). An image's pixels leave the content for
// the private `tool-assets` bucket (one image a tool); the content marks where
// it goes.

import { z } from "zod";

import { calibrationSchema } from "@/core/calibration/calibration";
import { IMAGE_SRC_PATTERN, imageMarkupSchema, markupSchema, type ImageMarkup, type Markup } from "@/core/schema/markup";
import { UUID_PATTERN } from "@/core/ids/uuid";
import { markupBounds, translateMarkup } from "@/core/markup/geometry";
import { subjectOf } from "@/core/markup/properties";

import { toolSetNameSchema } from "./tool-set";

export const TOOL_CONTENT_VERSION = 1;
/** At most this many markups in one tool. */
export const MAX_TOOL_MARKUPS = 200;
/** The content's JSON, as the database checks it (256 KB). */
export const MAX_TOOL_CONTENT_BYTES = 256 * 1024;
/** One image a tool, at most 8 MB. */
export const MAX_TOOL_IMAGE_BYTES = 8 * 1024 * 1024;
/** The page a tool's markups are on (none). */
export const TOOL_PAGE = "tool:0";

/** An image markup in a tool: its pixels are the tool's asset. */
const toolImageSchema = imageMarkupSchema.omit({ src: true }).extend({ asset: z.literal(true) });
const toolMarkupSchema = z.union([...markupSchema.options.filter((o) => o.shape.type.value !== "image"), toolImageSchema]);
export type ToolMarkup = Exclude<Markup, ImageMarkup> | z.infer<typeof toolImageSchema>;

export const toolContentSchema = z
  .object({
    v: z.literal(TOOL_CONTENT_VERSION),
    markups: z.array(toolMarkupSchema).min(1).max(MAX_TOOL_MARKUPS),
    /** The source page's calibration (null: drawn unscaled) and UserUnit. */
    calibration: calibrationSchema.nullable(),
    userUnit: z.number().finite().positive().max(75000),
  })
  .superRefine((c, ctx) => {
    if (c.markups.filter((m) => m.type === "image").length > 1) ctx.addIssue({ code: "custom", message: "A tool can hold one image." });
  });
export type ToolContent = z.infer<typeof toolContentSchema>;

const label = z.string().trim().min(1, "Enter a value.").max(60, "At most 60 characters.");
/** Story 7.2: a tool typed as a device is counted per device type (Story 7.3). */
export const deviceSchema = z.object({
  group: label,
  label,
  description: z.string().trim().max(500, "At most 500 characters."),
});
export type Device = z.infer<typeof deviceSchema>;

export const toolNameSchema = toolSetNameSchema;

const id = z.string().regex(UUID_PATTERN);
/** The image of a tool: the base64 of a PNG or JPEG. */
export const toolImageInput = z.object({
  type: z.enum(["image/png", "image/jpeg"]),
  base64: z
    .string()
    .max(Math.ceil(MAX_TOOL_IMAGE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const addToolSchema = z
  .object({
    /** An existing set, or a new set's name. */
    set: z.union([z.object({ id }), z.object({ name: toolSetNameSchema })]),
    name: toolNameSchema,
    content: toolContentSchema,
    device: deviceSchema.nullable(),
    image: toolImageInput.nullable(),
  })
  .superRefine((t, ctx) => {
    const images = t.content.markups.some((m) => m.type === "image");
    if (images !== (t.image !== null)) ctx.addIssue({ code: "custom", message: "The tool's image is missing." });
    if (new TextEncoder().encode(JSON.stringify(t.content)).length > MAX_TOOL_CONTENT_BYTES) ctx.addIssue({ code: "custom", message: "The markups are too large for a tool." });
  });
export type AddToolInput = z.infer<typeof addToolSchema>;

/** A tool as the Tool Chest shows it. */
export type Tool = {
  id: string;
  name: string;
  /** Null when what is stored no longer reads as a tool (shown, never placed). */
  content: ToolContent | null;
  device: Device | null;
  /** A signed URL of its image, if any (10 minutes). */
  imageUrl: string | null;
};

/** Which markups can become a tool: an eraser stroke belongs to its drawing. */
export function canBeTool(m: Markup): boolean {
  return m.type !== "eraser";
}

/** The centre of the markups' bounds. */
function centreOf(markups: readonly Markup[]): { x: number; y: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of markups) {
    const b = markupBounds(m);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The image's data URL as an upload: its type and base64. */
export function imageUpload(src: string): z.infer<typeof toolImageInput> | null {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(src);
  return match && IMAGE_SRC_PATTERN.test(src) ? { type: match[1] as "image/png" | "image/jpeg", base64: match[2] } : null;
}

/**
 * The tool content of `markups` (in drawing order) on a page with
 * `calibration` and `userUnit`, and its image's data URL (null without one).
 * Null when nothing can become a tool, or more than one image is selected.
 */
export function toolContentOf(
  markups: readonly Markup[],
  page: { calibration: ToolContent["calibration"]; userUnit: number },
): { content: ToolContent; image: string | null } | null {
  const usable = markups.filter(canBeTool);
  if (usable.length === 0 || usable.length > MAX_TOOL_MARKUPS) return null;
  if (usable.filter((m) => m.type === "image").length > 1) return null;
  const c = centreOf(usable);
  let image: string | null = null;
  const moved = usable.map((m): ToolMarkup => {
    const t = translateMarkup(m, { x: -c.x, y: -c.y });
    // On no page, layer or group; unlocked; not counted.
    const rest = { ...t, pageId: TOOL_PAGE } as Markup & { groupId?: string; layerId?: string; locked?: boolean };
    // Story 7.3: a placed device's count mark stays with its placement (the tool's own device is typed).
    delete rest.device;
    delete rest.groupId;
    delete rest.layerId;
    delete rest.locked;
    if (rest.type === "image") {
      image = rest.src;
      const { src: _src, ...noSrc } = rest;
      void _src;
      return { ...noSrc, asset: true };
    }
    return rest;
  });
  return { content: { v: TOOL_CONTENT_VERSION, markups: moved, calibration: page.calibration, userUnit: page.userUnit }, image };
}

/** The tool's markups to draw: an image gets `src` back (its asset's URL, or none yet). */
export function toolMarkups(content: ToolContent, imageSrc: string | null): Markup[] {
  const out: Markup[] = [];
  for (const m of content.markups) {
    if (m.type === "image" && "asset" in m) {
      if (!imageSrc) continue;
      const { asset: _asset, ...rest } = m;
      void _asset;
      out.push({ ...rest, src: imageSrc } as Markup);
    } else out.push(m as Markup);
  }
  return out;
}

/** The name a new tool suggests: the subject of a single markup (or its group's first), else "N markups". */
export function suggestedToolName(markups: readonly Markup[]): string {
  const usable = markups.filter(canBeTool);
  if (usable.length === 0) return "Tool";
  const first = usable[0];
  if (usable.length === 1 || usable.every((m) => m.groupId && m.groupId === first.groupId)) return subjectOf(first).slice(0, 100);
  return `${usable.length} markups`;
}
