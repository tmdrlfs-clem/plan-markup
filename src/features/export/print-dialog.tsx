"use client";

// Story 8.3 (FR68): our print dialog, in place of the browser's own for Ctrl+P
// while a drawing is open: the pages, with or without markups (and markups on
// hidden layers, when there are any), the paper (the drawing's own size or a
// standard sheet) and fit to paper or actual size. Print makes the print PDF
// and opens the browser's print dialog for it.

import { useEffect, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast-store";
import { parsePageRange } from "@/core/export/page-range";
import { PAPER_NAMES, type Paper, type PrintScale } from "@/core/export/print";
import { editorStore, layersOf } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { exportBlocked, exportCount, runPrint } from "./run-export";

export const printDialogStore = createStore<{ open: boolean }>(() => ({ open: false }));

/** Opens the print dialog (or says why the drawing cannot be printed). */
export function openPrint(): void {
  const blocked = exportBlocked();
  if (blocked) return void toast({ title: "Cannot print", description: blocked, variant: "warning" });
  printDialogStore.setState({ open: true });
}

function closePrint(): void {
  printDialogStore.setState({ open: false });
}

/** Ctrl+P (⌘P) while a drawing is open: our dialog, not the browser's (which would print the app's screen). */
export function isPrintShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p";
}

export const ACTUAL_SIZE_HINT = "In the browser's print dialog, keep Scale at 100% (Actual size) so lengths measure true.";

const PAPER_LABEL = (p: Paper) => (p === "same" ? "Same as the drawing" : p);

type PageChoice = "all" | "current" | "range";

export function PrintDialog() {
  const open = useStore(printDialogStore, (s) => s.open);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPrintShortcut(event) || exportBlocked()) return;
      event.preventDefault();
      openPrint();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <PrintForm /> : null;
}

function PrintForm() {
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const hasHidden = useStore(editorStore, (s) => layersOf(s, documentId).some((l) => l.hidden));
  const [which, setWhich] = useState<PageChoice>("all");
  const [range, setRange] = useState("");
  const [markups, setMarkups] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [paper, setPaper] = useState<Paper>("same");
  const [scale, setScale] = useState<PrintScale>("fit");
  const [busy, setBusy] = useState(false);

  const parsed = which === "range" ? parsePageRange(range, pageCount) : null;
  const pages = which === "all" ? Array.from({ length: pageCount }, (_, i) => i) : which === "current" ? [pageIndex] : parsed?.ok ? parsed.pages : [];
  const rangeError = which === "range" && range.trim() !== "" && parsed && !parsed.ok ? parsed.reason : undefined;
  const count = markups ? exportCount({ pages, includeHidden }) : 0;

  async function submit() {
    if (busy || pages.length === 0) return;
    setBusy(true);
    const outcome = await runPrint({ pages, includeHidden, markups, paper, scale });
    setBusy(false);
    if (!outcome.ok) return void toast({ title: "Print failed", description: outcome.reason, variant: "danger" });
    if (outcome.clipped > 0) {
      toast({ title: "Some pages are larger than the paper", description: `${outcome.clipped} of ${outcome.sheets} printed at actual size are cut at the paper's edges.`, variant: "warning" });
    }
    closePrint();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : closePrint())}
      title="Print"
      description="Choose what to print, then the browser's print dialog opens for the printer."
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" onClick={closePrint}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={busy || pages.length === 0} onClick={() => void submit()}>
              {busy ? "Preparing…" : "Print"}
            </DialogPrimary>
          }
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Pages"
          value={which}
          onValueChange={(v) => setWhich(v as PageChoice)}
          options={[
            { value: "all", label: `All pages (${pageCount})` },
            { value: "current", label: `Current page (${pageIndex + 1})` },
            { value: "range", label: "Pages…" },
          ]}
        />
        {which === "range" ? <TextField label="Page range" placeholder="1-3, 5" value={range} onChange={(e) => setRange(e.target.value)} error={rangeError} /> : null}
        <Checkbox label="Print markups" checked={markups} onCheckedChange={(v) => setMarkups(v === true)} />
        {markups && hasHidden ? <Checkbox label="Include markups on hidden layers" checked={includeHidden} onCheckedChange={(v) => setIncludeHidden(v === true)} /> : null}
        <Select label="Paper" value={paper} onValueChange={(v) => setPaper(v as Paper)} options={PAPER_NAMES.map((p) => ({ value: p, label: PAPER_LABEL(p) }))} />
        <Select
          label="Scale"
          value={scale}
          onValueChange={(v) => setScale(v as PrintScale)}
          options={[
            { value: "fit", label: "Fit to paper" },
            { value: "actual", label: "Actual size (1:1)" },
          ]}
        />
        <p className="text-ws-sm text-muted" data-testid="print-summary">
          {pages.length === 1 ? "1 page" : `${pages.length} pages`}
          {markups ? `, ${count === 1 ? "1 markup" : `${count} markups`}` : ", without markups"}.
        </p>
        {scale === "actual" || paper === "same" ? <p className="text-ws-sm text-muted">{ACTUAL_SIZE_HINT}</p> : null}
      </div>
    </Dialog>
  );
}
