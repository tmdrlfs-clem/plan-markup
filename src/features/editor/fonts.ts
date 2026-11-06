// Story 7.5 (founder decision 3): the bundled faces a markup's text can ask for.
// Carlito (SIL OFL 1.1, metric-compatible with Calibri; public/fonts/carlito)
// is loaded on first use; until it is, text draws in the app's face and the
// markup layer is painted again once it has loaded.

import type { Markup, MarkupStyle } from "@/core/schema/markup";
import { notifyMarkups } from "@/features/viewer";

export const CARLITO_FAMILY = "Carlito";

/** Google Fonts' latin and latin-ext ranges (the two files bundled). */
const CARLITO_FACES = [
  {
    file: "/fonts/carlito/carlito-latin-400-normal.woff2",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    file: "/fonts/carlito/carlito-latin-ext-400-normal.woff2",
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
];

let carlito: Promise<void> | null = null;

/** Loads Carlito once (a no-op where there is no FontFace, as in tests); resolves either way. */
export function loadCarlito(): Promise<void> {
  if (carlito) return carlito;
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    carlito = Promise.resolve();
    return carlito;
  }
  carlito = Promise.all(
    CARLITO_FACES.map(async ({ file, unicodeRange }) => {
      const face = new FontFace(CARLITO_FAMILY, `url(${file}) format("woff2")`, { unicodeRange, display: "swap" });
      document.fonts.add(await face.load());
    }),
  )
    .then(() => notifyMarkups({}))
    .catch(() => undefined);
  return carlito;
}

/** The CSS font family `style`'s text draws in (`fallback`: the app's face). */
export function fontFamilyOf(style: Pick<MarkupStyle, "font">, fallback: string): string {
  if (style.font !== "carlito") return fallback;
  void loadCarlito();
  return `${CARLITO_FAMILY}, ${fallback}`;
}

/** Resolves once the faces `markups` ask for are loaded (painters outside the layer: a tool's preview). */
export function loadMarkupFonts(markups: readonly Pick<Markup, "style">[]): Promise<void> {
  return markups.some((m) => m.style.font === "carlito") ? loadCarlito() : Promise.resolve();
}
