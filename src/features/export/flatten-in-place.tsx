"use client";

// Flatten in place and Unflatten (founder 2026-11-21). File → Flatten…
// (Ctrl+Shift+M) asks, then draws the drawing's markups into the PDF open in
// the tab: the tab shows "<name> (flattened).pdf" and the flattened markups
// can no longer be edited. Zones and guides are design data, never drawn: they
// stay editable, with the layers and the pages' scales. Nothing is written to
// the computer until Save as… (the close prompt asks).
//
// Unflatten (File → Unflatten, Ctrl+Z with no step left, the toast's Undo)
// takes the drawing out again, from what the flatten kept inside the PDF
// (core/export/flatten-record.ts), so it also works on a flattened PDF saved
// and opened again: the markups come back editable, with whatever was added
// since. File → Export → Flattened PDF… still downloads a copy instead.

import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-store";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import type { FlattenRecord } from "@/core/export/flatten-record";
import type { Layer } from "@/core/schema/layer";
import type { Markup } from "@/core/schema/markup";
import { applyOp, editorStore, layersOf, markTabUnsaved, markupsOf, registerFallbackUndo } from "@/features/editor";
import { tabsStore, viewerStore, viewerTabs } from "@/features/viewer";

import { decodeImage, exportBlocked, flattenInWorker, prepare, unflattenInWorker } from "./run-export";

export const NOTHING_TO_FLATTEN = "There are no markups to flatten on this drawing.";
export const NOTHING_TO_UNFLATTEN = "This drawing has no flatten to undo.";
export const FLATTEN_FAILED = "The drawing could not be flattened.";
export const UNFLATTEN_FAILED = "The drawing could not be unflattened.";
const FLATTENED_SUFFIX = " (flattened)";

/** The confirm dialog (open) and a flatten or unflatten in progress (busy). */
export const flattenStore = createStore<{ open: boolean; busy: boolean; count: number }>(() => ({ open: false, busy: false, count: 0 }));

/** Tabs flattened in this page: Ctrl+Z with no step left unflattens them. */
const flattenedTabs = new Set<string>();

/** Zones and guides are design data: never drawn in, they stay editable. */
const stays = (m: Markup) => m.type === "zone" || m.guide === true;

/** The markups a flatten of the shown drawing draws in. */
export function flattenCount(): number {
  const documentId = viewerStore.getState().documentId;
  return documentId ? markupsOf(editorStore.getState(), documentId).filter((m) => !stays(m)).length : 0;
}

/** File → Flatten… / Ctrl+Shift+M: asks first (or says why not). */
export function openFlatten(): void {
  const blocked = exportBlocked();
  if (blocked) return void toast({ title: "Cannot flatten", description: blocked, variant: "warning" });
  const count = flattenCount();
  if (count === 0) return void toast({ title: "Nothing to flatten", description: NOTHING_TO_FLATTEN, variant: "info" });
  flattenStore.setState({ open: true, count });
}

const pageIndexOf = (documentId: string, pageId: string): number | null => {
  const prefix = `${documentId}:`;
  if (!pageId.startsWith(prefix)) return null;
  const i = Number(pageId.slice(prefix.length));
  return Number.isInteger(i) && i >= 0 ? i : null;
};

/** The shown document's markups, layers and scales, by page index (what moves to the new document). */
function carried(documentId: string, markups: readonly Markup[]) {
  const v = viewerStore.getState();
  const byIndex = markups.flatMap((markup) => {
    const pageIndex = pageIndexOf(documentId, markup.pageId);
    return pageIndex === null ? [] : [{ pageIndex, markup }];
  });
  const calibrations = Object.entries(v.calibrations).flatMap(([pageId, calibration]) => {
    const pageIndex = pageIndexOf(documentId, pageId);
    return pageIndex === null || !calibration ? [] : [{ pageIndex, calibration }];
  });
  return { markups: byIndex, calibrations };
}

/**
 * Shows `file` in tab `tabId` instead, then puts `markups`, `layers` and `calibrations` on the
 * new document as soon as it is known (before its saved set would be looked for). Not undo steps.
 */
