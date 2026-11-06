"use client";

// Story 6.5 (FR81, UX-DR11, UX-DR17): "Markups exist on another version of this
// file" when the opened file's bytes have no set but one of the user's sets has
// a file of that name. Info, dismissible (per tab, like the other notices),
// worded so nothing sounds lost; nothing is copied or moved. Its action opens
// the markup set list (Story 6.6: File → Markup sets…).

import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { dismissHint, showHint } from "@/components/ui/hint-store";
import type { MarkupSetSummary } from "@/lib/db/markups";
import { dismissNotice, viewerStore } from "@/features/viewer";

import { listMyMarkupSets } from "./actions";

export const OTHER_VERSION_HINT_ID = "other-version";
export const OTHER_VERSION_HINT = "Markups exist on another version of this file";
export const OPEN_SET_LIST = "Open markup set list";

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; sets: MarkupSetSummary[] };

type MarkupSetsUi = {
  /** Documents (sha256) whose filename has a set on other bytes. */
  otherVersion: Readonly<Record<string, true>>;
  /** The markup set list is open, and what it shows. */
  listOpen: boolean;
  list: ListState;
};

export const markupSetsUi = createStore<MarkupSetsUi>(() => ({ otherVersion: {}, listOpen: false, list: { status: "loading" } }));

let listRequest = 0;

export function markOtherVersion(documentId: string): void {
  const { otherVersion } = markupSetsUi.getState();
  if (!otherVersion[documentId]) markupSetsUi.setState({ otherVersion: { ...otherVersion, [documentId]: true } });
}

/** Opens the markup set list and loads it. */
export function openMarkupSetList(): void {
  const request = ++listRequest;
  markupSetsUi.setState({ listOpen: true, list: { status: "loading" } });
  const settle = (list: ListState) => {
    if (request === listRequest) markupSetsUi.setState({ list });
  };
  void listMyMarkupSets().then(
    (result) => settle(result.ok ? { status: "ready", sets: result.data } : { status: "error" }),
    () => settle({ status: "error" }),
  );
}

/** Shows the notice while the shown document has another version, until dismissed. */
export function useOtherVersionHint(): void {
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const dismissed = useStore(viewerStore, (s) => s.dismissedNotices.includes(OTHER_VERSION_HINT_ID));
  const other = useStore(markupSetsUi, (s) => (documentId ? s.otherVersion[documentId] === true : false));
  useEffect(() => {
    if (!other || dismissed) return;
    showHint({
      id: OTHER_VERSION_HINT_ID,
      variant: "info",
      text: OTHER_VERSION_HINT,
      action: { label: OPEN_SET_LIST, onAction: openMarkupSetList },
      onDismiss: () => dismissNotice(OTHER_VERSION_HINT_ID),
    });
    return () => dismissHint(OTHER_VERSION_HINT_ID);
  }, [other, dismissed, documentId]);
}

/** "3 Nov 2026, 14:05" in the user's locale. */
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Story 6.6 (FR51), the list: the user's markup sets, newest change first, with
 * filename, page count and last modified; an empty state. Opening a set from
 * here is Story 6.6's next step.
 */
export function MarkupSetListDialog() {
  const open = useStore(markupSetsUi, (s) => s.listOpen);
  const state = useStore(markupSetsUi, (s) => s.list);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => markupSetsUi.setState({ listOpen: next })}
      title="Markup sets"
      description="Your markups, by the file they belong to. Open the same PDF to continue on it."
      size="lg"
      footer={<DialogFooter primary={<DialogPrimary onClick={() => markupSetsUi.setState({ listOpen: false })}>Done</DialogPrimary>} />}
    >
      <div data-testid="markup-set-list" data-state={state.status} className="max-h-96 overflow-auto">
        {state.status === "loading" ? <p className="text-muted">Loading…</p> : null}
        {state.status === "error" ? <p className="text-muted">The list could not be loaded. Try again in a moment.</p> : null}
        {state.status === "ready" && state.sets.length === 0 ? (
          <p className="text-muted">No markup sets yet. Mark up a PDF and it appears here.</p>
        ) : null}
        {state.status === "ready" && state.sets.length > 0 ? (
          <table className="w-full text-left text-ws-md">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">File</th>
                <th className="py-1 pr-3 font-normal">Pages</th>
                <th className="py-1 pr-3 font-normal">Markups</th>
                <th className="py-1 font-normal">Last modified</th>
              </tr>
            </thead>
            <tbody>
              {state.sets.map((set) => (
                <tr key={set.drawingId} className="border-t border-border" data-testid="markup-set-row">
                  <td className="max-w-64 truncate py-1 pr-3" title={set.filename}>
                    {set.filename}
                  </td>
                  <td className="num py-1 pr-3">{set.pageCount}</td>
                  <td className="num py-1 pr-3">{set.markupCount}</td>
                  <td className="num py-1">{when(set.lastModified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Dialog>
  );
}
