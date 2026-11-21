"use client";

// The Markups List (Story 6.7, FR45, UX-DR28, UX-DR38): every markup of the
// active document in a grid, page order then drawing order. Only the rows in
// view are rendered (fixed 28 px rows), so thousands scroll smoothly.
//
// Selection follows the canvas both ways: a row selects its markup (Ctrl adds
// or removes, Shift selects a range; on another page the page is shown first
// and only that page's rows stay selected, since the canvas selects on one
// page, Story 5.1 D4). Double-click or Enter zooms to the markup.
// Keyboard: arrows move the active cell (Up / Down select its row, Shift
// extends), Home / End the row's first / last cell, Ctrl+Home / Ctrl+End the
// first / last row, Page Up / Page Down a screen, Space selects (Ctrl+Space
// toggles).
//
// Story 6.8 (FR46): a header click sorts (ascending, descending, none); the
// quick filter needs every word somewhere in a row; Filter adds column filters
// (type, page, colour, layer). Active filters show as removable chips, and the
// count reads "Showing 24 of 312". The view is the session's, for every
// document (D1).

import {
  ChevronUp,
  FileSpreadsheet,
  Link2,
  Paperclip,
  Angle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Circle,
  Cloud,
  CloudCog,
  Diameter,
  Eraser,
  Filter,
  Hash,
  Hexagon,
  Highlighter,
  ImagePlus,
  MessageSquareText,
  Pen,
  Pentagon,
  Radius,
  Route,
  Ruler,
  RulerDimensionLine,
  Slash,
  Spline,
  Square,
  SquareDashed,
  StickyNote,
  Strikethrough,
  Type,
  TypeOutline,
  Underline,
  X,
  type LucideIcon,
  FileBadge,
  TableProperties,
  LandPlot,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { ArcIcon } from "@/components/ui/extra-icons";
import { Menu, MenuCheckboxItem, MenuContent, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from "@/components/ui/menu";
import { markupBounds } from "@/core/markup/geometry";
import { withGroups } from "@/core/markup/arrange";
import {
  EMPTY_VIEW,
  FILTER_KEYS,
  FILTER_LABELS,
  applyListView,
  countText,
  filterOptions,
  isFiltered,
  markupListRows,
  nextSort,
  visibleRange,
  type FilterKey,
  type ListPage,
  type ListView,
  type MarkupListRow,
  type SortKey,
} from "@/core/markup/markup-list";
import { SUBJECT_NAMES } from "@/core/markup/properties";
import { summaryCsv, summaryFileName } from "@/core/markup/summary";
import { pageIdOf } from "@/core/calibration/calibration";
import { sheetLabelOf } from "@/core/pdf/sheet-label";
import type { Layer } from "@/core/schema/layer";
import type { Markup, MarkupType } from "@/core/schema/markup";
import { hasDocument, setTool, viewerCommands, viewerStore, type ViewerState } from "@/features/viewer";

import { editorStore, layersOf, markupsOf, setSelection } from "./editor-store";

export const ROW_HEIGHT = 28;

const TYPE_ICONS: Record<MarkupType, LucideIcon> = {
  length: Ruler,
  polylength: Route,
  area: Pentagon,
  count: Hash,
  angle: Angle,
  radius: Radius,
  diameter: Diameter,
  line: Slash,
  arrow: ArrowUpRight,
  polyline: Spline,
  polygon: Hexagon,
  arc: ArcIcon,
  rectangle: Square,
  ellipse: Circle,
  cloud: Cloud,
  cloudplus: CloudCog,
  text: Type,
  typewriter: TypeOutline,
  note: StickyNote,
  callout: MessageSquareText,
  pen: Pen,
  highlight: Highlighter,
  image: ImagePlus,
  dimension: RulerDimensionLine,
  underline: Underline,
  texthighlight: Highlighter,
  squiggly: Underline,
  caret: ChevronUp,
  link: Link2,
  attachment: Paperclip,
  strikethrough: Strikethrough,
  whiteout: SquareDashed,
  eraser: Eraser,
  revision: FileBadge,
  legend: TableProperties,
  zone: LandPlot,
};

type Column = { key: string; label: string; width: string; sort?: SortKey; cell: (row: MarkupListRow, ctx: CellContext) => React.ReactNode; title?: (row: MarkupListRow) => string };
type CellContext = { author: string };

/** "7 Nov 2026, 14:05" in the user's locale. */
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Comments and review status arrive with the review epics; until then each reads "—" (D2). */
const NONE = "—";

export const MARKUP_LIST_COLUMNS: readonly Column[] = [
  {
    key: "type",
    label: "Type",
    width: "40px",
    cell: (row) => {
      const Icon = TYPE_ICONS[row.type];
      return (
        <>
          <Icon size={14} aria-hidden="true" />
          <span className="sr-only">{SUBJECT_NAMES[row.type]}</span>
        </>
      );
    },
    title: (row) => SUBJECT_NAMES[row.type],
    sort: "type",
  },
  { key: "subject", label: "Subject", width: "minmax(120px, 2fr)", sort: "subject", cell: (row) => row.subject, title: (row) => row.subject },
  { key: "page", label: "Page", width: "minmax(64px, 1fr)", sort: "page", cell: (row) => row.page, title: (row) => row.page },
  { key: "comments", label: "Comments", width: "80px", cell: () => NONE },
  { key: "date", label: "Date", width: "minmax(132px, 1fr)", sort: "date", cell: (row) => when(row.date) },
  { key: "author", label: "Author", width: "minmax(96px, 1fr)", cell: (_row, ctx) => ctx.author, title: () => "" },
  { key: "status", label: "Status", width: "72px", cell: () => NONE },
  {
    key: "color",
    label: "Colour",
    width: "84px",
    sort: "color",
    cell: (row) => (
      <>
        <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-[2px] border border-strong" style={{ backgroundColor: row.color }} />
        <span className="num">{row.color.toLowerCase()}</span>
      </>
    ),
  },
  { key: "layer", label: "Layer", width: "minmax(72px, 1fr)", sort: "layer", cell: (row) => row.layer, title: (row) => row.layer },
  { key: "device", label: "Device", width: "minmax(96px, 1fr)", sort: "device", cell: (row) => row.device, title: (row) => row.device },
  { key: "value", label: "Measurement", width: "minmax(96px, 1fr)", sort: "value", cell: (row) => <span className="num">{row.value}</span> },
];

const TEMPLATE = MARKUP_LIST_COLUMNS.map((c) => c.width).join(" ");

/** Story 6.8: the list's sort and filters this session (D1: one view for every document). */
export const markupListView = createStore<ListView>(() => EMPTY_VIEW);

function toggleFilter(key: FilterKey, value: string, on: boolean): void {
  markupListView.setState((v) => {
    const current = v.filters[key] ?? [];
    const next = on ? [...current.filter((x) => x !== value), value] : current.filter((x) => x !== value);
    return { filters: { ...v.filters, [key]: next } };
  });
}

function clearFilter(key: FilterKey): void {
  markupListView.setState((v) => ({ filters: { ...v.filters, [key]: [] } }));
}

/** Clears the filters and the quick filter (the sort stays). */
export function clearListFilters(): void {
  markupListView.setState({ filters: {}, quick: "" });
}

/** Selects `ids` of `row`'s page (showing that page first when another is shown); with their groups. */
function selectOnPage(row: MarkupListRow, ids: readonly string[], rows: readonly MarkupListRow[]): void {
  const viewer = viewerStore.getState();
  if (viewer.tool !== "select") setTool("select");
  if (viewer.pageIndex !== row.pageIndex) viewerCommands.goToPage(row.pageIndex);
  const onPage = new Set(rows.filter((r) => r.pageIndex === row.pageIndex && ids.includes(r.id)).map((r) => r.id));
  const markups = markupsOf(editorStore.getState(), viewer.documentId).filter((m) => m.pageId === row.markup.pageId);
  setSelection(withGroups(markups, [...onPage]));
}

/** Shows the markup zoomed to and selects it (double-click, Enter). */
function reveal(row: MarkupListRow, rows: readonly MarkupListRow[]): void {
  if (viewerStore.getState().tool !== "select") setTool("select");
  viewerCommands.revealMarkup(row.pageIndex, markupBounds(row.markup));
  selectOnPage(row, [row.id], rows);
}

export function MarkupsListPanel({ author, emptyText = "Markups you add appear here.", noDrawingText = "Open a drawing to see its markups." }: { author: string; emptyText?: string; noDrawingText?: string }) {
  const shown = useStore(viewerStore, hasDocument);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const pages = useStore(viewerStore, (s) => s.pages);
  const calibrations = useStore(viewerStore, (s) => s.calibrations);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const markups = useStore(editorStore, (s) => markupsOf(s, documentId));
  const layers = useStore(editorStore, (s) => layersOf(s, documentId));

  const rows = useMemo(
    () => listRowsOf({ documentId, pages, calibrations, pageLabels, sheetLabels }, markups, layers),
    [documentId, pages, calibrations, pageLabels, sheetLabels, markups, layers],
  );

  const view = useStore(markupListView);
  const visible = useMemo(() => applyListView(rows, view), [rows, view]);

  if (!shown || !documentId) return <p className="p-3 text-ws-md text-muted">{noDrawingText}</p>;
  if (rows.length === 0) {
    return (
      <p className="p-3 text-ws-md text-muted" data-testid="markups-list-empty">
        {emptyText}
      </p>
    );
  }
  const filtered = isFiltered(view);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar rows={rows} view={view} count={countText(visible.length, rows.length, filtered)} onSummary={() => downloadSummary(visible, author)} />
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 p-3 text-ws-md text-muted" data-testid="markups-list-no-match">
          <span>No markups match the filters.</span>
          <Button size="sm" onClick={clearListFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <MarkupGrid rows={visible} author={author} sort={view.sort} />
      )}
    </div>
  );
}

