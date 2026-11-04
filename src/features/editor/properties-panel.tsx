"use client";

// The Properties panel (Story 5.10, FR34, UX-DR22): the selected markups'
// subject, colour, fill, line width, opacity, text size and text, a dense form
// (label left, field right). It shows the fields every selected markup has
// (a value they do not share is left blank); a change applies at once to the
// ones not locked, as one undo step. Copy format takes the one selected
// markup's style for the format painter (properties.ts).

import { useId, useState, type KeyboardEvent } from "react";
import { Paintbrush } from "lucide-react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { ColorSwatchGroup } from "@/components/ui/color-swatch";
import { cx } from "@/components/ui/cx";
import { FieldShell, fieldControlClasses } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";
import { Select } from "@/components/ui/select";
import { MAX_SUBJECT_LENGTH, MAX_TEXT_LENGTH, isTextMarkup, type Markup } from "@/core/schema/markup";
import { sharedFields, sharedValue, sizeLabel, subjectOf, type PropertyChange } from "@/core/markup/properties";
import { viewerStore } from "@/features/viewer";

import { editorStore, isLocked, layersOf, markupsOf } from "./editor-store";
import { assignLayer } from "./layers";
import { changeProperties, copyFormat, dropFormat, formatPainter } from "./properties";

/** D1: the markup colours offered (any other colour can be picked with Custom). */
export const MARKUP_COLORS: Array<{ value: string; label: string }> = [
  { value: "#ff0000", label: "Red" },
  { value: "#ff8000", label: "Orange" },
  { value: "#ffff00", label: "Yellow" },
  { value: "#00a000", label: "Green" },
  { value: "#00c0ff", label: "Cyan" },
  { value: "#0000ff", label: "Blue" },
  { value: "#ff00ff", label: "Magenta" },
  { value: "#000000", label: "Black" },
  { value: "#ffffff", label: "White" },
];

export const PAINTER_HINT = "Click a markup to apply the format. Esc cancels.";
export const LOCKED_HINT = "Locked markups keep their properties.";

const MIXED = Symbol("mixed");
const NO_LAYER_VALUE = "none";

/** A colour field: the palette and a custom picker; `none` offers no colour (a fill). */
function ColorField({ label, value, onChange, none }: { label: string; value: string | null | typeof MIXED; onChange: (color: string | null) => void; none?: boolean }) {
  const id = useId();
  const shown = typeof value === "string" ? value.toLowerCase() : undefined;
  return (
    <FieldShell layout="workspace" label={label} htmlFor={id}>
      <div className="flex flex-wrap items-center gap-1">
        <ColorSwatchGroup aria-label={label} colors={MARKUP_COLORS} value={shown} onValueChange={(v) => onChange(v)} />
        <input
          id={id}
          type="color"
          aria-label={`Custom ${label.toLowerCase()}`}
          defaultValue={shown ?? "#000000"}
          key={shown ?? "mixed"}
          // The native change (the picker closed), not each move: one undo step.
          ref={(input) => {
            if (!input) return;
            input.onchange = () => onChange(input.value.toLowerCase());
          }}
          className="size-5 cursor-pointer rounded-sm border border-strong bg-surface-2 p-0 focus-ring"
        />
        {none ? (
          <Button size="sm" variant="ghost" aria-pressed={value === null} onClick={() => onChange(null)}>
            None
          </Button>
        ) : null}
      </div>
    </FieldShell>
  );
}

/** A text field committed on Enter or leaving it; Esc reverts. */
function TextValueField({ label, value, placeholder, maxLength, multiline, onCommit }: { label: string; value: string; placeholder?: string; maxLength: number; multiline?: boolean; onCommit: (text: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape" && draft !== null) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
    } else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };
  const props = {
    id,
    value: draft ?? value,
    placeholder,
    maxLength,
    onChange: (e: { currentTarget: { value: string } }) => setDraft(e.currentTarget.value),
    onBlur: commit,
    onKeyDown,
  };
  return (
    <FieldShell layout="workspace" label={label} htmlFor={id}>
      {multiline ? (
        <textarea {...props} rows={3} className={cx(fieldControlClasses("workspace", false), "h-auto py-1")} />
      ) : (
        <input {...props} type="text" className={fieldControlClasses("workspace", false)} />
      )}
    </FieldShell>
  );
}

