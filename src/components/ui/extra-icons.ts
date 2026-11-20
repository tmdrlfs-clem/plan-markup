// Icons lucide does not have, drawn in its style (24 × 24, 2 px round strokes).

import { createLucideIcon } from "lucide-react";

/** The Arc markup: a quarter arc with its end points. */
export const ArcIcon = createLucideIcon("arc", [
  ["path", { d: "M4 20A16 16 0 0 1 20 4", key: "arc" }],
  ["circle", { cx: "4", cy: "20", r: "1.5", key: "a" }],
  ["circle", { cx: "20", cy: "4", r: "1.5", key: "b" }],
]);