/** The quick filter, the Filter menu, the active filters as chips and the count. */
type ListSource = Pick<ViewerState, "documentId" | "pages" | "calibrations" | "pageLabels" | "sheetLabels">;

/** The list's rows of the shown drawing (Story 9.2: zones are listed in the 4541 panel, not here). */
function listRowsOf(v: ListSource, markups: readonly Markup[], layers: readonly Layer[]): MarkupListRow[] {
  const { documentId } = v;
  if (!documentId) return [];
  const listPages: ListPage[] = v.pages.map((p, i) => ({
    label: sheetLabelOf(i + 1, v.pageLabels?.[i], v.sheetLabels[i])?.short ?? `Page ${i + 1}`,
    calibration: v.calibrations[pageIdOf(documentId, i)] ?? null,
    userUnit: p.userUnit && p.userUnit > 0 ? p.userUnit : 1,
  }));
  return markupListRows(markups.filter((m) => m.type !== "zone"), documentId, listPages, layers);
}

/** Summary from anywhere (the toolbar): the shown drawing's markups as the list shows them, as a CSV file. */
export function downloadMarkupSummary(author: string): void {
  const v = viewerStore.getState();
  const e = editorStore.getState();
  downloadSummary(applyListView(listRowsOf(v, markupsOf(e, v.documentId), layersOf(e, v.documentId)), markupListView.getState()), author);
}

