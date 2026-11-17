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
  /** Story 5.5: the fill of a closed shape; absent: none. */
  fill: color.optional(),
  /** Story 5.5: the whole markup's opacity, 0–1; absent: 1. */
  opacity: z.number().finite().min(0).max(1).optional(),
  /** Story 7.5: a dash pattern in points (on, off, …; a Revu import's /BS /D); absent: solid. */
  dash: z.array(z.number().finite().min(0).max(144)).min(1).max(8).optional(),
  /** Story 7.5: the text's face when not the app's own: Carlito (bundled, metric-compatible with Calibri). */
  font: z.enum(["carlito"]).optional(),
});
export type MarkupStyle = z.infer<typeof markupStyleSchema>;

/** Story 5.10: the longest subject. */
export const MAX_SUBJECT_LENGTH = 200;

/** Story 7.3: the device type a placed tool counts as (on the placement's first markup only). */
export const markupDeviceSchema = z.object({
  group: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(60),
});
export type MarkupDevice = z.infer<typeof markupDeviceSchema>;

/**
 * Story 9.8: a head the 4541 engine placed for a zone (the zone markup's id), and how: on a row,
 * a gap-fill exception, or kept fixed on a re-run. Story 9.10 adds heads moved by hand.
 */
export const HEAD_KINDS = ["row", "gapFill", "locked", "manual"] as const;
export const headMetaSchema = z.object({
  zoneId: z.string().regex(UUID_PATTERN),
  kind: z.enum(HEAD_KINDS),
});
export type HeadMeta = z.infer<typeof headMetaSchema>;

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
  /** Story 5.12: the markup's layer (absent: none). */
  layerId: z.string().regex(UUID_PATTERN).optional(),
  /** Story 5.10: the markup's subject (Properties); absent: its type's name. */
  subject: z.string().max(MAX_SUBJECT_LENGTH).optional(),
  /** Story 7.3: a placed device-typed tool counts once, by this markup (absent: not a device). */
  device: markupDeviceSchema.optional(),
  /** Story 9.8: a sprinkler head placed for a 4541 zone (absent: not a placed head). */
  head: headMetaSchema.optional(),
  /** A 4541 head line: a line the designer drew for the engine to put a row of heads on (absent: not one). Never exported. */
  guide: z.literal(true).optional(),
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

/**
 * Story 5.4: straight-line markups (no caption, not measurements): a line and an arrow (its
 * head at the second point), a polyline and a polygon (closed, the closing edge implied).
 */
export const lineMarkupSchema = z.object({ ...base, type: z.literal("line"), points: z.tuple([pointSchema, pointSchema]) });
export const arrowMarkupSchema = z.object({ ...base, type: z.literal("arrow"), points: z.tuple([pointSchema, pointSchema]) });
export const polylineMarkupSchema = z.object({ ...base, type: z.literal("polyline"), points: z.array(pointSchema).min(2).max(MAX_POLYLINE_POINTS) });
export const polygonMarkupSchema = z.object({ ...base, type: z.literal("polygon"), points: z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS) });

/**
 * Story 5.5: a rectangle and an ellipse (the one inscribed in its box), both stored as the box's
 * four corners in order (a rotated or skewed box stays exact under Story 5.2's point
 * transforms), and a revision cloud (closed, its corners; the arcs are drawn, not stored).
 */
const fourPoints = z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]);
export const rectangleMarkupSchema = z.object({ ...base, type: z.literal("rectangle"), points: fourPoints });
export const ellipseMarkupSchema = z.object({ ...base, type: z.literal("ellipse"), points: fourPoints });
export const cloudMarkupSchema = z.object({ ...base, type: z.literal("cloud"), points: z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS) });

/**
 * Story 5.6: text markups. The text is plain text, never HTML (NFR27). A text box and a
 * typewriter are the box's four corners, ordered from the screen's top left when made (p0→p1
 * the lines' direction, p0→p3 down them); a note is its icon's point; a callout is its box's
 * corners then its leader's tip; a Cloud+ is its cloud's corners then its box's four corners.
 */
