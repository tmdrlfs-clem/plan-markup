"use client";

import { CaseSensitive, ChevronDown, ChevronUp, WholeWord } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import { ToggleButton } from "@/components/ui/toggle-button";
import { sheetLabelOf } from "@/core/pdf/sheet-label";

import type { DocumentSearch, SearchHit, SearchState } from "./document-search";
import { searchUi } from "./search-ui";
import { activeSearch, viewerCommands } from "./viewer-commands";
import { hasDocument, viewerStore } from "./viewer-store";

/** Height of a result row (px): fixed, so the list is virtualised by arithmetic. */
export const RESULT_ROW = 28;
const OVERSCAN = 6;
/** "Search wrapped" stays this long (ms). */
const WRAPPED_MS = 2500;

export const SEARCH_SHORTCUTS = { next: "Enter F3", previous: "Shift+Enter Shift+F3" } as const;

type Row = { kind: "page"; page: number; count: number } | { kind: "hit"; hit: number } | { kind: "note"; page: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * How a result row describes its hit (review decision 2026-10-24): the matched
 * text and the text nearest to it on the sheet ("CH +2700 · CT.02 · D1"); the
 * matched text alone when nothing is near (the row's locator still places it).
 */
export function hitDescription(hit: SearchHit, nearby: readonly string[]): { match: string; context: string } {
  return { match: hit.snippet.match, context: nearby.join(" · ") };
}

/** Where a hit sits on its page, as shares of the page's width and height (the row's locator). */
export function hitPlace(hit: SearchHit, page: { width: number; height: number } | undefined): { x: number; y: number } | null {
  if (!page || page.width <= 0 || page.height <= 0) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((hit.bounds.x + hit.bounds.width / 2) / page.width),
    y: clamp((hit.bounds.y + hit.bounds.height / 2) / page.height),
  };
}

/** The status line under the field (AC 1, 2, 4). */
export function searchStatus(s: Pick<SearchState, "query" | "hits" | "pagesDone" | "pageCount" | "noText">): string {
  if (s.query.trim() === "") return "Type to find text on the drawing.";
  const pages = new Set(s.hits.map((h) => h.page)).size;
  const found = s.hits.length === 0 ? "No results" : `${plural(s.hits.length, "result")} on ${plural(pages, "page")}`;
  if (s.pagesDone < s.pageCount) return `${found} so far · searching ${s.pagesDone} of ${plural(s.pageCount, "page")}`;
  return found;
}

/** The rows of the result list: a header per page with hits, then its hits; per-page notes when no page has text. */
export function resultRows(s: Pick<SearchState, "hits" | "noText" | "pageCount" | "pagesDone">): Row[] {
  const rows: Row[] = [];
  // No page has text (a scan): say so per page, query or not.
  if (s.pageCount > 0 && s.noText.length === s.pageCount) {
    for (const page of s.noText) rows.push({ kind: "page", page, count: 0 }, { kind: "note", page });
    return rows;
  }
  let page = -1;
  s.hits.forEach((hit, i) => {
    if (hit.page !== page) {
      page = hit.page;
      let count = 0;
      for (let j = i; j < s.hits.length && s.hits[j].page === page; j++) count++;
      rows.push({ kind: "page", page, count });
    }
    rows.push({ kind: "hit", hit: i });
  });
  return rows;
}

/**
 * The Search panel (Story 3.6, FR21): a query field, Match case / Whole word,
 * previous / next, a status line and the results grouped by page. It follows
 * the active document tab; each tab keeps its own search.
 */
export function SearchPanel({ emptyText }: { emptyText: string }) {
  const search = useStore(activeSearch, (s) => s.search);
  const shown = useStore(viewerStore, hasDocument);

  // Highlights show while the panel is open (AC 6).
  useEffect(() => {
    searchUi.setState({ panelOpen: true });
    return () => searchUi.setState({ panelOpen: false });
  }, []);

  if (!shown || !search) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>{emptyText}</p>
      </div>
    );
  }
  return <SearchBody key={search.id} search={search} />;
}

