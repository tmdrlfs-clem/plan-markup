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
  /** Story 5.3: the group the markup belongs to (groups do not nest); absent: none. */
  groupId: z.string().regex(UUID_PATTERN).optional(),
  /** Story 5.3: a locked markup can be selected but not moved, edited or deleted. */
  locked: z.boolean().optional(),
};

/**
 * Story 4.6: a measurement caption moved off its default place, as a user
 * space offset from it (it follows zoom and rotation like the markup).
 */
const measure = { ...base, captionOffset: pointSchema.optional() };

/** A length measurement: two points (Story 4.5). */
export const lengthMarkupSchema = z.object({
  ...measure,
  type: z.literal("length"),
  points: z.tuple([pointSchema, pointSchema]),
});

/** Story 4.6: a polylength, the total along its vertices. */
export const MAX_POLYLINE_POINTS = 10_000;
export const polylengthMarkupSchema = z.object({
  ...measure,
  type: z.literal("polylength"),
  points: z.array(pointSchema).min(2).max(MAX_POLYLINE_POINTS),
});

/**
 * Story 4.8: an area, a closed polygon (the outer ring, closing edge
 * implied) less its holes (cutouts: Story 4.10 and Epic 5 draw them).
 */
export const MAX_AREA_HOLES = 1_000;
export const areaMarkupSchema = z.object({
  ...measure,
  type: z.literal("area"),
  points: z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS),
  holes: z.array(z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS)).max(MAX_AREA_HOLES).optional(),
});

/** Story 4.8: a count, one marker per point; its value is the number of points. */
export const countMarkupSchema = z.object({
  ...measure,
  type: z.literal("count"),
  points: z.array(pointSchema).min(1).max(MAX_POLYLINE_POINTS),
});

/**
 * Story 4.9: an angle (the first leg's start, the vertex, the second leg's end) and a
 * radius or diameter (three points on the circle); their values are computed, never stored.
 */
const threePoints = z.tuple([pointSchema, pointSchema, pointSchema]);
export const angleMarkupSchema = z.object({ ...measure, type: z.literal("angle"), points: threePoints });
export const radiusMarkupSchema = z.object({ ...measure, type: z.literal("radius"), points: threePoints });
export const diameterMarkupSchema = z.object({ ...measure, type: z.literal("diameter"), points: threePoints });

/** Every markup type (more join with Story 4.10 and Epic 5). */
export const markupSchema = z.discriminatedUnion("type", [
  lengthMarkupSchema,
  polylengthMarkupSchema,
  areaMarkupSchema,
  countMarkupSchema,
  angleMarkupSchema,
  radiusMarkupSchema,
  diameterMarkupSchema,
]);

export type Markup = z.infer<typeof markupSchema>;
export type LengthMarkup = z.infer<typeof lengthMarkupSchema>;
export type PolylengthMarkup = z.infer<typeof polylengthMarkupSchema>;
export type AreaMarkup = z.infer<typeof areaMarkupSchema>;
export type CountMarkup = z.infer<typeof countMarkupSchema>;
export type AngleMarkup = z.infer<typeof angleMarkupSchema>;
export type RadiusMarkup = z.infer<typeof radiusMarkupSchema>;
export type DiameterMarkup = z.infer<typeof diameterMarkupSchema>;
/** The measurements with a caption (Stories 4.5, 4.6, 4.8, 4.9). */
export type MeasureMarkup = LengthMarkup | PolylengthMarkup | AreaMarkup | CountMarkup | AngleMarkup | RadiusMarkup | DiameterMarkup;
export type MarkupType = Markup["type"];

/** Revu's default measurement style: red, 1 pt, 10 pt captions. */
export const DEFAULT_MEASURE_STYLE: MarkupStyle = { color: "#ff0000", width: 1, fontSize: 10 };