function swapIn(tabId: string, file: File, seed: { markups: FlattenRecord["markups"]; layers: readonly Layer[]; calibrations: FlattenRecord["calibrations"] }): void {
  const seq = { open: -1 };
  const unsubscribe = viewerStore.subscribe((s) => {
    if (s.tabId !== tabId) return;
    if (seq.open < 0) seq.open = s.openSeq;
    if (s.openSeq !== seq.open) return unsubscribe();
    if (s.status === "error") return unsubscribe();
    if (s.status !== "ready" || !s.documentId) return;
    unsubscribe();
    const documentId = s.documentId;
    if (seed.layers.length > 0) applyOp({ kind: "layers.set", documentId, before: [...layersOf(editorStore.getState(), documentId)], after: [...seed.layers] });
    const cals = Object.fromEntries(seed.calibrations.filter((c) => c.pageIndex < s.pageCount).map((c) => [pageIdOf(documentId, c.pageIndex), c.calibration as Calibration | null]));
    if (Object.keys(cals).length > 0) applyOp({ kind: "calibrations.set", documentId, before: {}, after: cals });
    const markups = seed.markups.filter((m) => m.pageIndex < s.pageCount).map(({ pageIndex, markup }) => ({ ...markup, pageId: pageIdOf(documentId, pageIndex) }) as Markup);
    if (markups.length > 0) applyOp({ kind: "markups.add", documentId, markups });
  });
  viewerTabs.replaceFile(tabId, file);
  // The new document's history is empty; it is not on the computer yet.
  markTabUnsaved(tabId);
}

const stemOf = (name: string) => name.replace(/\.pdf$/i, "").trim() || "drawing";

