// Arc markup (Bluebeam toolbar set, founder 2026-11-21). Framework-free.
//
// An arc is stored as three points in user space: its start, a point it passes
// through, and its end. It is drawn, hit and exported as the circular arc
// through them, sampled into short chords; three points in a line make a
// straight line.

import { circleThrough } from "@/core/measure/circle";

type Point = { x: number; y: number };

/** Chords per full turn when an arc is sampled (an arc of a quarter turn gets 16). */
const CHORDS_PER_TURN = 64;
const MIN_CHORDS = 4;

/**
 * The arc from `start` through `through` to `end`, as points along it
 * (`start` first, `end` last); the straight line when the three are in a line.
 */
export function arcPoints(start: Point, through: Point, end: Point): Point[] {
  const circle = circleThrough(start, through, end);
  if (!circle) return [start, end];
  const { centre, radius } = circle;
  const angle = (p: Point) => Math.atan2(p.y - centre.y, p.x - centre.x);
  const a0 = angle(start);
  const am = angle(through);
  const a1 = angle(end);
  const turn = 2 * Math.PI;
  // Counter-clockwise sweeps from a0 to a1 and to am; the arc passes through `through`.
  const norm = (a: number) => ((a % turn) + turn) % turn;
  const ccwEnd = norm(a1 - a0);
  const ccwMid = norm(am - a0);
  const sweep = ccwMid <= ccwEnd ? ccwEnd : ccwEnd - turn;
  const n = Math.max(MIN_CHORDS, Math.ceil((Math.abs(sweep) / turn) * CHORDS_PER_TURN));
  const out: Point[] = [start];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) });
  }
  out.push(end);
  return out;
}

/** The three stored points of an arc drawn by clicking its start, its end, then a point on its bulge. */
export function arcFromClicks(start: Point, end: Point, bulge: Point): [Point, Point, Point] {
  return [start, bulge, end];
}
