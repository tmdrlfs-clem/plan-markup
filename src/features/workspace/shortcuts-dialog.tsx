"use client";

// Story 8.5 (UX-DR35): Settings → Keyboard shortcuts (also Help → Keyboard
// shortcuts): the basic set, view-only, in the UX spec's table order. Only
// keys the M1 workspace binds are listed (Save as, Unflatten and the 4541
// tools come later).

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { formatShortcut } from "@/components/ui/shortcut";

export type ShortcutRow = { action: string; keys: string; note?: string };
export type ShortcutGroup = { group: string; rows: readonly ShortcutRow[] };

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    group: "Selection & view",
    rows: [
      { action: "Select", keys: "V" },
      { action: "Pan tool / temporary pan", keys: "Shift+V / Space", note: "Hold Space to pan without leaving the tool" },
      { action: "Zoom in / out", keys: "+ / -", note: "Ctrl+wheel also zooms" },
      { action: "Zoom tool", keys: "Z" },
      { action: "Fit page / Fit width", keys: "Ctrl+9 / Ctrl+0" },
    ],
  },
  {
    group: "Pages",
    rows: [
      { action: "Next / previous page", keys: "PageDown / PageUp", note: "Also Ctrl+→ / Ctrl+←" },
      { action: "First / last page", keys: "Home / End" },
    ],
  },
  {
    group: "Measure",
    rows: [
      { action: "Length", keys: "Shift+Alt+L" },
      { action: "Polylength", keys: "Shift+Alt+Q" },
      { action: "Area", keys: "Shift+Alt+A" },
      { action: "Count", keys: "Shift+Alt+C" },
      { action: "Dynamic fill", keys: "J" },
    ],
  },
  {
    group: "Markup",
    rows: [
      { action: "Line / Arrow", keys: "L / A" },
      { action: "Polyline / Polygon", keys: "Shift+N / Shift+P" },
      { action: "Rectangle / Ellipse", keys: "R / E" },
      { action: "Cloud / Cloud+", keys: "C / K" },
      { action: "Text box / Callout", keys: "T / Q" },
      { action: "Pen / Highlight", keys: "P / H" },
      { action: "Stamp (last Tool Chest tool)", keys: "S" },
      { action: "White-out", keys: "Shift+W" },
    ],
  },
  {
    group: "Edit",
    rows: [
      { action: "Undo / Redo", keys: "Ctrl+Z / Ctrl+Y", note: "Also Ctrl+Shift+Z; while drawing, Undo removes the last point" },
      { action: "Copy / Paste / Paste in place", keys: "Ctrl+C / Ctrl+V / Ctrl+Shift+V" },
      { action: "Delete", keys: "Del", note: "Also Backspace" },
      { action: "Select all", keys: "Ctrl+A" },
      { action: "Group / Ungroup", keys: "Ctrl+G / Ctrl+Shift+G" },
      { action: "Bring to front / Send backward", keys: "Ctrl+Shift+] / Ctrl+[" },
      { action: "Nudge selection", keys: "Arrows", note: "Shift moves ×10" },
      { action: "Cancel / back to Select", keys: "Esc" },
    ],
  },
  {
    group: "Document",
    rows: [
      { action: "Open / Save", keys: "Ctrl+O / Ctrl+S" },
      { action: "Save as PDF", keys: "Ctrl+Shift+S" },
      { action: "Print", keys: "Ctrl+P" },
      { action: "Flatten", keys: "Ctrl+Shift+M", note: "Ctrl+Z or File → Unflatten undoes it" },
      { action: "Search text / next / previous", keys: "Ctrl+F / F3 / Shift+F3", note: "Enter / Shift+Enter in the Search field" },
      { action: "Next / previous drawing", keys: "Alt+PageDown / Alt+PageUp" },
      { action: "Close drawing", keys: "Alt+W", note: "Also Ctrl+F4" },
    ],
  },
  {
    group: "Panels",
    rows: [
      { action: "Tool Chest / Properties / Thumbnails", keys: "Alt+X / Alt+P / Alt+T" },
      { action: "Measurements / Layers", keys: "Alt+U / Alt+Y" },
      { action: "Markups List", keys: "Alt+L" },
      { action: "Hide all panels", keys: "Shift+F4" },
    ],
  },
  {
    group: "While drawing",
    rows: [
      { action: "Constrain to 0/45/90°", keys: "Shift", note: "Hold while drawing" },
      { action: "Rotate freely (1°)", keys: "Shift", note: "Hold while rotating" },
      { action: "Copy along a straight line", keys: "Ctrl+Shift", note: "Hold while dragging" },
      { action: "Finish / remove last point", keys: "Enter / Backspace", note: "Or double-click to finish" },
    ],
  },
];

export const SHORTCUTS_NOTE = "Single-letter keys work while the drawing has focus, never while typing in a field.";

export const shortcutsDialogStore = createStore<{ open: boolean }>(() => ({ open: false }));

export function openShortcuts(): void {
  shortcutsDialogStore.setState({ open: true });
}

function close(): void {
  shortcutsDialogStore.setState({ open: false });
}

/** Each key of "A / B" formatted for the platform (⌘ on a Mac). */
function keysText(keys: string): string {
  return keys
    .split(" / ")
    .map((k) => (/^[A-Z]$|^Arrows$|^Space$/.test(k) ? k : formatShortcut(k)))
    .join(" / ");
}

export function ShortcutsDialog() {
  const open = useStore(shortcutsDialogStore, (s) => s.open);
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : close())}
      title="Keyboard shortcuts"
      description={SHORTCUTS_NOTE}
      size="lg"
      footer={
        <DialogFooter
          primary={
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          }
        />
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1" data-testid="shortcut-list">
        {SHORTCUTS.map((g) => (
          <table key={g.group} className="w-full border-collapse text-ws-sm">
            <caption className="pb-1 text-left text-ws-xs font-semibold uppercase tracking-wide text-muted">{g.group}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Keys</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.action} className="border-t border-border">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                    {r.action}
                    {r.note ? <span className="block text-ws-xs text-muted">{r.note}</span> : null}
                  </th>
                  <td className="whitespace-nowrap py-1 text-right align-top">
                    <kbd className="num font-sans text-text">{keysText(r.keys)}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </Dialog>
  );
}
