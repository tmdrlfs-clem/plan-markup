// The markup schema (AR7, AR8; Story 4.5). Framework-free.
//
// One Zod schema per markup type, joined as a discriminated union on `type`,
// shared by the client, workers and (Epic 6) the server. Geometry is in PDF
// user space points of the markup's page (bottom-left origin, the page's own
// box, before UserUnit), bound to the page by its stable page id
// (core/calibration pageIdOf). Measurements store geometry only: their value
// comes from the page's calibration when shown (Story 4.5 AC 2).

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";

const coordinate = z.number().finite().min(-1e7).max(1e7);
export const pointSchema = z.object({ x: coordinate, y: coordinate });

/** A colour as #rrggbb. */
const color = z.string().regex(/^#[0-9a-f]{6}$/i);

export const markupStyleSchema = z.object({
  /** Stroke colour. */
  color,
  /** Line width in points (page units: it scales with the zoom). */
  width: z.number().finite().positive().max(144),
  /** Caption size in points (page units). */
  fontSize: z.number().finite().positive().max(144),
});
export type MarkupStyle = z.infer<typeof markupStyleSchema>;

const base = {
  id: z.string().regex(UUID_PATTERN),
  /** The stable page id (sha256 + page index until page edits, AR8). */
  pageId: z.string().min(1).max(200),
  /** ISO 8601 creation time. */
  createdAt: z.string().max(40),
  style: markupStyleSchema,
};

/** A length measurement: two points (Story 4.5). */
export const lengthMarkupSchema = z.object({
  ...base,
  type: z.literal("length"),
  points: z.tuple([pointSchema, pointSchema]),
});

/** Every markup type (more join with Stories 4.6-4.10 and Epic 5). */
export const markupSchema = z.discriminatedUnion("type", [lengthMarkupSchema]);

export type Markup = z.infer<typeof markupSchema>;
export type LengthMarkup = z.infer<typeof lengthMarkupSchema>;
export type MarkupType = Markup["type"];

/** Revu's default measurement style: red, 1 pt, 10 pt captions. */
export const DEFAULT_MEASURE_STYLE: MarkupStyle = { color: "#ff0000", width: 1, fontSize: 10 };
