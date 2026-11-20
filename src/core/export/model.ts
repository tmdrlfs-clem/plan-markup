// The export engine's input model (framework-free, plain data). Geometry is in
// PDF user space of the target page (points, y up), as stored by the app.

import type { FontFamily } from "../pdf/std-fonts";
import type { Box, Pt } from "../pdf/content";

export type { Box, Pt };

export type Rgb = [number, number, number];

export type LineEndingStyle =
  | "None"
  | "OpenArrow"
  | "ClosedArrow"
  | "ROpenArrow"
  | "RClosedArrow"
  | "Butt"
  | "Slash"
  | "Square"
  | "Diamond"
  | "Circle";

/** Page calibration: user-space points → real-world units (FR36). */
export type Calibration = {
  /** Scale text shown to the user and written to /Measure /R, e.g. "1:100". */
  label: string;
  /** Real-world length unit, e.g. "m" or "mm". */
  unit: string;
  /** Real-world units per PDF point. 1:100 in metres: 0.0254 / 72 × 100. */
  unitsPerPoint: number;
  /** Decimal places shown for lengths and areas. */
  decimals: number;
};

export type Layer = { id: string; name: string; visible: boolean };

/** Device metadata carried by a device stamp (written under /PM_Device). */
export type DeviceMeta = {
  kind: string;
  model: string;
  kFactor?: number;
  temperatureC?: number;
  orientation?: string;
};

export type MarkupBase = {
  /** Stable id; written as /NM. */
  id: string;
  subject: string;
  author: string;
  /** Stroke colour; omitted = no stroke. */
  color?: Rgb;
  /** Interior colour; omitted = no fill. */
  fill?: Rgb;
  /** 0..1 constant opacity (/CA), default 1. */
  opacity?: number;
  /** Stroke width in pt, default 1. */
  width?: number;
  dash?: number[];
  layer?: string;
  /** Group id: markups sharing it form one group; the first in the list is the root. */
  group?: string;
  /** Free comment text (/Contents for non-text, non-measurement markups). */
  comment?: string;
  /** Story 8.1: a measurement's value as the app shows it (its unit and precision); overrides the computed text. */
  valueText?: string;
};

/** A text's face and its format bar settings (absent: Helvetica, left, plain). */
export type TextStyle = {
  fontSize: number;
  textColor: Rgb;
  font?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "center" | "right";
};

export type Markup = MarkupBase &
  (
    | { type: "line"; from: Pt; to: Pt }
    | { type: "arrow"; from: Pt; to: Pt; endings: [LineEndingStyle, LineEndingStyle] }
    | { type: "polyline"; points: Pt[] }
    | { type: "polygon"; points: Pt[] }
    | { type: "rectangle"; rect: Box }
    | { type: "ellipse"; rect: Box }
    | { type: "arc"; center: Pt; radius: number; startDeg: number; sweepDeg: number }
    | { type: "cloud"; points: Pt[]; intensity: number }
    | ({
        type: "cloudPlus";
        points: Pt[];
        intensity: number;
        textRect: Box;
        text: string;
        /** Leader from the cloud edge to the text box: 2 or 3 points, first at the cloud. */
        leader: Pt[];
      } & TextStyle)
    | ({ type: "callout"; textRect: Box; text: string; leader: Pt[] } & TextStyle)
    | ({ type: "textBox"; rect: Box; text: string } & TextStyle)
    | ({ type: "typewriter"; at: Pt; text: string } & TextStyle)
    | { type: "note"; at: Pt; text: string }
    /** Insert text: a caret, its tip at `at`, and the text to insert. */
    | { type: "caret"; at: Pt; text: string }
    | { type: "highlight" | "underline" | "strikeout" | "squiggly"; quads: Box[] }
    | { type: "pen"; strokes: Pt[][] }
    | { type: "stamp"; rect: Box; label: string }
    | { type: "imageStamp"; rect: Box; image: { width: number; height: number; rgb: Uint8Array; alpha?: Uint8Array } }
    | { type: "flag"; rect: Box }
    | { type: "deviceStamp"; center: Pt; size: number; device: DeviceMeta }
    | { type: "hyperlink"; rect: Box; uri: string }
    | { type: "whiteout"; rect: Box }
    | { type: "dimension"; from: Pt; to: Pt; leader: number; leaderExtension: number }
    | { type: "length"; from: Pt; to: Pt }
    | { type: "polylength"; points: Pt[] }
    | { type: "perimeter"; points: Pt[] }
    | { type: "area"; points: Pt[] }
    | { type: "dynamicFill"; points: Pt[] }
    | { type: "count"; points: Pt[] }
    | { type: "angle"; vertex: Pt; a: Pt; b: Pt }
    | { type: "radius" | "diameter"; center: Pt; radius: number; angleDeg: number }
  );

export type MarkupType = Markup["type"];

/** Types whose value depends on the calibration (they carry /Measure). */
export const CALIBRATED_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>([
  "dimension",
  "length",
  "polylength",
  "perimeter",
  "area",
  "dynamicFill",
  "radius",
  "diameter",
]);

/** Types that are measurements (shown in the takeoff) even without units. */
export const MEASUREMENT_TYPES: ReadonlySet<MarkupType> = new Set<MarkupType>([
  ...CALIBRATED_TYPES,
  "count",
  "angle",
]);

export type ExportDocument = {
  calibration: Calibration;
  layers: Layer[];
  markups: Markup[];
};
