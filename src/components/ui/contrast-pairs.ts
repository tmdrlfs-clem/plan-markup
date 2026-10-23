// Contrast pairs checked for every theme (see Story 1.4 -> Contrast pairs).

export type PairKind = "text" | "ui";

export const MIN_RATIO: Record<PairKind, number> = { text: 4.5, ui: 3 };

/** A token name (`--x`) or a literal hex colour. */
export interface ContrastPair {
  kind: PairKind;
  fg: string;
  bg: string;
  label: string;
}

const SURFACES = ["--surface-0", "--surface-1", "--surface-2", "--surface-3"];

export const CANVAS_SHEET = "#FFFFFF";

export const CONTRAST_PAIRS: ContrastPair[] = [
  ...SURFACES.map(
    (s): ContrastPair => ({
      kind: "text",
      fg: "--text",
      bg: s,
      label: `text on ${s}`,
    }),
  ),
  ...["--surface-1", "--surface-2"].map(
    (s): ContrastPair => ({
      kind: "text",
      fg: "--text-muted",
      bg: s,
      label: `text-muted on ${s}`,
    }),
  ),
  { kind: "text", fg: "--accent-fg", bg: "--accent", label: "accent-fg on accent" },
  { kind: "text", fg: "--danger", bg: "--surface-1", label: "danger text on surface-1" },
  { kind: "text", fg: "--success", bg: "--surface-1", label: "success text on surface-1" },
  { kind: "text", fg: "--info", bg: "--surface-1", label: "info text on surface-1" },
  { kind: "text", fg: "--warning-text", bg: "--surface-1", label: "warning-text on surface-1" },
  { kind: "text", fg: "--accent-fg", bg: "--danger", label: "accent-fg on danger fill" },
  { kind: "text", fg: "--success", bg: "--surface-2", label: "success text on surface-2" },
  { kind: "text", fg: "--info", bg: "--surface-2", label: "info text on surface-2" },
  { kind: "text", fg: "--warning-text", bg: "--surface-2", label: "warning-text on surface-2" },
  { kind: "text", fg: "--text-muted", bg: "--surface-3", label: "text-muted on surface-3" },
  { kind: "ui", fg: "--border-strong", bg: "--surface-1", label: "border-strong on surface-1" },
  { kind: "ui", fg: "--accent", bg: "--surface-0", label: "accent on surface-0" },
  { kind: "ui", fg: "--accent", bg: "--surface-1", label: "accent on surface-1" },
  { kind: "ui", fg: "--warning", bg: "--surface-1", label: "warning icon on surface-1" },
  { kind: "ui", fg: "--danger", bg: "--surface-1", label: "danger icon on surface-1" },
  { kind: "ui", fg: "--success", bg: "--surface-1", label: "success icon on surface-1" },
  { kind: "ui", fg: "--info", bg: "--surface-1", label: "info icon on surface-1" },
  { kind: "ui", fg: "--canvas-snap", bg: CANVAS_SHEET, label: "canvas snap glyph on sheet" },
  { kind: "ui", fg: "--canvas-danger", bg: CANVAS_SHEET, label: "canvas rule-break marker on sheet" },
  { kind: "ui", fg: "--canvas-search-outline", bg: CANVAS_SHEET, label: "current search hit outline on sheet" },
  // Story 3.8: every canvas overlay against the sheet and the backdrop around it, and the status warnings.
  { kind: "ui", fg: "--canvas-selection-outline", bg: CANVAS_SHEET, label: "selection outline on sheet" },
  { kind: "ui", fg: "--canvas-zoom-rect", bg: CANVAS_SHEET, label: "Zoom tool rubber band on sheet" },
  { kind: "ui", fg: "--canvas-zoom-rect", bg: "--canvas-backdrop", label: "Zoom tool rubber band on the backdrop" },
  { kind: "ui", fg: "--canvas-failed-stroke", bg: "--canvas-failed-fill", label: "failed tile hatch on its box" },
  { kind: "ui", fg: "--canvas-snap", bg: "--canvas-backdrop", label: "canvas snap glyph on the backdrop" },
  { kind: "text", fg: "--warning-text", bg: "--surface-3", label: "warning-text (Scale not set) on surface-3 (hover)" },
  { kind: "ui", fg: "--warning", bg: "--surface-2", label: "warning icon on surface-2 (status bar)" },
  { kind: "ui", fg: "--accent", bg: "--surface-2", label: "accent (pressed toggle, current thumbnail) on surface-2" },
];

/**
 * The current search hit: its outline against its own fill laid over the
 * sheet (a translucent fill keeps the drawing's text readable, so the fill
 * itself is not a 3:1 boundary; the outline is). Story 3.8 AC 5.
 */
export const SEARCH_CURRENT_PAIR = { outline: "--canvas-search-outline", fill: "--canvas-search-current" } as const;
