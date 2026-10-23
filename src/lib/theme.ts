// The appearance themes (Story 3.8, FR69, UX-DR3). Shared by the server (the
// profile, the setTheme action) and the client (the workspace, the canvas
// token bridge). No DOM, no framework.
import { z } from "zod";

export const THEMES = ["blueprint", "daylight", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

/** Blueprint is the default (and the only theme of sign-in and PendingActivation). */
export const DEFAULT_THEME: Theme = "blueprint";

/** What each theme is called in the UI. */
export const THEME_LABELS: Readonly<Record<Theme, string>> = {
  blueprint: "Blueprint",
  daylight: "Daylight",
  contrast: "High contrast",
};

export const ThemeSchema = z.enum(THEMES);

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
