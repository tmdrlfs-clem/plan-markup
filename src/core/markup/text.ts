// Text markup geometry (Story 5.6, FR31). Framework-free.
//
// A text box, a typewriter, a callout's and a Cloud+'s text sit in a box of
// four corners whose order carries the text's direction: p0→p1 along the
// lines, p0→p3 down them. The order comes from the screen when the markup is
// made (orientBox), so text reads upright on a sheet shown rotated, and the
// point transforms of Story 5.2 keep it. A callout's leader runs from its
// box's nearer side to its tip; a Cloud+'s from its box to the cloud's
// nearest corner. Wrapping is measured by the caller (a canvas, or an
// estimate where there is none).

import type { Markup, TextMarkup } from "@/core/schema/markup";

export type Point = { x: number; y: number };

/** Story 5.6 (D7): a note's icon side in points (page units). */
export const NOTE_PT = 16;
/** Story 5.6 (D1): the padding inside a text box, in points (a typewriter has none). */
export const TEXT_PAD_PT = 3;
/** Story 5.6 (D3): a callout's or Cloud+'s box width from its click, in points. */
export const TEXT_BOX_WIDTH_PT = 144;
/** Line spacing in font sizes (the measurement captions' too). */
export const TEXT_LINE_HEIGHT = 1.15;

/** The four corners of a markup's text box (a note has none). */
export function textBoxOf(m: TextMarkup): readonly Point[] | null {
  switch (m.type) {
    case "text":
    case "typewriter":
      return m.points;
    case "callout":
      return m.points.slice(0, 4);
    case "cloudplus":
      return m.points.slice(-4);
    default:
      return null;
  }
}

/** A Cloud+'s cloud corners. */
export function cloudRingOf(m: Extract<Markup, { type: "cloudplus" }>): Point[] {
  return m.points.slice(0, -4);
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The middles of a box's left (p0–p3) and right (p1–p2) sides. */
function sideMiddles(box: readonly Point[]): [Point, Point] {
  return [mid(box[0], box[3]), mid(box[1], box[2])];
}

/** The leader from the box's side nearer `to`, to `to`. */
export function leaderTo(box: readonly Point[], to: Point): [Point, Point] {
  const [left, right] = sideMiddles(box);
  return [dist(left, to) <= dist(right, to) ? left : right, to];
}

/** A callout's leader (box side to tip) or a Cloud+'s (box side to the cloud's nearest corner); null for the others. */
export function leaderOf(m: TextMarkup): [Point, Point] | null {
  if (m.type === "callout") return leaderTo(m.points.slice(0, 4), m.points[4]);
  if (m.type !== "cloudplus") return null;
  return leaderToRing(m.points.slice(-4), cloudRingOf(m));
}

/** The shortest leader from a box's side middles to a ring's corners. */
export function leaderToRing(box: readonly Point[], ring: readonly Point[]): [Point, Point] {
  let best: [Point, Point] = [box[0], ring[0]];
  let d = Infinity;
  for (const side of sideMiddles(box)) {
    for (const q of ring) {
      const e = dist(side, q);
      if (e < d) {
        d = e;
        best = [side, q];
      }
    }
  }
  return best;
}

/**
 * The four corners of the axis-aligned (user space) box from `a` to `b`, ordered from the
 * screen's top left clockwise (screen y grows down), `toScreen` mapping user space to it.
 */
export function orientBox(a: Point, b: Point, toScreen: (p: Point) => Point): [Point, Point, Point, Point] {
  const corners = [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
  const s = corners.map(toScreen);
  const order = [0, 1, 2, 3];
  const topLeft = order.reduce((i, j) => (s[j].x + s[j].y < s[i].x + s[i].y ? j : i));
  const bottomRight = (topLeft + 2) % 4;
  const others = order.filter((i) => i !== topLeft && i !== bottomRight);
  // Of the other two, the top right is further right and up.
  const [topRight, bottomLeft] = s[others[0]].x - s[others[0]].y >= s[others[1]].x - s[others[1]].y ? others : [others[1], others[0]];
  return [corners[topLeft], corners[topRight], corners[bottomRight], corners[bottomLeft]];
}

/** The user space unit vectors pointing right and down on screen at `at`. */
export function screenAxes(at: Point, toScreen: (p: Point) => Point): { right: Point; down: Point } {
  const [p0, p1, , p3] = orientBox(at, { x: at.x + 1, y: at.y + 1 }, toScreen);
  return { right: { x: p1.x - p0.x, y: p1.y - p0.y }, down: { x: p3.x - p0.x, y: p3.y - p0.y } };
}

/** The box with top left corner `origin`, `width` along `right` and `height` along `down` (unit vectors). */
export function boxFrom(origin: Point, right: Point, down: Point, width: number, height: number): [Point, Point, Point, Point] {
  const p1 = { x: origin.x + right.x * width, y: origin.y + right.y * width };
  return [
    { x: origin.x, y: origin.y },
    p1,
    { x: p1.x + down.x * height, y: p1.y + down.y * height },
    { x: origin.x + down.x * height, y: origin.y + down.y * height },
  ];
}

/** The box made at least `height` tall, its bottom side moved down (p0→p3); never shorter. */
export function growBox(box: readonly Point[], height: number): [Point, Point, Point, Point] {
  const [p0, p1, p2, p3] = box;
  const now = dist(p0, p3);
  if (now >= height || now < 1e-9) return [p0, p1, p2, p3];
  const k = height / now;
  return [p0, p1, { x: p1.x + (p2.x - p1.x) * k, y: p1.y + (p2.y - p1.y) * k }, { x: p0.x + (p3.x - p0.x) * k, y: p0.y + (p3.y - p0.y) * k }];
}

/**
 * The text's lines: its line breaks, and with `maxWidth` the words wrapped to it (a word
 * longer than the width is broken between characters). `measure` gives a string's width.
 */
export function wrapText(text: string, maxWidth: number | null, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (maxWidth === null || measure(paragraph) <= maxWidth) {
      out.push(paragraph);
      continue;
    }
    let line = "";
    let wrapped = false;
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === "") continue;
      // The spaces where a line wrapped start no line.
      if (wrapped && line === "" && /^\s+$/.test(word)) continue;
      const next = line + word;
      if (measure(next) <= maxWidth || line === "") {
        line = next;
      } else {
        out.push(line.trimEnd());
        wrapped = true;
        line = /^\s+$/.test(word) ? "" : word;
      }
      // A word wider than the line on its own: broken between characters.
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
