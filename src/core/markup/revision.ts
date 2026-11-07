// Story 7.7 (FR37, UX-DR27): the revision stamp's content and layout (pure).
//
// A stamp is a box with a header row (the revision on the left, its date on
// the right) over its description and its author. A new stamp takes the
// revision after the document's latest one (A → B, Z → AA, 3 → 4, P1 → P2),
// today's date, the signed-in user's name and "As-built".

import type { Point } from "./geometry";
import { boxFrom, screenAxes } from "./text";
import { DEFAULT_MARKUP_STYLE, type Markup, type MarkupStyle, type RevisionMarkup, type RevisionMeta } from "../schema/markup";

/** The new stamp's size in points (it scales with the drawing, like a text box). */
export const REVISION_SIZE_PT = { width: 180, height: 54 };
export const DEFAULT_REVISION_DESCRIPTION = "As-built";
/** A new stamp's style: the markup style, a white fill (it is read over the drawing). */
export const DEFAULT_REVISION_STYLE: MarkupStyle = { ...DEFAULT_MARKUP_STYLE, fill: "#ffffff" };

/** The revision after `prev`: its last letters or digits counted on (null: the first, "A"). */
export function nextRevision(prev: string | null): string {
  const r = prev?.trim();
  if (!r) return "A";
  const digits = /^(.*?)(\d+)$/.exec(r);
  if (digits) {
    const n = String(Number(digits[2]) + 1).padStart(digits[2].length, "0");
    return `${digits[1]}${n}`.slice(0, 10);
  }
  const letters = /^(.*?)([A-Za-z]+)$/.exec(r);
  if (letters) {
    const upper = letters[2] === letters[2].toUpperCase();
    const chars = letters[2].toUpperCase().split("");
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === "Z") chars[i--] = "A";
    if (i < 0) chars.unshift("A");
    else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    const next = chars.join("");
    return `${letters[1]}${upper ? next : next.toLowerCase()}`.slice(0, 10);
  }
  return r;
}

/** The latest revision among `markups` (by creation time; null when there is none). */
export function latestRevision(markups: readonly Markup[]): string | null {
  let latest: RevisionMarkup | null = null;
  for (const m of markups) if (m.type === "revision" && (!latest || m.createdAt >= latest.createdAt)) latest = m;
  return latest?.revision.rev ?? null;
}

/** Today as YYYY-MM-DD in the local time zone. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** What a new stamp shows. */
export function newRevisionMeta(markups: readonly Markup[], author: string, now: Date = new Date()): RevisionMeta {
  return { rev: nextRevision(latestRevision(markups)), description: DEFAULT_REVISION_DESCRIPTION, author: author.slice(0, 100), date: localDate(now) };
}

/** A stamp centred at `at` on page `pageId`, upright on screen (`toScreen`), `REVISION_SIZE_PT` over `userUnit`. */
export function revisionMarkupAt(
  meta: RevisionMeta,
  at: Point,
  pageId: string,
  toScreen: (p: Point) => Point,
  userUnit: number,
  id: string,
  createdAt: string,
): RevisionMarkup {
  const unit = userUnit > 0 ? userUnit : 1;
  const width = REVISION_SIZE_PT.width / unit;
  const height = REVISION_SIZE_PT.height / unit;
  const { right, down } = screenAxes(at, toScreen);
  const origin = { x: at.x - (right.x * width + down.x * height) / 2, y: at.y - (right.y * width + down.y * height) / 2 };
  return { id, pageId, createdAt, style: DEFAULT_REVISION_STYLE, type: "revision", points: boxFrom(origin, right, down, width, height), revision: meta };
}

/** The stamp's text: the header's left and right, then its body lines. */
export function revisionText(meta: RevisionMeta): { left: string; right: string; lines: string[] } {
  return { left: `Rev ${meta.rev}`, right: meta.date, lines: [meta.description, meta.author].filter((l) => l.trim() !== "") };
}

/** Layer 2's list entry. */
export function revisionLabel(meta: RevisionMeta): string {
  return `Revision ${meta.rev}${meta.description ? ` — ${meta.description}` : ""}`;
}
