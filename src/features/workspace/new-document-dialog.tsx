"use client";

// New (founder 2026-11-21): a blank drawing of empty pages — A1, A3 or A4,
// portrait or landscape, and how many pages. It is made here (never uploaded)
// and opens in its own tab like a PDF opened from disk; Save as on the tab
// keeps its PDF.

import { useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { NumberField } from "@/components/ui/number-field";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast-store";
import { BLANK_SIZES, MAX_BLANK_PAGES, blankName, blankPageCount, blankPdf, type BlankSize, type BlankSpec, type Orientation } from "@/core/pdf/blank";

import { openFiles } from "./open-files";

export const newDocumentStore = createStore<{ open: boolean; seq: number }>(() => ({ open: false, seq: 0 }));
export function openNewDocument(): void {
  newDocumentStore.setState((s) => ({ open: true, seq: s.seq + 1 }));
}
const close = () => newDocumentStore.setState({ open: false });

/** What the dialog chose last (this session). */
let lastSpec: BlankSpec = { size: "A3", orientation: "landscape", pages: 1 };

/** Makes the blank PDF and opens it in a new tab. */
export async function createBlankDocument(spec: BlankSpec, date = new Date()): Promise<void> {
  const bytes = await blankPdf(spec, date);
  openFiles([new File([bytes as Uint8Array<ArrayBuffer>], blankName(spec, date), { type: "application/pdf", lastModified: date.getTime() })]);
}

/** Mounted once in the workspace. */
export function NewDocumentDialog() {
  const open = useStore(newDocumentStore, (s) => s.open);
  const seq = useStore(newDocumentStore, (s) => s.seq);
  if (!open) return null;
  return <NewDocumentForm key={seq} />;
}

const SIZE_OPTIONS = (Object.keys(BLANK_SIZES) as BlankSize[]).map((size) => ({ value: size, label: `${size} (${BLANK_SIZES[size][0]} × ${BLANK_SIZES[size][1]} mm)` }));
const ORIENTATION_OPTIONS = [
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
];

function NewDocumentForm() {
  const [spec, setSpec] = useState<BlankSpec>(lastSpec);
  const [busy, setBusy] = useState(false);
  const create = () => {
    if (busy) return;
    const chosen = { ...spec, pages: blankPageCount(spec.pages) };
    lastSpec = chosen;
    setBusy(true);
    createBlankDocument(chosen)
      .then(close)
      .catch(() => {
        setBusy(false);
        toast({ title: "The new drawing could not be made.", variant: "danger" });
      });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : close())}
      title="New drawing"
      description="Blank pages, made on this computer. Use Save as on its tab to keep the PDF."
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={busy} onClick={create}>
              Create
            </DialogPrimary>
          }
        />
      }
    >
      <div className="flex flex-col gap-2">
        <Select label="Page size" value={spec.size} onValueChange={(v) => setSpec((s) => ({ ...s, size: v as BlankSize }))} options={SIZE_OPTIONS} />
        <Select label="Orientation" value={spec.orientation} onValueChange={(v) => setSpec((s) => ({ ...s, orientation: v as Orientation }))} options={ORIENTATION_OPTIONS} />
        <NumberField label="Pages" min={1} max={MAX_BLANK_PAGES} step={1} value={spec.pages} onValueChange={(n) => setSpec((s) => ({ ...s, pages: blankPageCount(n) }))} />
      </div>
    </Dialog>
  );
}