export const MAX_TEXT_LENGTH = 10_000;
const text = z.string().max(MAX_TEXT_LENGTH);
export const textMarkupSchema = z.object({ ...base, type: z.literal("text"), points: fourPoints, text });
export const typewriterMarkupSchema = z.object({ ...base, type: z.literal("typewriter"), points: fourPoints, text });
export const noteMarkupSchema = z.object({ ...base, type: z.literal("note"), points: z.tuple([pointSchema]), text });
export const calloutMarkupSchema = z.object({ ...base, type: z.literal("callout"), points: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema, pointSchema]), text });
export const cloudPlusMarkupSchema = z.object({ ...base, type: z.literal("cloudplus"), points: z.array(pointSchema).min(7).max(MAX_POLYLINE_POINTS + 4), text });

/**
 * Story 5.7: a pen or highlight stroke, the freehand path's points (simplified when drawn; it is
 * painted smoothed through them). A highlight paints with its style's opacity, multiplied over the sheet.
 */
export const penMarkupSchema = z.object({ ...base, type: z.literal("pen"), points: z.array(pointSchema).min(2).max(MAX_POLYLINE_POINTS) });
export const highlightMarkupSchema = z.object({ ...base, type: z.literal("highlight"), points: z.array(pointSchema).min(2).max(MAX_POLYLINE_POINTS) });
/** Story 5.11: an eraser stroke: a white brush over the drawing, as wide as its style's width (FR36). */
export const eraserMarkupSchema = z.object({ ...base, type: z.literal("eraser"), points: z.array(pointSchema).min(2).max(MAX_POLYLINE_POINTS) });

/**
 * Story 5.11: a white-out: a closed outline (a rectangle's four corners or a polygon's vertices)
 * filled with the sheet's white, hiding the drawing under it; the PDF itself is not changed (FR36, AR25).
 */
export const whiteoutMarkupSchema = z.object({ ...base, type: z.literal("whiteout"), points: z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS) });
/** Story 5.11: the colour a white-out and an eraser cover with: the sheet's. */
export const COVER_COLOR = "#ffffff";

/**
 * Story 5.8: an image, its box's four corners ordered from the screen's top left when placed
 * (p0→p1 the image's top edge, p0→p3 its left edge), and the image itself: a PNG or JPEG data URL
 * the editor decoded, scaled down and re-encoded (never SVG).
 */
export const MAX_IMAGE_SRC_LENGTH = 12_000_000;
export const IMAGE_SRC_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Story 5.13: a signature stamp is an image of the signature with its caption, and who signed when. */
export const signatureMetaSchema = z.object({ signer: z.string().max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export type SignatureMeta = z.infer<typeof signatureMetaSchema>;
export const imageMarkupSchema = z.object({
  ...base,
  type: z.literal("image"),
  points: fourPoints,
  src: z.string().max(MAX_IMAGE_SRC_LENGTH).regex(IMAGE_SRC_PATTERN),
  signature: signatureMetaSchema.optional(),
});
/**
 * Story 5.8: a dimension, its two measured points and the point its dimension line runs through
 * (parallel to them); its length comes from the page's calibration when shown, never stored.
 */
export const dimensionMarkupSchema = z.object({ ...base, type: z.literal("dimension"), points: threePoints });

/**
 * Story 5.9: an underline or a strikethrough of PDF text: the selected glyph boxes, four points a
 * quad (bottom left, bottom right, top right, top left, as the text runs), and the selected text.
 */
export const MAX_TEXT_QUADS = 10_000;
const quadPoints = z
  .array(pointSchema)
  .min(4)
  .max(4 * MAX_TEXT_QUADS)
  .refine((pts) => pts.length % 4 === 0, "four points a quad");
export const underlineMarkupSchema = z.object({ ...base, type: z.literal("underline"), points: quadPoints, text: z.string().max(MAX_TEXT_LENGTH).optional() });
export const strikethroughMarkupSchema = z.object({ ...base, type: z.literal("strikethrough"), points: quadPoints, text: z.string().max(MAX_TEXT_LENGTH).optional() });

/**
 * Story 7.7 (FR37, UX-DR27): a revision stamp, its box's four corners ordered like a text box's
 * (p0 the screen's top left when placed, p0→p1 along its lines), and what it shows: the revision,
 * its description, who made it and when. Its text is drawn from these fields, never stored.
 */
export const MAX_REVISION_LENGTH = 10;
export const MAX_REVISION_DESCRIPTION = 200;
export const MAX_REVISION_AUTHOR = 100;
export const revisionMetaSchema = z.object({
  rev: z.string().trim().min(1, "Enter a revision.").max(MAX_REVISION_LENGTH, `At most ${MAX_REVISION_LENGTH} characters.`),
  description: z.string().max(MAX_REVISION_DESCRIPTION, `At most ${MAX_REVISION_DESCRIPTION} characters.`),
  author: z.string().max(MAX_REVISION_AUTHOR, `At most ${MAX_REVISION_AUTHOR} characters.`),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD."),
});
export type RevisionMeta = z.infer<typeof revisionMetaSchema>;
export const revisionMarkupSchema = z.object({ ...base, type: z.literal("revision"), points: fourPoints, revision: revisionMetaSchema });
export type RevisionMarkup = z.infer<typeof revisionMarkupSchema>;

/**
 * Story 7.8 (FR38, UX-DR27): a legend, its box's four corners ordered like a stamp's, its title and
 * what it counts (the device placements on its page, or in the whole document). Its rows are drawn
 * from the markups, never stored.
 */
export const MAX_LEGEND_TITLE = 60;
export const LEGEND_SCOPES = ["page", "document"] as const;
export const legendMetaSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(MAX_LEGEND_TITLE, `At most ${MAX_LEGEND_TITLE} characters.`),
  scope: z.enum(LEGEND_SCOPES),
});
export type LegendMeta = z.infer<typeof legendMetaSchema>;
export type LegendScope = LegendMeta["scope"];
export const legendMarkupSchema = z.object({ ...base, type: z.literal("legend"), points: fourPoints, legend: legendMetaSchema });
export type LegendMarkup = z.infer<typeof legendMarkupSchema>;

