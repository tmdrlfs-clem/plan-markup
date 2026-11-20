// The text format bar's format for the next text markup (text-format-bar.tsx).

import { createStore } from "zustand/vanilla";

import { DEFAULT_MARKUP_STYLE, type MarkupStyle } from "@/core/schema/markup";

/** The format the next text is made with (the bar with no text selected). */
export type TextFormat = Pick<MarkupStyle, "font" | "bold" | "italic" | "underline" | "strike" | "align" | "fontSize" | "color">;
export const textFormatStore = createStore<TextFormat>(() => ({ fontSize: DEFAULT_MARKUP_STYLE.fontSize, color: DEFAULT_MARKUP_STYLE.color }));

/** The style a new text markup starts with: the markup default with the bar's format. */
export function newTextStyle(): MarkupStyle {
  const f = textFormatStore.getState();
  const style: MarkupStyle = { ...DEFAULT_MARKUP_STYLE, fontSize: f.fontSize, color: f.color };
  if (f.font) style.font = f.font;
  if (f.bold) style.bold = true;
  if (f.italic) style.italic = true;
  if (f.underline) style.underline = true;
  if (f.strike) style.strike = true;
  if (f.align) style.align = f.align;
  return style;
}

