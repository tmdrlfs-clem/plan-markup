"use client";

// Closing a drawing changed since its last PDF (founder 2026-11-20): before a
// user's close (the tab's X, a middle click, Delete, Alt+W, File → Close
// drawing) the prompt asks whether to save it as a PDF first. Markups are
// saved in Plan Markup as they change, so closing loses nothing here; the
// question is about the PDF copy. "Save as PDF…" opens Save as… and closes the
// tab once the PDF is saved; "Close without PDF" closes; Cancel keeps it open.

import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { tabChangedSinceSaved } from "@/features/editor";
import { tabsStore, viewerTabs } from "@/features/viewer";

import { saveAs } from "./export-dialog";

/** The tab whose close waits for an answer (null: no prompt). */
export const savePromptStore = createStore<{ tabId: string | null }>(() => ({ tabId: null }));

const dismiss = () => savePromptStore.setState({ tabId: null });

/** Mounted once in the workspace: asks before closing a changed drawing. */
export function SavePrompt() {
  const tabId = useStore(savePromptStore, (s) => s.tabId);
  const fileName = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === tabId)?.fileName ?? null);

  useEffect(
    () =>
      viewerTabs.setCloseGuard((id) => {
        const tab = tabsStore.getState().tabs.find((t) => t.id === id);
        if (!tab || tab.failed || !tabChangedSinceSaved(id)) return false;
        savePromptStore.setState({ tabId: id });
        return true;
      }),
    [],
  );

  if (!tabId || fileName === null) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : dismiss())}
      title={`Save a PDF of ${fileName}?`}
      description="You changed this drawing since its last PDF. Your markups stay saved in Plan Markup either way."
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <>
              <Button variant="ghost" onClick={dismiss}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  dismiss();
                  viewerTabs.close(tabId);
                }}
              >
                Close without PDF
              </Button>
            </>
          }
          primary={
            <DialogPrimary
              onClick={() => {
                dismiss();
                saveAs(tabId, { thenClose: true });
              }}
            >
              Save as PDF…
            </DialogPrimary>
          }
        />
      }
    />
  );
}
