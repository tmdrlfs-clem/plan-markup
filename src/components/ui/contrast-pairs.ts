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
  { kind: "ui", fg: "--border-strong", bg: "--surface-1", label: "border-strong on surface-1" },
  { kind: "ui", fg: "--accent", bg: "--surface-0", label: "accent on surface-0" },
  { kind: "ui", fg: "--accent", bg: "--surface-1", label: "accent on surface-1" },
  { kind: "ui", fg: "--warning", bg: "--surface-1", label: "warning icon on surface-1" },
  { kind: "ui", fg: "--danger", bg: "--surface-1", label: "danger icon on surface-1" },
  { kind: "ui", fg: "--success", bg: "--surface-1", label: "success icon on surface-1" },
  { kind: "ui", fg: "--info", bg: "--surface-1", label: "info icon on surface-1" },
  { kind: "ui", fg: "--canvas-snap", bg: CANVAS_SHEET, label: "canvas snap glyph on sheet" },
  { kind: "ui", fg: "--canvas-danger", bg: CANVAS_SHEET, label: "canvas rule-break marker on sheet" },
];