/**
 * Story 9.2 (FR70): a 4541 sprinkler zone, a closed polygon (the outer ring)
 * less its holes, each hole tagged a column or a shaft / void (index-aligned
 * with `holes`; a missing tag is the default for the hole's size). `zone`: its
 * name, its use, the hazard class that use gave it under the mapping in force
 * when the use was chosen (Story 10.12: a later change of the mapping leaves
 * the zone as classed; absent on older zones, which follow the current
 * mapping) and its placement options (Story 9.5). Never exported or listed
 * with the markups.
 */
export const HOLE_TAGS = ["column", "shaft"] as const;
export type HoleTag = (typeof HOLE_TAGS)[number];
export const MAX_ZONE_NAME = 40;
/** The hazard classes a zone can hold (the same as the rules' HAZARDS). */
export const ZONE_HAZARDS = ["ELH", "OH1", "OH2", "OH3"] as const;
export const ZONE_USE_PATTERN = /^[A-Za-z][A-Za-z0-9 /&-]{0,39}$/;
export const zoneMetaSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(MAX_ZONE_NAME, `At most ${MAX_ZONE_NAME} characters.`),
  use: z.string().regex(ZONE_USE_PATTERN),
  hazard: z.enum(ZONE_HAZARDS).optional(),
  holeTags: z.array(z.enum(HOLE_TAGS)).max(MAX_AREA_HOLES).optional(),
  options: z.record(z.string().max(40), z.union([z.string().max(100), z.number().finite(), z.boolean()])).optional(),
});
export type ZoneMeta = z.infer<typeof zoneMetaSchema>;
export const zoneMarkupSchema = z.object({
  ...base,
  type: z.literal("zone"),
  points: z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS),
  holes: z.array(z.array(pointSchema).min(3).max(MAX_POLYLINE_POINTS)).max(MAX_AREA_HOLES).optional(),
  zone: zoneMetaSchema,
});
export type ZoneMarkup = z.infer<typeof zoneMarkupSchema>;