/** Flattens the shown drawing into its tab (see the header); never throws. */
export async function flattenInPlace(): Promise<{ ok: true; flattened: number } | { ok: false; reason: string }> {
  const blocked = exportBlocked();
  if (blocked) return { ok: false, reason: blocked };
  const v = viewerStore.getState();
  const tabId = tabsStore.getState().activeId;
  const documentId = v.documentId!;
  if (!tabId) return { ok: false, reason: FLATTEN_FAILED };
  const stored = markupsOf(editorStore.getState(), documentId);
  const drawn = stored.filter((m) => !stays(m));
  if (drawn.length === 0) return { ok: false, reason: NOTHING_TO_FLATTEN };
  const ready = await prepare({ pages: Array.from({ length: v.pageCount }, (_, i) => i), includeHidden: true }, decodeImage);
  if (!ready.ok) return ready;
  const layers = [...layersOf(editorStore.getState(), documentId)];
  const { markups: flattened, calibrations } = carried(documentId, drawn);
  const record: FlattenRecord = { version: 1, markups: flattened, layers, calibrations };
  const bytes = await flattenInWorker(ready.bytes, ready.job, record).catch(() => null);
  if (!bytes) return { ok: false, reason: FLATTEN_FAILED };
  // Still the same drawing in the same tab (the flatten took a moment).
  if (tabsStore.getState().activeId !== tabId || viewerStore.getState().documentId !== documentId) return { ok: false, reason: FLATTEN_FAILED };
  const name = `${stemOf(ready.file.name).replace(/ \(flattened\)$/, "")}${FLATTENED_SUFFIX}.pdf`;
  swapIn(tabId, new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" }), { markups: carried(documentId, stored.filter(stays)).markups, layers, calibrations });
  flattenedTabs.add(tabId);
  return { ok: true, flattened: drawn.length };
}

/** Takes the flatten out of the shown drawing (see the header); never throws. */
export async function unflattenActive(): Promise<{ ok: true; restored: number } | { ok: false; reason: string }> {
  const blocked = exportBlocked();
  if (blocked) return { ok: false, reason: blocked };
  const v = viewerStore.getState();
  const tabId = tabsStore.getState().activeId;
  const documentId = v.documentId!;
  if (!tabId || !v.file) return { ok: false, reason: UNFLATTEN_FAILED };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await v.file.arrayBuffer());
  } catch {
    return { ok: false, reason: UNFLATTEN_FAILED };
  }
  const out = await unflattenInWorker(bytes).catch(() => null);
  if (!out) return { ok: false, reason: UNFLATTEN_FAILED };
  if (!out.bytes || !out.record) return { ok: false, reason: NOTHING_TO_UNFLATTEN };
  if (tabsStore.getState().activeId !== tabId || viewerStore.getState().documentId !== documentId) return { ok: false, reason: UNFLATTEN_FAILED };
  // Whatever is on the drawing now stays (added since the flatten, zones, guides); the scales now win.
  const now = carried(documentId, markupsOf(editorStore.getState(), documentId));
  const ids = new Set(now.markups.map((m) => m.markup.id));
  const markups = [...out.record.markups.filter((m) => !ids.has(m.markup.id)), ...now.markups];
  const current = layersOf(editorStore.getState(), documentId);
  const layers = [...current, ...out.record.layers.filter((l) => !current.some((c) => c.id === l.id))];
  const scaled = new Set(now.calibrations.map((c) => c.pageIndex));
  const calibrations = [...now.calibrations, ...out.record.calibrations.filter((c) => !scaled.has(c.pageIndex))];
  const name = `${stemOf(v.file.name).replace(/ \(flattened\)$/, "")}.pdf`;
  swapIn(tabId, new File([out.bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" }), { markups, layers, calibrations });
  flattenedTabs.delete(tabId);
  return { ok: true, restored: out.record.markups.length };
}

async function run<T extends { ok: boolean }>(work: () => Promise<T>): Promise<T | null> {
  if (flattenStore.getState().busy) return null;
  flattenStore.setState({ busy: true });
  try {
    return await work();
  } finally {
    flattenStore.setState({ busy: false });
  }
}

/** File → Unflatten / Ctrl+Z / the toast's Undo: unflattens and says what happened. */
export async function unflatten(): Promise<void> {
  const out = await run(unflattenActive);
  if (!out) return;
  if (!out.ok) return void toast({ title: "Cannot unflatten", description: out.reason, variant: out.reason === NOTHING_TO_UNFLATTEN ? "info" : "danger" });
  toast({ title: "Unflattened", description: `${out.restored} ${out.restored === 1 ? "markup is" : "markups are"} editable again.`, variant: "success" });
}

/** Mounted once in the workspace: the confirm dialog, and Ctrl+Z after a flatten. */
export function FlattenDialog() {
  const open = useStore(flattenStore, (s) => s.open);
  const busy = useStore(flattenStore, (s) => s.busy);
  const count = useStore(flattenStore, (s) => s.count);

  useEffect(
    () =>
      registerFallbackUndo({
        label: (tabId) => (flattenedTabs.has(tabId) ? "Flatten" : null),
        run: (tabId) => {
          if (!flattenedTabs.has(tabId)) return false;
          void unflatten();
          return true;
        },
      }),
    [],
  );

  if (!open) return null;
  const close = () => flattenStore.setState({ open: false });
  async function submit() {
    const out = await run(flattenInPlace);
    if (!out) return;
    close();
    if (!out.ok) return void toast({ title: "Flatten failed", description: out.reason, variant: "danger" });
    toast({
      title: `Flattened ${out.flattened} ${out.flattened === 1 ? "markup" : "markups"}`,
      description: "They are part of the drawing now. Save as… keeps it as a PDF.",
      variant: "success",
      action: { label: "Undo", onAction: () => void unflatten() },
    });
  }
  const n = `${count} ${count === 1 ? "markup" : "markups"}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => (o || busy ? undefined : close())}
      title="Flatten markups into the drawing?"
      description={`${n} become part of the drawing and can no longer be edited. Unflatten (File menu) or Ctrl+Z brings them back. Zones and guides stay editable. The PDF on your computer is not changed until you Save as….`}
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={busy} onClick={() => void submit()}>
              {busy ? "Flattening…" : "Flatten"}
            </DialogPrimary>
          }
        />
      }
    />
  );
}