/** Summary: the rows as shown (sorted and filtered) downloaded as a CSV file. */
function downloadSummary(rows: readonly MarkupListRow[], author: string): void {
  const name = summaryFileName(viewerStore.getState().fileName ?? "Markups");
  const url = URL.createObjectURL(new Blob([summaryCsv(rows, author)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ListToolbar({ rows, view, count, onSummary }: { rows: readonly MarkupListRow[]; view: ListView; count: string; onSummary: () => void }) {
  const chips = FILTER_KEYS.filter((k) => (view.filters[k]?.length ?? 0) > 0);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1" role="toolbar" aria-label="Markups list filters">
      <input
        type="search"
        aria-label="Quick filter"
        placeholder="Filter markups"
        value={view.quick}
        onChange={(event) => markupListView.setState({ quick: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape" && view.quick !== "") {
            event.stopPropagation();
            markupListView.setState({ quick: "" });
          }
        }}
        className="h-6 w-48 rounded-sm border border-strong bg-surface-2 px-2 text-ws-md text-text placeholder:text-muted focus-ring"
      />
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm">
            <Filter size={14} aria-hidden="true" />
            Filter
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {FILTER_KEYS.map((key) => (
            <MenuSub key={key}>
              <MenuSubTrigger>{FILTER_LABELS[key]}</MenuSubTrigger>
              <MenuSubContent className="max-h-80 overflow-y-auto">
                {filterOptions(rows, key).map((value) => (
                  <MenuCheckboxItem
                    key={value}
                    checked={view.filters[key]?.includes(value) ?? false}
                    onCheckedChange={(on) => toggleFilter(key, value, on === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {value}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          ))}
        </MenuContent>
      </Menu>
      {view.quick.trim() !== "" ? (
        <Chip label={`“${view.quick.trim()}”`} remove="Remove quick filter" onRemove={() => markupListView.setState({ quick: "" })} />
      ) : null}
      {chips.map((key) => (
        <Chip key={key} label={`${FILTER_LABELS[key]}: ${(view.filters[key] ?? []).join(", ")}`} remove={`Remove ${FILTER_LABELS[key]} filter`} onRemove={() => clearFilter(key)} />
      ))}
      <span className="ml-auto text-ws-sm text-muted num" data-testid="markups-list-count" aria-live="polite">
        {count}
      </span>
      <Button size="sm" title="Download the markups shown (sorted and filtered as here) as a CSV summary" onClick={onSummary}>
        <FileSpreadsheet size={14} aria-hidden="true" />
        Summary
      </Button>
    </div>
  );
}

function Chip({ label, remove, onRemove }: { label: string; remove: string; onRemove: () => void }) {
  return (
    <span data-testid="markups-list-chip" className="inline-flex h-6 max-w-64 items-center gap-1 rounded-sm border border-strong bg-surface-2 pl-2 text-ws-sm">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button type="button" aria-label={remove} title={remove} onClick={onRemove} className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:text-text focus-ring">
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

function MarkupGrid({ rows, author, sort }: { rows: readonly MarkupListRow[]; author: string; sort: ListView["sort"] }) {
  const selected = useStore(editorStore, (s) => s.selection.ids);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(ROW_HEIGHT * 10);
  const [active, setActive] = useState({ row: 0, col: 0 });
  const anchor = useRef<string | null>(null);
  const ctx = { author };

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const activeRow = Math.min(active.row, rows.length - 1);
  const activeCol = active.col;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight - ROW_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Scrolls row `index` into view (below the sticky header). */
  const scrollToRow = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    const view = el.clientHeight - ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + view) el.scrollTop = top + ROW_HEIGHT - view;
  };

  // A selection made on the canvas scrolls its first row into view (not while the grid has focus).
  const firstSelected = rows.findIndex((r) => selectedSet.has(r.id));
  useEffect(() => {
    if (firstSelected < 0) return;
    const el = scroller.current;
    if (el && el.contains(document.activeElement)) return;
    scrollToRow(firstSelected);
  }, [firstSelected]);

  const choose = (index: number, mode: "only" | "toggle" | "range") => {
    const row = rows[index];
    if (!row) return;
    let ids: string[];
    if (mode === "toggle") ids = selectedSet.has(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id];
    else if (mode === "range") {
      const from = Math.max(0, rows.findIndex((r) => r.id === anchor.current));
      const [a, b] = from <= index ? [from, index] : [index, from];
      ids = rows.slice(a, b + 1).map((r) => r.id);
    } else ids = [row.id];
    if (mode !== "range") anchor.current = row.id;
    selectOnPage(row, ids, rows);
  };

  const moveTo = (row: number, col: number, select: "only" | "range" | null) => {
    const r = Math.max(0, Math.min(rows.length - 1, row));
    const c = Math.max(0, Math.min(MARKUP_LIST_COLUMNS.length - 1, col));
    setActive({ row: r, col: c });
    scrollToRow(r);
    if (select) choose(r, select);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey) return;
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? ROW_HEIGHT * 10) / ROW_HEIGHT) - 1);
    const follow = event.ctrlKey ? null : event.shiftKey ? "range" : "only";
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        moveTo(activeRow + 1, activeCol, follow);
        break;
      case "ArrowUp":
        moveTo(activeRow - 1, activeCol, follow);
        break;
      case "ArrowRight":
        moveTo(activeRow, activeCol + 1, null);
        break;
      case "ArrowLeft":
        moveTo(activeRow, activeCol - 1, null);
        break;
      case "PageDown":
        moveTo(activeRow + page, activeCol, follow);
        break;
      case "PageUp":
        moveTo(activeRow - page, activeCol, follow);
        break;
      case "Home":
        if (event.ctrlKey) moveTo(0, activeCol, event.shiftKey ? "range" : "only");
        else moveTo(activeRow, 0, null);
        break;
      case "End":
        if (event.ctrlKey) moveTo(rows.length - 1, activeCol, event.shiftKey ? "range" : "only");
        else moveTo(activeRow, MARKUP_LIST_COLUMNS.length - 1, null);
        break;
      case " ":
        choose(activeRow, event.ctrlKey ? "toggle" : event.shiftKey ? "range" : "only");
        break;
      case "Enter":
        reveal(rows[activeRow], rows);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const onRowClick = (event: MouseEvent, index: number) => {
    setActive((a) => ({ row: index, col: a.col }));
    choose(index, event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : "only");
  };

  const { start, end } = visibleRange(scrollTop, height, ROW_HEIGHT, rows.length);
  const cellId = (row: number, col: number) => `markups-list-cell-${row}-${col}`;

  return (
    <div
      ref={scroller}
      role="grid"
      aria-label="Markups"
      aria-rowcount={rows.length + 1}
      aria-colcount={MARKUP_LIST_COLUMNS.length}
      aria-multiselectable="true"
      aria-activedescendant={cellId(activeRow, activeCol)}
      tabIndex={0}
      data-testid="markups-list"
      data-rows={rows.length}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (activeRow >= start && activeRow < end) return;
        scrollToRow(activeRow);
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="group relative h-full min-h-0 overflow-auto text-ws-md outline-none"
    >
      <div role="row" aria-rowindex={1} className="sticky top-0 z-10 grid min-w-max border-b border-border bg-surface-2 text-ws-sm text-muted" style={{ gridTemplateColumns: TEMPLATE, height: ROW_HEIGHT }}>
        {MARKUP_LIST_COLUMNS.map((column) => {
          const sorted = column.sort && sort?.key === column.sort ? sort.dir : null;
          return (
            <div
              key={column.key}
              role="columnheader"
              aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : column.sort ? "none" : undefined}
              className="flex min-w-0 items-center font-medium"
            >
              {column.sort ? (
                <button
                  type="button"
                  onClick={() => markupListView.setState((v) => ({ sort: nextSort(v.sort, column.sort!) }))}
                  className="flex h-full w-full min-w-0 items-center gap-1 px-2 text-left hover:text-text"
                >
                  <span className="truncate">{column.label}</span>
                  {sorted === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : sorted === "desc" ? <ArrowDown size={12} aria-hidden="true" /> : null}
                </button>
              ) : (
                <span className="truncate px-2">{column.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
        {rows.slice(start, end).map((row, i) => {
          const index = start + i;
          const isSelected = selectedSet.has(row.id);
          return (
            <div
              key={row.id}
              role="row"
              aria-rowindex={index + 2}
              aria-selected={isSelected}
              data-testid="markups-list-row"
              data-id={row.id}
              onClick={(event) => onRowClick(event, index)}
              onDoubleClick={() => reveal(row, rows)}
              className={cx("absolute left-0 grid min-w-max w-full cursor-default", isSelected ? "bg-accent-soft text-text" : "hover:bg-surface-3")}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: TEMPLATE }}
            >
              {MARKUP_LIST_COLUMNS.map((column, col) => (
                <div
                  key={column.key}
                  id={cellId(index, col)}
                  role="gridcell"
                  title={column.title?.(row) || undefined}
                  className={cx(
                    "flex min-w-0 items-center gap-1.5 truncate px-2",
                    index === activeRow && col === activeCol && "group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-accent",
                  )}
                >
                  {column.cell(row, ctx)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
