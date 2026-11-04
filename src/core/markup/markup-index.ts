// A page's markups in an R-tree for hit-testing (Story 5.1, AR15). Framework-free.
//
// Built from a page's markups in drawing order; a hit returns the topmost
// (last drawn) markup whose geometry is within the tolerance.

import RBush from "rbush";

import type { Markup } from "@/core/schema/markup";

import { COUNT_MARKER_PT, hitMarkup, insideLoop, insideRect, markupBounds, type Point, type Rect } from "./geometry";
import { CLOUD_CHORD_PT } from "./shapes";
import { NOTE_PT } from "./text";

type Item = { minX: number; minY: number; maxX: number; maxY: number; markup: Markup; order: number };

export class MarkupIndex {
  private readonly tree = new RBush<Item>();

  constructor(
    readonly markups: readonly Markup[],
    private readonly userUnit = 1,
  ) {
    const unit = userUnit > 0 ? userUnit : 1;
    this.tree.load(
      markups.map((markup, order) => {
        const b = markupBounds(markup);
        // A count's markers reach past their points; a cloud's arcs past its corners' ring (Story 5.5 review R1).
        // Story 5.6: a note's icon past its point, a Cloud+'s arcs. Story 5.7: a stroke's half width.
        const p =
          markup.type === "count"
            ? COUNT_MARKER_PT / unit
            : markup.type === "note"
              ? NOTE_PT / 2 / unit
              : markup.type === "cloud" || markup.type === "cloudplus"
                ? CLOUD_CHORD_PT / 2 / unit
                : markup.type === "pen" || markup.type === "highlight" || markup.type === "eraser"
                  ? markup.style.width / 2 / unit
                  : 0;
        return { minX: b.x - p, minY: b.y - p, maxX: b.x + b.width + p, maxY: b.y + b.height + p, markup, order };
      }),
    );
  }

  /** The topmost markup at `p` within `tol` user units; null when none. */
  hit(p: Point, tol: number): Markup | null {
    const near = this.tree.search({ minX: p.x - tol, minY: p.y - tol, maxX: p.x + tol, maxY: p.y + tol });
    near.sort((a, b) => b.order - a.order);
    return near.find((item) => hitMarkup(item.markup, p, tol, this.userUnit))?.markup ?? null;
  }

  /** The markups wholly inside rectangle `r`, in drawing order. */
  inRect(r: Rect): Markup[] {
    return this.ordered(this.tree.search({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height })).filter((m) => insideRect(m, r));
  }

  /** The markups wholly inside the loop, in drawing order. */
  inLoop(loop: readonly Point[]): Markup[] {
    if (loop.length < 3) return [];
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    return this.ordered(this.tree.search(box)).filter((m) => insideLoop(m, loop));
  }

  private ordered(items: Item[]): Markup[] {
    return items.sort((a, b) => a.order - b.order).map((item) => item.markup);
  }
}
