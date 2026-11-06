"use client";

// Story 6.5 (FR81, UX-DR11, UX-DR17): "Markups exist on another version of this
// file" when the opened file's bytes have no set but one of the user's sets has
// a file of that name. Info, dismissible (per tab, like the other notices),
// worded so nothing sounds lost; nothing is copied or moved. Its action opens
// the markup set list (Story 6.6: File → Markup sets…).
//
// Story 6.6 (FR51): opening a set from the list or the recent list asks for its
// PDF. The same bytes open as usual (and restore); other bytes, or no file,
// show the markups on blank pages of the set's page geometry, named and
// counted like the file. The PDF itself later replaces the blank pages.

import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-store";
import { blankPagesPdf } from "@/core/markup-set/blank-pages";
import { dismissHint, showHint } from "@/components/ui/hint-store";
import type { MarkupSetSummary } from "@/lib/db/markups";
import { dismissNotice, openDocument, openDocumentAs, viewerStore } from "@/features/viewer";

import { listMyMarkupSets, loadMarkupSetPages } from "./actions";

export const OTHER_VERSION_HINT_ID = "other-version";
export const OTHER_VERSION_HINT = "Markups exist on another version of this file";
export const OPEN_SET_LIST = "Open markup set list";
export const BLANK_PAGES_HINT_ID = "blank-pages";
export const OPEN_PDF = "Open the PDF…";

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; sets: MarkupSetSummary[] };

type MarkupSetsUi = {
  /** Documents (sha256) whose filename has a set on other bytes. */
  otherVersion: Readonly<Record<string, true>>;
  /** The markup set list is open, and what it shows. */
  listOpen: boolean;
  list: ListState;
  /** Story 6.6: the set being opened (asking for its PDF). */
  opening: MarkupSetSummary | null;
  /** Story 6.6: documents (set sha256) shown on blank pages, with what the notice names. */
  blank: Readonly<Record<string, { set: MarkupSetSummary }>>;
  /** Story 6.6: the newest sets for the empty workspace (null until loaded). */
  recent: MarkupSetSummary[] | null;
};

export const markupSetsUi = createStore<MarkupSetsUi>(() => ({
  otherVersion: {},
  listOpen: false,
  list: { status: "loading" },
  opening: null,
  blank: {},
  recent: null,
}));

/** How many sets the empty workspace lists. */
export const RECENT_SETS = 5;

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

/** Loads the newest sets for the empty workspace. */
export function loadRecentSets(): void {
  void listMyMarkupSets().then(
    (result) => {
      if (result.ok) markupSetsUi.setState({ recent: result.data.slice(0, RECENT_SETS) });
    },
    () => undefined,
  );
}

/** Asks how to open `set`: its PDF, or blank pages. */
export function promptOpenSet(set: MarkupSetSummary): void {
  markupSetsUi.setState({ listOpen: false, opening: set });
}

async function sha256Of(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shows `set`'s markups on blank pages of its page geometry. */
export async function openOnBlankPages(set: MarkupSetSummary): Promise<void> {
  const result = await loadMarkupSetPages(set.drawingId).catch(() => null);
  if (!result?.ok || !result.data) {
    toast({ title: "The markup set could not be opened. Try again in a moment.", variant: "warning" });
    return;
  }
  const { sha256, filename, pages } = result.data;
  const bytes = await blankPagesPdf(pages);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], filename, { type: "application/pdf" });
  const shown = { ...set, sha256, filename };
  markupSetsUi.setState((s) => ({ blank: { ...s.blank, [sha256]: { set: shown } } }));
  openDocumentAs(file, sha256);
}

/**
 * Opens `set` with `file`: the same bytes open as usual (the markups restore);
 * other bytes open the markups on blank pages and say why.
 */
export async function openSetWithFile(set: MarkupSetSummary, file: File): Promise<void> {
  let sha: string | null = null;
  try {
    sha = await sha256Of(file);
  } catch {
    sha = null;
  }
  if (sha === set.sha256) {
    openDocument(file);
    return;
  }
  toast({ title: `${file.name} is not the file these markups were made on. They open on blank pages.`, variant: "info" });
  await openOnBlankPages(set);
}

/** The blank-pages notice: which file and how many pages, and a way to open the PDF. */
export function blankPagesText(set: MarkupSetSummary): string {
  return `Markups on blank pages: ${set.filename}, ${set.pageCount} ${set.pageCount === 1 ? "page" : "pages"}`;
}

