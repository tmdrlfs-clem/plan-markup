import { describe, expect, it } from "vitest";

import { constrainPoint, constraintFor, projectOnto } from "./constrain";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};
// User space (y up) to screen (y down), unrotated: x' = x, y' = -y.
const PLAIN = [1, 0, 0, -1] as const;
// The view turned a quarter (or /Rotate 90): user x goes down the screen, user y goes right.
const QUARTER = [0, 1, 1, 0] as const;

describe("Shift constraint", () => {
  it("holds a nearly horizontal move horizontal and a nearly 45° move at 45°", () => {
    close(constrainPoint({ x: 0, y: 0 }, { x: 100, y: 7 }, PLAIN), { x: 100, y: 0 });
    close(constrainPoint({ x: 0, y: 0 }, { x: 100, y: 90 }, PLAIN), { x: 95, y: 95 });
  });

  it("is horizontal on screen when the view is rotated: user space y then", () => {
    close(constrainPoint({ x: 10, y: 10 }, { x: 13, y: 110 }, QUARTER), { x: 10, y: 110 });
  });

  it("projects a snap candidate onto the constraint line; no constraint without a move", () => {
    const c = constraintFor({ x: 0, y: 0 }, { x: 50, y: 2 }, PLAIN)!;
    close(projectOnto(c, { x: 30, y: 4 }), { x: 30, y: 0 });
    expect(constraintFor({ x: 1, y: 1 }, { x: 1, y: 1 }, PLAIN)).toBeNull();
    close(constrainPoint({ x: 1, y: 1 }, { x: 1, y: 1 }, PLAIN), { x: 1, y: 1 });
  });
});
