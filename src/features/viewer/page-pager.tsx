"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { ESCAPE_LOCAL_ATTR } from "@/components/ui/dialog-shared";
import { FieldShell, fieldControlClasses } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { pageForLabel, sheetLabelOf, type SheetLabel } from "@/core/pdf/sheet-label";

import { viewerCommands } from "./viewer-commands";
import { hasDocument, viewerStore, type ViewerState } from "./viewer-store";

/**
 * The page a typed pager entry names (AC 3): a page number in 1…pageCount, or a
 * page / sheet label typed exactly; null (revert silently) otherwise.
 */
export function resolvePageEntry(
  text: string,
  pageCount: number,
  pageLabels: readonly string[] | null,
  sheetLabels: Readonly<Record<number, string | null>>,
): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n >= 1 && n <= pageCount) return n - 1;
  }
  return pageForLabel(trimmed, pageLabels, sheetLabels);
}

/** The shown page's sheet label (page label first, then the detected number). */
export function currentSheetLabel(s: Pick<ViewerState, "pageIndex" | "pageLabels" | "sheetLabels">): SheetLabel | null {
  return sheetLabelOf(s.pageIndex + 1, s.pageLabels?.[s.pageIndex], s.sheetLabels[s.pageIndex]);
}

/** "Page 3 of 12, A1721": the canvas label and the status bar's announcement (AC 2, AC 6). */
export function pageAnnouncement(pageIndex: number, pageCount: number, label: SheetLabel | null): string {
  return `Page ${pageIndex + 1} of ${pageCount}${label ? `, ${label.short}` : ""}`;
}

/**
 * Status-bar PagePager (UX-DR7, UX-DR8): first / previous / page number / next /
 * last, "of n" and the sheet label. Hidden while no drawing is shown.
 */
export function PagePager() {
  const shown = useStore(viewerStore, hasDocument);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const pageCount = useStore(viewerStore, (s) => s.pageCount);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const inputId = useId();
  // The text being typed; null shows the current page number.
  const [draft, setDraft] = useState<string | null>(null);
  if (!shown) return null;

  const label = sheetLabelOf(pageIndex + 1, pageLabels?.[pageIndex], sheetLabels[pageIndex]);
  const atStart = pageIndex <= 0;
  const atEnd = pageIndex >= pageCount - 1;
  const single = pageCount <= 1 ? "This drawing has one page" : undefined;

  function commit() {
    if (draft === null) return;
    const target = resolvePageEntry(draft, pageCount, pageLabels, sheetLabels);
    setDraft(null); // anything else reverts silently
    if (target !== null) viewerCommands.goToPage(target);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      viewerCommands.focusCanvas();
    }
  }

  return (
    <div role="group" aria-label="Pages" className="flex h-6 items-center gap-0.5 px-1 [&_button]:h-6 [&_button]:w-6">
      <IconButton
        label="First page"
        icon={ChevronsLeft}
        shortcut="Home"
        disabled={atStart}
        disabledReason={single ?? "Already on the first page"}
        onClick={viewerCommands.firstPage}
      />
      <IconButton
        label="Previous page"
        icon={ChevronLeft}
        shortcut="PageUp Ctrl+←"
        disabled={atStart}
        disabledReason={single ?? "Already on the first page"}
        onClick={viewerCommands.previousPage}
      />
      <FieldShell layout="workspace" label="Page number" htmlFor={inputId} labelHidden>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={draft ?? String(pageIndex + 1)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={onKeyDown}
          {...{ [ESCAPE_LOCAL_ATTR]: draft !== null ? "" : undefined }}
          className={`${fieldControlClasses("workspace", false)} num h-5! w-12! px-1! text-center text-ws-xs!`}
        />
      </FieldShell>
      <span className="num whitespace-nowrap px-1 text-ws-xs text-text">
        / {pageCount}
      </span>
      <IconButton
        label="Next page"
        icon={ChevronRight}
        shortcut="PageDown Ctrl+→"
        disabled={atEnd}
        disabledReason={single ?? "Already on the last page"}
        onClick={viewerCommands.nextPage}
      />
      <IconButton
        label="Last page"
        icon={ChevronsRight}
        shortcut="End"
        disabled={atEnd}
        disabledReason={single ?? "Already on the last page"}
        onClick={viewerCommands.lastPage}
      />
      {label ? (
        <Tooltip content={label.full}>
          <span data-testid="sheet-label" tabIndex={0} className="num max-w-[160px] truncate rounded-sm px-1 text-ws-xs text-text focus-ring">
            {label.short}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
