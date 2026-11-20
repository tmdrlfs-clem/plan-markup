"use client";

// The text format bar (Bluebeam toolbar set, founder 2026-11-21): the face,
// size, colour, bold, italic, underline, strikethrough and alignment of text.
// With text markups selected (text box, typewriter, callout, Cloud+) a change
// applies to them, one undo step (as Properties); with none, it sets how the
// next text is made.

import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Strikethrough, Underline } from "lucide-react";
import { useStore } from "zustand";

import { Toolbar, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem } from "@/components/ui/toolbar";
import { ToggleButton } from "@/components/ui/toggle-button";
import { hasTextFormat, sharedValue, type PropertyChange } from "@/core/markup/properties";
import type { Markup, MarkupStyle } from "@/core/schema/markup";
import { hasDocument, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf } from "./editor-store";
import { changeProperties } from "./properties";
import { textFormatStore, type TextFormat } from "./text-format";

export const FONT_OPTIONS: readonly { value: "" | NonNullable<MarkupStyle["font"]>; label: string }[] = [
  { value: "", label: "Sans (Helvetica)" },
  { value: "carlito", label: "Carlito (Calibri)" },
  { value: "serif", label: "Serif (Times)" },
  { value: "mono", label: "Mono (Courier)" },
];
const SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const MIXED = "mixed";

const controlClasses =
  "h-7 rounded-sm border border-border bg-surface-1 px-1 text-ws-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

/** Applies `change` to the selected text, or to the next text's format when none is selected. */
function useApply(documentId: string | null, targets: readonly Markup[]) {
  return (change: PropertyChange) => {
    if (documentId && targets.length > 0) {
      changeProperties(documentId, targets, change);
      return;
    }
    const next: Partial<TextFormat> = {};
    if (change.font !== undefined) next.font = change.font ?? undefined;
    if (change.align !== undefined) next.align = change.align ?? undefined;
    for (const k of ["bold", "italic", "underline", "strike"] as const) if (change[k] !== undefined) next[k] = change[k] || undefined;
    if (change.fontSize !== undefined) next.fontSize = change.fontSize;
    if (change.color !== undefined) next.color = change.color;
    textFormatStore.setState(next);
  };
}

export function TextFormatBar() {
  const documentId = useStore(viewerStore, (s) => (hasDocument(s) ? s.documentId : null));
  const all = useStore(editorStore, (s) => markupsOf(s, documentId));
  const ids = useStore(editorStore, (s) => s.selection.ids);
  const defaults = useStore(textFormatStore);
  const chosen = new Set(ids);
  const targets = all.filter((m) => chosen.has(m.id) && hasTextFormat(m));
  const apply = useApply(documentId, targets);
  const disabled = !documentId;

  const value = <T,>(get: (s: TextFormat) => T): T | typeof MIXED =>
    targets.length > 0 ? sharedValue<T | typeof MIXED>(targets, (m) => get(m.style), MIXED) : get(defaults);
  const font = value((s) => s.font ?? "");
  const size = value((s) => s.fontSize);
  const color = value((s) => s.color.toLowerCase());
  const align = value((s) => s.align ?? "left");
  const on = (k: "bold" | "italic" | "underline" | "strike") => value((s) => !!s[k]) === true;
  const scope = targets.length > 0 ? `${targets.length} selected text markup${targets.length === 1 ? "" : "s"}` : "the next text";

  return (
    <Toolbar aria-label="Text format" className="h-9 border-b border-border" data-testid="text-format-bar">
      <select
        aria-label="Font"
        title={`Font of ${scope}`}
        className={`${controlClasses} w-40`}
        disabled={disabled}
        value={font === MIXED ? MIXED : font}
        onChange={(e) => e.target.value !== MIXED && apply({ font: (e.target.value || null) as PropertyChange["font"] })}
      >
        {font === MIXED ? <option value={MIXED}>Mixed</option> : null}
        {FONT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Font size"
        title={`Font size of ${scope} (pt)`}
        className={`${controlClasses} w-16`}
        disabled={disabled}
        value={size === MIXED ? MIXED : String(size)}
        onChange={(e) => e.target.value !== MIXED && apply({ fontSize: Number(e.target.value) })}
      >
        {size === MIXED ? <option value={MIXED}>–</option> : null}
        {size !== MIXED && !SIZES.includes(size) ? <option value={String(size)}>{size}</option> : null}
        {SIZES.map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </select>
      <input
        type="color"
        aria-label="Text colour"
        title={`Colour of ${scope}`}
        className="h-7 w-8 cursor-pointer rounded-sm border border-border bg-surface-1 p-0.5 disabled:opacity-50"
        disabled={disabled}
        value={color === MIXED ? "#000000" : color}
        onChange={(e) => apply({ color: e.target.value })}
      />
      <ToolbarSeparator orientation="vertical" />
      <ToggleButton label="Bold" icon={Bold} disabled={disabled} disabledReason="Open a drawing first" pressed={on("bold")} onPressedChange={(p) => apply({ bold: p })} />
      <ToggleButton label="Italic" icon={Italic} disabled={disabled} disabledReason="Open a drawing first" pressed={on("italic")} onPressedChange={(p) => apply({ italic: p })} />
      <ToggleButton label="Underline" icon={Underline} disabled={disabled} disabledReason="Open a drawing first" pressed={on("underline")} onPressedChange={(p) => apply({ underline: p })} />
      <ToggleButton label="Strikethrough" icon={Strikethrough} disabled={disabled} disabledReason="Open a drawing first" pressed={on("strike")} onPressedChange={(p) => apply({ strike: p })} />
      <ToolbarSeparator orientation="vertical" />
      <ToolbarToggleGroup
        type="single"
        aria-label="Text alignment"
        value={align === MIXED ? "" : align}
        onValueChange={(v) => v && apply({ align: v === "left" ? null : (v as "center" | "right") })}
      >
        <ToolbarToggleItem value="left" label="Align left" icon={AlignLeft} disabled={disabled} disabledReason="Open a drawing first" />
        <ToolbarToggleItem value="center" label="Align centre" icon={AlignCenter} disabled={disabled} disabledReason="Open a drawing first" />
        <ToolbarToggleItem value="right" label="Align right" icon={AlignRight} disabled={disabled} disabledReason="Open a drawing first" />
      </ToolbarToggleGroup>
      <span className="ml-2 truncate text-ws-sm text-muted">{documentId ? `Applies to ${scope}` : ""}</span>
    </Toolbar>
  );
}
