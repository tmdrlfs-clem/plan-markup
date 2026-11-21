"use client";

// Story 5.6: the field a placed text markup is typed in, over the canvas at
// the frame the painter last drew (text-tool.ts), so it follows zoom and pan.
// Enter is a new line; Esc, Ctrl+Enter or focus leaving the field ends the
// typing (the markup is added). Its keys stay in the field: Esc never reaches
// the viewer, single letters arm no tool, Ctrl+Z is the field's own undo.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { editorStore } from "./editor-store";
import { endTextEdit, setTypedText, textFrameStore } from "./text-tool";

export const TEXT_FIELD_LABEL = "Markup text";

export function TextEditor() {
  const edit = useStore(editorStore, (s) => s.tools.textEdit);
  const frame = useStore(textFrameStore, (s) => s.frame);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const draftId = edit?.draft.id ?? null;

  // A new draft: an empty field with the focus.
  const [shownId, setShownId] = useState<string | null>(null);
  if (draftId !== shownId) {
    setShownId(draftId);
    setValue("");
  }
  const visible = edit !== null && frame !== null;
  useEffect(() => {
    if (!visible) return;
    // After the event that placed it: a click's mousedown focuses the canvas once its pointerdown
    // is handled, and taking the focus before that would end the typing at once (empty).
    const timer = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [visible, draftId]);

  if (!edit || !frame) return null;

  const end = () => {
    // The canvas gets the focus back (its keys work again).
    const canvas = ref.current?.parentElement?.querySelector<HTMLCanvasElement>("canvas[tabindex]");
    endTextEdit(true);
    canvas?.focus({ preventScroll: true });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      end();
      return;
    }
    // Every other key is the field's: none reaches the viewer's or the workspace's shortcuts.
    e.stopPropagation();
  };
  const box = frame.kind !== "typewriter" && frame.kind !== "note";
  return (
    <textarea
      ref={ref}
      aria-label={TEXT_FIELD_LABEL}
      data-testid="markup-text-editor"
      value={value}
      spellCheck
      onChange={(e) => {
        setValue(e.target.value);
        setTypedText(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onBlur={() => endTextEdit(true)}
      className={
        frame.kind === "note"
          ? "absolute resize-none rounded-sm border border-strong bg-surface-1 text-fg shadow-2 outline-none"
          : "absolute resize-none overflow-hidden border-0 bg-transparent outline-dashed outline-1 outline-offset-0"
      }
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.kind === "typewriter" ? undefined : frame.width,
        minWidth: frame.kind === "typewriter" ? Math.max(frame.fontPx * 4, 24) : undefined,
        minHeight: box ? frame.height : frame.fontPx * 4,
        transform: frame.angle ? `rotate(${frame.angle}rad)` : undefined,
        transformOrigin: "0 0",
        fontSize: frame.fontPx,
        fontFamily: frame.kind === "note" ? undefined : frame.font,
        fontWeight: frame.bold ? "bold" : undefined,
        fontStyle: frame.italic ? "italic" : undefined,
        textDecoration: [frame.underline ? "underline" : "", frame.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
        textAlign: frame.kind === "note" ? undefined : frame.align,
        lineHeight: 1.15,
        padding: frame.padPx,
        color: frame.kind === "note" ? undefined : frame.color,
        outlineColor: frame.kind === "note" ? undefined : frame.color,
        fieldSizing: "content",
        whiteSpace: frame.kind === "typewriter" ? "pre" : "pre-wrap",
      }}
    />
  );
}