/** Shows the blank-pages notice while the shown document is a stand-in, until dismissed. */
export function useBlankPagesHint(): void {
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const dismissed = useStore(viewerStore, (s) => s.dismissedNotices.includes(BLANK_PAGES_HINT_ID));
  const entry = useStore(markupSetsUi, (s) => (documentId ? s.blank[documentId] : undefined));
  const standIn = useStore(viewerStore, (s) => s.standIn);
  useEffect(() => {
    // Only while the tab shows the blank pages (the PDF itself replaces them).
    if (!entry || !standIn || dismissed) return;
    showHint({
      id: BLANK_PAGES_HINT_ID,
      variant: "info",
      text: blankPagesText(entry.set),
      action: { label: OPEN_PDF, onAction: () => promptOpenSet(entry.set) },
      onDismiss: () => dismissNotice(BLANK_PAGES_HINT_ID),
    });
    return () => dismissHint(BLANK_PAGES_HINT_ID);
  }, [entry, standIn, dismissed]);
}

/** "3 Nov 2026, 14:05" in the user's locale. */
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Story 6.6 (FR51), the list: the user's markup sets, newest change first, with
 * filename, page count and last modified; an empty state. Open asks for the
 * set's PDF (OpenMarkupSetDialog).
 */
export function MarkupSetListDialog() {
  const open = useStore(markupSetsUi, (s) => s.listOpen);
  const state = useStore(markupSetsUi, (s) => s.list);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => markupSetsUi.setState({ listOpen: next })}
      title="Markup sets"
      description="Your markups, by the file they belong to. Open one to continue on its PDF, or on blank pages."
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
                <th className="py-1 pr-3 font-normal">Last modified</th>
                <th className="py-1 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
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
                  <td className="num py-1 pr-3">{when(set.lastModified)}</td>
                  <td className="py-1 text-right">
                    <Button size="sm" onClick={() => promptOpenSet(set)} aria-label={`Open ${set.filename}`}>
                      Open…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Story 6.6: opening a set asks for its PDF ("Choose PDF…"); "Blank pages"
 * shows the markups without it.
 */
export function OpenMarkupSetDialog() {
  const set = useStore(markupSetsUi, (s) => s.opening);
  const input = useRef<HTMLInputElement>(null);
  // The set Choose PDF… asked for (the dialog may close while the picker is open).
  const choosing = useRef<MarkupSetSummary | null>(null);
  const close = () => markupSetsUi.setState({ opening: null });
  return (
    <>
      <Dialog
        open={set !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={set ? `Open ${set.filename}` : "Open markup set"}
        description={
          set
            ? `Choose ${set.filename} on this computer to see the drawing under its markups, or open the markups on blank pages (${set.pageCount} ${set.pageCount === 1 ? "page" : "pages"}).`
            : undefined
        }
        footer={
          <DialogFooter
            secondary={
              <Button
                onClick={() => {
                  if (set) void openOnBlankPages(set);
                  close();
                }}
              >
                Blank pages
              </Button>
            }
            primary={
              <DialogPrimary
                onClick={() => {
                  choosing.current = set;
                  input.current?.click();
                }}
              >
                Choose PDF…
              </DialogPrimary>
            }
          />
        }
      />
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-testid="open-set-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const opening = choosing.current;
          choosing.current = null;
          if (!file || !opening) return;
          close();
          void openSetWithFile(opening, file);
        }}
      />
    </>
  );
}

/**
 * Story 6.6: the empty workspace's recent list, the user's newest sets
 * (loaded when the workspace is empty).
 */
export function useRecentSets(empty: boolean): { id: string; name: string; detail: string }[] {
  const recent = useStore(markupSetsUi, (s) => s.recent);
  useEffect(() => {
    if (empty) loadRecentSets();
  }, [empty]);
  return (recent ?? []).map((set) => ({
    id: set.drawingId,
    name: set.filename,
    detail: `${set.pageCount} ${set.pageCount === 1 ? "page" : "pages"} · ${when(set.lastModified)}`,
  }));
}

/** Opens recent set `drawingId` (asks for its PDF). */
export function openRecentSet(drawingId: string): void {
  const set = markupSetsUi.getState().recent?.find((s) => s.drawingId === drawingId);
  if (set) promptOpenSet(set);
}