export function PropertiesPanel({ emptyText }: { emptyText: string }) {
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const all = useStore(editorStore, (s) => markupsOf(s, documentId));
  const ids = useStore(editorStore, (s) => s.selection.ids);
  const painting = useStore(formatPainter, (s) => s.format !== null);
  const layers = useStore(editorStore, (s) => layersOf(s, documentId));

  const chosen = new Set(ids);
  const selected = all.filter((m) => chosen.has(m.id));
  if (!documentId || selected.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md" data-testid="properties-empty">
        <p>{emptyText}</p>
        {painting ? <p className="text-ws-sm text-muted">{PAINTER_HINT}</p> : null}
      </div>
    );
  }

  const fields = new Set(sharedFields(selected));
  const change = (c: PropertyChange) => void changeProperties(documentId, selected, c);
  const locked = selected.some((m) => isLocked(m));
  const value = <T,>(get: (m: Markup) => T) => sharedValue<T | typeof MIXED>(selected, get, MIXED);
  const number = (v: number | typeof MIXED) => (v === MIXED ? null : v);
  const subject = value(subjectOf);
  const opacity = value((m) => Math.round((m.style.opacity ?? 1) * 100));
  const one = selected.length === 1 ? selected[0] : null;
  // Story 5.10 (D2): the format of one markup (a group's members may differ: its first).
  const source = one ?? (selected.every((m) => m.groupId && m.groupId === selected[0].groupId) ? selected[0] : null);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="properties-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-ws-sm text-muted">{one ? subjectOf(one) : `${selected.length} markups`}</p>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={painting}
          disabled={!source && !painting}
          title="Copy this markup's format, then click a markup to apply it"
          onClick={() => (painting ? dropFormat() : source && copyFormat(source))}
        >
          <Paintbrush size={14} aria-hidden="true" />
          Copy format
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {painting ? <p className="text-ws-sm text-muted">{PAINTER_HINT}</p> : null}
        {locked ? <p className="text-ws-sm text-muted">{LOCKED_HINT}</p> : null}
        {fields.has("subject") ? (
          <TextValueField
            key={`subject:${ids.join()}`}
            label="Subject"
            value={subject === MIXED ? "" : subject}
            placeholder={subject === MIXED ? "Mixed" : undefined}
            maxLength={MAX_SUBJECT_LENGTH}
            onCommit={(s) => change({ subject: s })}
          />
        ) : null}
        {fields.has("color") ? <ColorField label="Colour" value={value((m) => m.style.color.toLowerCase())} onChange={(c) => c && change({ color: c })} /> : null}
        {fields.has("fill") ? <ColorField label="Fill" none value={value((m) => m.style.fill?.toLowerCase() ?? null)} onChange={(c) => change({ fill: c })} /> : null}
        {fields.has("width") ? (
          <NumberField label="Line width" suffix="pt" min={0.25} max={144} step={0.5} value={number(value((m) => m.style.width))} onValueChange={(w) => w > 0 && change({ width: w })} />
        ) : null}
        {fields.has("opacity") ? (
          <NumberField label="Opacity" suffix="%" min={0} max={100} step={5} value={number(opacity)} onValueChange={(o) => change({ opacity: o / 100 })} />
        ) : null}
        {fields.has("fontSize") ? (
          <NumberField label={sizeLabel(selected)} suffix="pt" min={1} max={144} step={1} value={number(value((m) => m.style.fontSize))} onValueChange={(f) => f > 0 && change({ fontSize: f })} />
        ) : null}
        {/* Story 5.12: the layer, once the document has layers. */}
        {layers.length > 0 ? (
          <Select
            label="Layer"
            value={value((m) => m.layerId ?? NO_LAYER_VALUE) === MIXED ? undefined : (value((m) => m.layerId ?? NO_LAYER_VALUE) as string)}
            placeholder="Mixed"
            options={[{ value: NO_LAYER_VALUE, label: "No layer" }, ...layers.map((l) => ({ value: l.id, label: l.name }))]}
            onValueChange={(v) => void assignLayer(documentId, selected, v === NO_LAYER_VALUE ? null : v)}
          />
        ) : null}
        {fields.has("text") && one && isTextMarkup(one) ? (
          <TextValueField key={`text:${one.id}`} label="Text" multiline value={one.text} maxLength={MAX_TEXT_LENGTH} onCommit={(t) => change({ text: t })} />
        ) : null}
      </div>
    </div>
  );
}
