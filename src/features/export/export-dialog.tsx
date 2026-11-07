"use client";

// Story 8.1 (UX-DR29): the ExportDialog for File → Export → Editable PDF:
// the pages (all, the current one or a range), whether markups on hidden
// layers go too (only asked when there are hidden layers), the count it will
// write; Export writes and downloads it, then a toast says so.

import { useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast-store";
import { parsePageRange } from "@/core/export/page-range";
import { editorStore, layersOf } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { exportBlocked, exportCount, runExport } from "./run-export";

export const exportDialogStore = createStore<{ open: boolean }>(() => ({ open: false }));

/** Opens the dialog (or says why the drawing cannot be exported). */
export function openExport(): void {
  const blocked = exportBlocked();
  if (blocked) return void toast({ title: "Cannot export", description: blocked, variant: "warning" });
  exportDialogStore.setState({ open: true });
}

function closeExport(): void {
  exportDialogStore.setState({ open: false });
}

type PageChoice = "all" | "current" | "range";

export function ExportDialog() {
  const open = useStore(exportDialogStore, (s) => s.open);
  return open ? <ExportForm /> : null;
}

function ExportForm() {
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const hasHidden = useStore(editorStore, (s) => layersOf(s, documentId).some((l) => l.hidden));
  const [which, setWhich] = useState<PageChoice>("all");
  const [range, setRange] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsed = which === "range" ? parsePageRange(range, pageCount) : null;
  const pages = which === "all" ? Array.from({ length: pageCount }, (_, i) => i) : which === "current" ? [pageIndex] : parsed?.ok ? parsed.pages : [];
  const count = exportCount({ pages, includeHidden });
  const rangeError = which === "range" && range.trim() !== "" && parsed && !parsed.ok ? parsed.reason : undefined;

  async function submit() {
    if (busy || pages.length === 0) return;
    setBusy(true);
    const outcome = await runExport({ pages, includeHidden });
    setBusy(false);
    if (!outcome.ok) return void toast({ title: "Export failed", description: outcome.reason, variant: "danger" });
    toast({ title: `Exported ${outcome.name}`, description: `${outcome.annotations} ${outcome.annotations === 1 ? "markup" : "markups"} as editable PDF annotations.`, variant: "success" });
    closeExport();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : closeExport())}
      title="Export editable PDF"
      description="Markups become standard PDF annotations that Acrobat and Revu can edit. White-out is burned in."
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" onClick={closeExport}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={busy || pages.length === 0} onClick={() => void submit()}>
              {busy ? "Exporting…" : "Export"}
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
        {hasHidden ? <Checkbox label="Include markups on hidden layers" checked={includeHidden} onCheckedChange={(v) => setIncludeHidden(v === true)} /> : null}
        <p className="text-ws-sm text-muted" data-testid="export-count">
          {count === 1 ? "1 markup" : `${count} markups`} will be written.
        </p>
      </div>
    </Dialog>
  );
}
