"use client";

// Story 7.4 (F7): the Tool Chest's Import .btx button, and the report of the
// items that did not import (a partial import, or none at all).

import { useRef } from "react";
import { FileUp } from "lucide-react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-store";

import { addTool, createToolSet } from "./actions";
import { NOTHING_IMPORTED, NOT_A_TOOL_SET, importBtx, importedText, readInWorker, type ImportDeps, type ImportOutcome, type ImportReportItem } from "./import-btx";

type Report = { title: string; added: number; failed: ImportReportItem[] };

export const importStore = createStore<{ busy: boolean; report: Report | null }>(() => ({ busy: false, report: null }));

let deps: ImportDeps = { read: readInWorker(), createToolSet, addTool };

/** Tests swap the worker and the actions. */
export function setImportDeps(next: Partial<ImportDeps>): void {
  deps = { ...deps, ...next };
}

/** Applies an outcome: the set joins the Tool Chest (via `onSet`), a toast, and the report when items failed. */
export function showOutcome(outcome: ImportOutcome, onSet: (set: Extract<ImportOutcome, { set: unknown }>["set"]) => void): void {
  switch (outcome.kind) {
    case "invalid":
      toast({ title: NOT_A_TOOL_SET, description: outcome.reason, variant: "warning" });
      return;
    case "none":
      importStore.setState({ report: { title: outcome.title, added: 0, failed: outcome.failed } });
      return;
    case "ok":
      onSet(outcome.set);
      toast({ title: importedText(outcome.title, outcome.set.tools.length), variant: "success" });
      return;
    case "partial":
      onSet(outcome.set);
      importStore.setState({ report: { title: outcome.title, added: outcome.set.tools.length, failed: outcome.failed } });
  }
}

/** Imports `file` and shows the outcome. */
export async function runImport(file: File, onSet: Parameters<typeof showOutcome>[1]): Promise<void> {
  if (importStore.getState().busy) return;
  importStore.setState({ busy: true });
  try {
    showOutcome(await importBtx(file, deps), onSet);
  } finally {
    importStore.setState({ busy: false });
  }
}

export function ImportBtxButton({ onSet }: { onSet: Parameters<typeof showOutcome>[1] }) {
  const busy = useStore(importStore, (s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
        <FileUp size={14} aria-hidden="true" />
        {busy ? "Importing…" : "Import .btx"}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".btx"
        aria-label="Revu tool set file"
        data-testid="import-btx-input"
        className="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void runImport(file, onSet);
        }}
      />
    </>
  );
}

/** The per-item report (F7 partial): what was added, and each item that was not, with its reason. */
export function ImportReportDialog() {
  const report = useStore(importStore, (s) => s.report);
  const close = () => importStore.setState({ report: null });
  return (
    <Dialog
      open={report !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={report && report.added > 0 ? `${importedText(report.title, report.added)} imported` : NOTHING_IMPORTED}
      description={
        report
          ? report.added > 0
            ? `${report.failed.length} ${report.failed.length === 1 ? "item was" : "items were"} not imported.`
            : `Nothing was added from “${report.title}”.`
          : undefined
      }
      footer={<DialogFooter primary={<DialogPrimary onClick={close}>Done</DialogPrimary>} />}
    >
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-ws-md" aria-label="Items not imported" data-testid="import-report">
        {report?.failed.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span className="min-w-0 shrink-0 truncate font-medium" style={{ maxWidth: "45%" }}>
              {f.name}
            </span>
            <span className="text-muted">{f.reason}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
