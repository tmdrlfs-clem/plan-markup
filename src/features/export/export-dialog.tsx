"use client";

// Story 8.1 (UX-DR29): the ExportDialog for File → Export → Editable PDF:
// the pages (all, the current one or a range), whether markups on hidden
// layers go too (only asked when there are hidden layers), the count it will
// write; Export writes and downloads it, then a toast says so.
// Story 8.2 (FR58, FR61): the same dialog for Flatten (Ctrl+Shift+M) and
// File → Export → Flattened PDF: the markups drawn into the pages, a new file.
// Story 9.12 (FR78): "Include advisory notice" draws the 4541 advisory notice onto
// each exported page; it starts on when the drawing has zones or heads.
// Save as… (File menu, a tab's right-click menu, Ctrl+Shift+S) is the editable
// export: a PDF of the drawing to this computer. A successful export marks the
// tab saved (the close prompt asks again only after a change), and closes the
// tab when the close prompt asked for the save.

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
import { isHead } from "@/core/sprinkler/heads";
import { editorStore, layersOf, markTabSaved, markupsOf } from "@/features/editor";
import { tabsStore, viewerStore, viewerTabs } from "@/features/viewer";

import { exportBlocked, exportCount, runExport, type ExportKind } from "./run-export";

/** The open dialog's kind (null: closed). */
export const exportDialogStore = createStore<{ open: ExportKind | null }>(() => ({ open: null }));

/** Opens the dialog for `kind` (or says why the drawing cannot be exported). */
export function openExport(kind: ExportKind = "editable"): void {
  const blocked = exportBlocked();
  if (blocked) return void toast({ title: kind === "flattened" ? "Cannot flatten" : "Cannot export", description: blocked, variant: "warning" });
  exportDialogStore.setState({ open: kind });
}

function closeExport(): void {
  closeAfterSave = null;
  exportDialogStore.setState({ open: null });
}

/** The tab the close prompt's "Save as PDF…" closes once its PDF is saved. */
let closeAfterSave: string | null = null;

/** Save as…: the drawing in `tabId` (shown first), else the active one, as a PDF to this computer. */
export function saveAs(tabId?: string, { thenClose = false }: { thenClose?: boolean } = {}): void {
  if (tabId && tabsStore.getState().activeId !== tabId) viewerTabs.activate(tabId);
  openExport("editable");
  const opened = exportDialogStore.getState().open === "editable";
  closeAfterSave = opened && thenClose ? (tabsStore.getState().activeId ?? null) : null;
}

/** Ctrl+Shift+S (⌘⇧S): Save as…, instead of the browser's own use of the keys. */
export function isSaveAsShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "s";
}

/** Story 8.2: Ctrl+Shift+M (⌘⇧M) flattens, instead of the browser's own use of the keys. */
export function isFlattenShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m";
}

const COPY: Record<ExportKind, { title: string; description: string; action: string; busy: string }> = {
  editable: {
    title: "Export editable PDF",
    description: "Markups become standard PDF annotations that Acrobat and Revu can edit. White-out is burned in.",
    action: "Export",
    busy: "Exporting…",
  },
  flattened: {
    title: "Flatten and export",
    description: "Markups are drawn into the pages of a new PDF, so nobody can change them by accident. Your markups here stay editable.",
    action: "Flatten",
    busy: "Flattening…",
  },
};

type PageChoice = "all" | "current" | "range";

export function ExportDialog() {
  const open = useStore(exportDialogStore, (s) => s.open);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isSaveAsShortcut(event)) {
        event.preventDefault();
        return saveAs();
      }
      if (!isFlattenShortcut(event)) return;
      event.preventDefault();
      openExport("flattened");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <ExportForm key={open} kind={open} /> : null;
}

function ExportForm({ kind }: { kind: ExportKind }) {
  const copy = COPY[kind];
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const hasHidden = useStore(editorStore, (s) => layersOf(s, documentId).some((l) => l.hidden));
  const [which, setWhich] = useState<PageChoice>("all");
  const [range, setRange] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [notice, setNotice] = useState(() => (documentId ? markupsOf(editorStore.getState(), documentId).some((m) => m.type === "zone" || isHead(m)) : false));
  const [busy, setBusy] = useState(false);

  const parsed = which === "range" ? parsePageRange(range, pageCount) : null;
  const pages = which === "all" ? Array.from({ length: pageCount }, (_, i) => i) : which === "current" ? [pageIndex] : parsed?.ok ? parsed.pages : [];
  const count = exportCount({ pages, includeHidden });
  const rangeError = which === "range" && range.trim() !== "" && parsed && !parsed.ok ? parsed.reason : undefined;

  async function submit() {
    if (busy || pages.length === 0) return;
    setBusy(true);
    const outcome = await runExport({ kind, pages, includeHidden, notice });
    setBusy(false);
    if (!outcome.ok) return void toast({ title: kind === "flattened" ? "Flatten failed" : "Export failed", description: outcome.reason, variant: "danger" });
    const n = (k: number) => `${k} ${k === 1 ? "markup" : "markups"}`;
    const description = kind === "flattened" ? `${n(outcome.flattened)} drawn into the pages.` : `${n(outcome.annotations)} as editable PDF annotations.`;
    toast({ title: `Exported ${outcome.name}`, description, variant: "success" });
    const saved = tabsStore.getState().activeId;
    const close = closeAfterSave;
    if (saved) markTabSaved(saved);
    closeExport();
    if (close && close === saved) viewerTabs.close(close);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : closeExport())}
      title={copy.title}
      description={copy.description}
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
              {busy ? copy.busy : copy.action}
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
        <Checkbox label="Include advisory notice" checked={notice} onCheckedChange={(v) => setNotice(v === true)} />
        <p className="text-ws-sm text-muted" data-testid="export-count">
          {count === 1 ? "1 markup" : `${count} markups`} will be written.
        </p>
      </div>
    </Dialog>
  );
}
