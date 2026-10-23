// Single source of truth for the variables every theme block must define.

export const THEME_NAMES = ["blueprint", "daylight", "contrast"] as const;

export const REQUIRED_THEME_VARS = [
  "--surface-0",
  "--surface-1",
  "--surface-2",
  "--surface-3",
  "--border",
  "--border-strong",
  "--text",
  "--text-muted",
  "--accent",
  "--accent-fg",
  "--accent-soft",
  "--warning",
  "--warning-text",
  "--danger",
  "--success",
  "--info",
  "--shadow-color",
  "--canvas-halo",
  "--canvas-selection-outline",
  "--canvas-snap",
  "--canvas-danger",
  "--canvas-coverage-fill",
  "--canvas-coverage-outline",
  "--canvas-zone",
  "--canvas-search-hit",
  "--canvas-search-current",
  "--canvas-search-outline",
  "--canvas-handle-size",
] as const;

export type RequiredThemeVar = (typeof REQUIRED_THEME_VARS)[number];
