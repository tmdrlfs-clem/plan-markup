// Icons lucide does not have, drawn in its style (24 × 24, 2 px round strokes).

import { createLucideIcon } from "lucide-react";

/** The Arc markup: a quarter arc with its end points. */
export const ArcIcon = createLucideIcon("arc", [
  ["path", { d: "M4 20A16 16 0 0 1 20 4", key: "arc" }],
  ["circle", { cx: "4", cy: "20", r: "1.5", key: "a" }],
  ["circle", { cx: "20", cy: "4", r: "1.5", key: "b" }],
]);

/** Text highlight: a T over a highlighter bar. */
export const TextHighlightIcon = createLucideIcon("text-highlight", [
  ["path", { d: "M6 4h12", key: "top" }],
  ["path", { d: "M12 4v11", key: "stem" }],
  ["rect", { x: "3", y: "17", width: "18", height: "4", rx: "1", key: "bar" }],
]);

/** Squiggly underline: a T over a wave. */
export const SquigglyIcon = createLucideIcon("squiggly", [
  ["path", { d: "M6 3h12", key: "top" }],
  ["path", { d: "M12 3v12", key: "stem" }],
  ["path", { d: "M3 20l3-2 3 2 3-2 3 2 3-2 3 2", key: "wave" }],
]);