function SearchBody({ search }: { search: DocumentSearch }) {
  const state = useStore(search.store);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const pages = useStore(viewerStore, (s) => s.pages);
  const focusRequest = useStore(searchUi, (s) => s.focusRequest);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const [height, setHeight] = useState(400);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeRow, setActiveRow] = useState<{ hit: number; run: string } | null>(null);
  // The keyboard's row belongs to one set of results: a new query or new options start over.
  const run = JSON.stringify([state.query, state.matchCase, state.wholeWord]);
  const active = activeRow && activeRow.run === run && activeRow.hit < state.hits.length ? activeRow.hit : null;
  const setActive = (hit: number) => setActiveRow({ hit, run });
  /** The last wrap whose "Search wrapped" has faded. */
  const [fadedWrap, setFadedWrap] = useState(0);

  // The texts are read as soon as the panel shows (the no-text notes need them).
  useEffect(() => search.prefetch(), [search]);

  // Ctrl+F: focus and select the query.
  useEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // "Search wrapped", quietly, for a moment.
  const wrapped = state.wrapped;
  const wrappedShown = wrapped !== 0 && wrapped !== fadedWrap;
  useEffect(() => {
    if (wrapped === 0) return;
    const timer = setTimeout(() => setFadedWrap(wrapped), WRAPPED_MS);
    return () => clearTimeout(timer);
  }, [wrapped]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight || 400);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const rows = resultRows(state);
  const rowOfHit = (hit: number) => rows.findIndex((r) => r.kind === "hit" && r.hit === hit);
  const focusedHit = active ?? (state.current >= 0 ? state.current : state.hits.length > 0 ? 0 : null);

  // The current hit (F3, Enter) and the keyboard's row stay in view.
  const reveal = (hit: number | null) => {
    const el = listRef.current;
    if (!el || hit === null) return;
    const row = rowOfHit(hit);
    if (row < 0) return;
    const top = row * RESULT_ROW;
    const viewHeight = el.clientHeight || height;
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - RESULT_ROW);
    else if (top + RESULT_ROW > el.scrollTop + viewHeight) el.scrollTop = top + RESULT_ROW - viewHeight;
    setScrollTop(el.scrollTop);
  };
  const current = state.current;
  useLayoutEffect(() => {
    reveal(current >= 0 ? current : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the current hit only
  }, [current]);

  const go = (hit: number) => {
    setActive(hit);
    search.goTo(hit);
    // Revu hands the keyboard to the canvas (founder decision 2026-10-23).
    viewerCommands.focusCanvas();
  };

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      search.step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      search.hide();
      viewerCommands.focusCanvas();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || state.hits.length === 0) return;
    const last = state.hits.length - 1;
    const from = focusedHit ?? 0;
    const page = Math.max(1, Math.floor(height / RESULT_ROW) - 1);
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, from + 1),
      ArrowUp: Math.max(0, from - 1),
      Home: 0,
      End: last,
      PageDown: Math.min(last, from + page),
      PageUp: Math.max(0, from - page),
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      go(from);
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(moves[event.key]);
    reveal(moves[event.key]);
  }

  const first = Math.max(0, Math.floor(scrollTop / RESULT_ROW) - OVERSCAN);
  const lastRow = Math.min(rows.length - 1, Math.ceil((scrollTop + height) / RESULT_ROW) + OVERSCAN);
  const shownRows = new Set<number>();
  for (let i = first; i <= lastRow; i++) shownRows.add(i);
  // The focused row always exists, so aria-activedescendant points at an element.
  const focusedRow = focusedHit === null ? -1 : rowOfHit(focusedHit);
  if (focusedRow >= 0) shownRows.add(focusedRow);

  const pageName = (page: number) => {
    const label = sheetLabelOf(page + 1, pageLabels?.[page], sheetLabels[page]);
    return label ? `Page ${page + 1} · ${label.short}` : `Page ${page + 1}`;
  };
  const noTextSummary =
    state.noText.length > 0 && state.noText.length < state.pageCount
      ? `${plural(state.noText.length, "page has", "pages have")} no searchable text`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="search-panel">
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <TextField
          ref={inputRef}
          label="Find"
          type="text"
          value={state.query}
          placeholder="Text on the drawing"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onFieldKeyDown}
          className="h-8 text-ws-md"
        />
        <div className="flex items-center gap-1">
          <ToggleButton label="Match case" icon={CaseSensitive} pressed={state.matchCase} onPressedChange={(matchCase) => search.setOptions({ matchCase })} />
          <ToggleButton label="Whole word" icon={WholeWord} pressed={state.wholeWord} onPressedChange={(wholeWord) => search.setOptions({ wholeWord })} />
          <span className="flex-1" />
          <IconButton
            label="Previous result"
            icon={ChevronUp}
            shortcut={SEARCH_SHORTCUTS.previous}
            disabled={state.hits.length === 0}
            disabledReason="No results"
            onClick={() => search.step(-1)}
          />
          <IconButton
            label="Next result"
            icon={ChevronDown}
            shortcut={SEARCH_SHORTCUTS.next}
            disabled={state.hits.length === 0}
            disabledReason="No results"
            onClick={() => search.step(1)}
          />
        </div>
        <p role="status" aria-live="polite" data-testid="search-status" className="min-h-4 text-ws-sm text-muted">
          {wrappedShown ? "Search wrapped · " : ""}
          {searchStatus(state)}
        </p>
        {noTextSummary ? (
          <p data-testid="search-no-text" className="text-ws-sm text-muted">
            {noTextSummary}
          </p>
        ) : null}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Search results"
        tabIndex={0}
        aria-activedescendant={focusedRow >= 0 ? `${idBase}-hit-${focusedHit}` : undefined}
        data-testid="search-results"
        onKeyDown={onListKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="group relative min-h-0 flex-1 overflow-y-auto outline-none focus-ring"
      >
        <div className="relative" style={{ height: rows.length * RESULT_ROW }}>
          {[...shownRows]
            .sort((a, b) => a - b)
            .map((i) => {
              const row = rows[i];
              const top = i * RESULT_ROW;
              if (row.kind === "page") {
                return (
                  <div
                    key={`p${row.page}`}
                    aria-hidden="true"
                    className="absolute inset-x-0 flex items-center gap-2 bg-surface-2 px-2 text-ws-sm font-medium text-muted"
                    style={{ top, height: RESULT_ROW }}
                  >
                    <span className="num truncate">{pageName(row.page)}</span>
                    {row.count > 0 ? <span className="num ml-auto">{row.count}</span> : null}
                  </div>
                );
              }
              if (row.kind === "note") {
                return (
                  <div
                    key={`n${row.page}`}
                    role="option"
                    aria-selected={false}
                    aria-disabled={true}
                    id={`${idBase}-note-${row.page}`}
                    data-testid="search-no-text-page"
                    className="absolute inset-x-0 flex items-center px-3 text-ws-md text-muted"
                    style={{ top, height: RESULT_ROW }}
                  >
                    No searchable text on this page
                  </div>
                );
              }
              const hit = state.hits[row.hit];
              const { match, context } = hitDescription(hit, search.nearbyOf(hit));
              const place = hitPlace(hit, pages[hit.page]);
              return (
                <div
                  key={`h${row.hit}`}
                  id={`${idBase}-hit-${row.hit}`}
                  role="option"
                  aria-selected={row.hit === state.current}
                  aria-label={`${pageName(hit.page)}: ${match}${context ? `, near ${context}` : ""}`}
                  data-testid="search-hit"
                  data-current={row.hit === state.current ? "true" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(row.hit)}
                  className={cx(
                    "absolute inset-x-0 flex cursor-default items-center gap-2 px-3 text-ws-md",
                    row.hit === state.current ? "bg-accent-soft text-text" : "hover:bg-surface-3",
                    row.hit === focusedHit && "group-focus-visible:ring-2",
                  )}
                  style={{ top, height: RESULT_ROW }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <mark className="bg-transparent font-semibold text-text">{match}</mark>
                    {context ? <span className="text-muted" data-testid="search-hit-context">{` · ${context}`}</span> : null}
                  </span>
                  {place ? (
                    // Where the hit is on the sheet: a dot in a page outline.
                    <span
                      aria-hidden="true"
                      data-testid="search-hit-place"
                      className="relative h-3 w-4 shrink-0 rounded-sm border border-strong"
                    >
                      <span
                        className="absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text"
                        style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%` }}
                      />
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
