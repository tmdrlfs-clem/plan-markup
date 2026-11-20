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

/** Insert text: a caret under a text line. */
export const InsertTextIcon = createLucideIcon("insert-text", [
  ["path", { d: "M4 6h16", key: "line" }],
  ["path", { d: "M7 20l5-9 5 9", key: "caret" }],
]);

/** Replace text: struck text with a caret above. */
export const ReplaceTextIcon = createLucideIcon("replace-text", [
  ["path", { d: "M3 16h18", key: "strike" }],
  ["path", { d: "M6 12v8M18 12v8", key: "ends" }],
  ["path", { d: "M8 9l4-6 4 6", key: "caret" }],
]);

/** Text box with a cloud border: a box with a wavy bottom edge and text lines. */
export const TextCloudIcon = createLucideIcon("text-cloud", [
  ["path", { d: "M4 16V4h16v12", key: "box" }],
  ["path", { d: "M4 16c1.3 2 2.7 2 4 0s2.7-2 4 0 2.7 2 4 0 2.7-2 4 0", key: "wave" }],
  ["path", { d: "M8 8h8M8 12h5", key: "lines" }],
]);