/** Every markup type (more join with Epic 5). */
export const markupSchema = z.discriminatedUnion("type", [
  lengthMarkupSchema,
  polylengthMarkupSchema,
  areaMarkupSchema,
  countMarkupSchema,
  angleMarkupSchema,
  radiusMarkupSchema,
  diameterMarkupSchema,
  lineMarkupSchema,
  arrowMarkupSchema,
  polylineMarkupSchema,
  polygonMarkupSchema,
  rectangleMarkupSchema,
  ellipseMarkupSchema,
  cloudMarkupSchema,
  textMarkupSchema,
  typewriterMarkupSchema,
  noteMarkupSchema,
  calloutMarkupSchema,
  cloudPlusMarkupSchema,
  penMarkupSchema,
  highlightMarkupSchema,
  eraserMarkupSchema,
  whiteoutMarkupSchema,
  imageMarkupSchema,
  dimensionMarkupSchema,
  underlineMarkupSchema,
  strikethroughMarkupSchema,
  revisionMarkupSchema,
  legendMarkupSchema,
  zoneMarkupSchema,
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
/** Story 5.4: the straight-line markups; Story 5.5: the rectangle, ellipse and cloud. */
export type ShapeMarkup =
  | z.infer<typeof lineMarkupSchema>
  | z.infer<typeof arrowMarkupSchema>
  | z.infer<typeof polylineMarkupSchema>
  | z.infer<typeof polygonMarkupSchema>
  | z.infer<typeof rectangleMarkupSchema>
  | z.infer<typeof ellipseMarkupSchema>
  | z.infer<typeof cloudMarkupSchema>;
export type ImageMarkup = z.infer<typeof imageMarkupSchema>;
export type DimensionMarkup = z.infer<typeof dimensionMarkupSchema>;
/** Story 5.9: an underline or a strikethrough of PDF text. */
export type TextMarkMarkup = z.infer<typeof underlineMarkupSchema> | z.infer<typeof strikethroughMarkupSchema>;
export function isTextMarkMarkup(m: Markup): m is TextMarkMarkup {
  return m.type === "underline" || m.type === "strikethrough";
}
/** Story 5.7: the freehand strokes. */
export type InkMarkup = z.infer<typeof penMarkupSchema> | z.infer<typeof highlightMarkupSchema> | z.infer<typeof eraserMarkupSchema>;
export type WhiteoutMarkup = z.infer<typeof whiteoutMarkupSchema>;
/** Whether `m` is a pen or highlight stroke (Story 5.7). */
export function isInkMarkup(m: Markup): m is InkMarkup {
  return m.type === "pen" || m.type === "highlight" || m.type === "eraser";
}
/** Story 5.6: the text markups. */
export type TextMarkup =
  | z.infer<typeof textMarkupSchema>
  | z.infer<typeof typewriterMarkupSchema>
  | z.infer<typeof noteMarkupSchema>
  | z.infer<typeof calloutMarkupSchema>
  | z.infer<typeof cloudPlusMarkupSchema>;
const TEXT_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>(["text", "typewriter", "note", "callout", "cloudplus"]);
/** Whether `m` carries text (Story 5.6). */
export function isTextMarkup(m: Markup): m is TextMarkup {
  return TEXT_TYPES.has(m.type);
}
const MEASURE_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>(["length", "polylength", "area", "count", "angle", "radius", "diameter"]);
/** Whether `m` is a measurement (it has a caption and a value). */
export function isMeasureMarkup(m: Markup): m is MeasureMarkup {
  return MEASURE_TYPES.has(m.type);
}

/** Revu's default measurement style: red, 1 pt, 10 pt captions. */
export const DEFAULT_MEASURE_STYLE: MarkupStyle = { color: "#ff0000", width: 1, fontSize: 10 };
/** Story 5.4 (D5): the markups' style until Properties changes it (5.5 D5: no fill, opacity 1). */
export const DEFAULT_MARKUP_STYLE: MarkupStyle = { color: "#ff0000", width: 1, fontSize: 10 };
/** Story 5.7 (D1): a highlight's style: yellow, 12 pt, 40 % opacity (multiplied over the sheet). */
export const DEFAULT_HIGHLIGHT_STYLE: MarkupStyle = { color: "#ffff00", width: 12, fontSize: 10, opacity: 0.4 };
/** Story 5.11 (D2): a white-out's and an eraser's style: the sheet's white, a 10 pt brush. */
export const DEFAULT_COVER_STYLE: MarkupStyle = { color: COVER_COLOR, width: 10, fontSize: 10 };
