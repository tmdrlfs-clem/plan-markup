// Search in one open drawing (Story 3.6). One DocumentSearch per ViewerEngine,
// so the query, the options, the hits and the current hit are per document tab
// and survive tab switches (AC 6).
//
// Text comes from the render worker (render.text: items with quads and the
// normalised page text, read once per page and cached there). The current page
// is asked for first, then the others in order, at the worker's text priority
// (after tiles). Matching (src/core/search/match.ts) runs here on the main
// thread in time slices: pages are matched until SLICE_MS has passed, then the
// rest continues in a later task, so a search never blocks the canvas (AC 5).
//
// The query is debounced (DEBOUNCE_MS); options apply at once. Highlights show
// while the Search panel is open and the search has not been hidden (Esc).

import { createStore } from "zustand/vanilla";

import { boundsOf, findMatches, matchQuads, snippetOf, type SearchOptions } from "@/core/search/match";
import { normalizeQuery, type Quad } from "@/core/search/page-text";
import type { Rect } from "@/core/render/view";
import type { TextResult } from "@/workers/render-protocol";

/** Typing settles this long before the search runs (AC 1). */
export const DEBOUNCE_MS = 150;
/** Matching yields to the event loop after this long (ms). */
export const SLICE_MS = 8;

export type SearchSnippet = { before: string; match: string; after: string };

/** One result: its page (0-based), an excerpt, its quads in page space, their box and the text height (points). */
export type SearchHit = { page: number; snippet: SearchSnippet; quads: Quad[]; bounds: Rect; textHeight: number };

export type SearchState = {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Pages whose text has been searched for the current query, of `pageCount`. */
  pagesDone: number;
  pageCount: number;
  /** Results in page order. */
  hits: SearchHit[];
  /** Index of the current hit in `hits`, or -1. */
  current: number;
  /** Pages (0-based) with no searchable text, among those read so far. */
  noText: number[];
  /** Pages whose text could not be read. */
  failedPages: number;
  /** Highlights are shown (Esc hides them until the next search or move). */
  visible: boolean;
  /** Bumped each time next / previous wrapped around ("Search wrapped"). */
  wrapped: number;
};

const INITIAL: SearchState = {
  query: "",
  matchCase: false,
  wholeWord: false,
  pagesDone: 0,
  pageCount: 0,
  hits: [],
  current: -1,
  noText: [],
  failedPages: 0,
  visible: true,
  wrapped: 0,
};

/** What the search needs from its engine. */
export interface SearchHost {
  readonly pageCount: number;
  readonly currentPage: number;
  /** Asks the worker for a page's text (0-based page); `cancel` drops the request. */
  requestText(page: number): { promise: Promise<TextResult>; cancel: () => void };
  /** Shows the page and brings the page-space rectangle into view; 	extHeight (points) decides the zoom. */
  revealHit(page: number, bounds: Rect, textHeight: number): void;
  /** The highlights changed: redraw. */
  changed(): void;
  /** Whether highlights may show at all (the Search panel is open). */
  highlightsAllowed(): boolean;
}

/** The highlights of a page: every hit's quads and the current hit's. */
export type PageHighlights = { hits: Quad[][]; current: Quad[] | null };

type Key = { page: number; n: number };

/** The tallest quad's height (bottom-left to top-left), in points. */
function textHeightOf(quads: readonly Quad[]): number {
  let height = 0;
  for (const q of quads) height = Math.max(height, Math.hypot(q[6] - q[0], q[7] - q[1]));
  return height;
}

let searches = 0;

export class DocumentSearch {
  /** Unique per search (the panel keys its local state by it). */
  readonly id = ++searches;
  readonly store = createStore<SearchState>(() => INITIAL);
  private texts = new Map<number, TextResult>();
  private failed = new Set<number>();
  private requests = new Map<number, () => void>();
  /** Hits per page for the current query (null: not searched yet). */
  private perPage: (SearchHit[] | null)[] = [];
  private currentKey: Key | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private slice: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per document and per run: late text or slices for an older one are dropped. */
  private generation = 0;
  private documentGeneration = 0;
  private paused = false;
  private destroyed = false;

  constructor(
    private readonly host: SearchHost,
    private readonly now: () => number = () => performance.now(),
  ) {}

  private get state(): SearchState {
    return this.store.getState();
  }

  // ---- document lifecycle ---------------------------------------------------

  /** A new document is open (or none, `pageCount` 0): texts and hits go, the query and options stay. */
  reset(pageCount: number): void {
    this.cancelRequests();
    this.clearTimers();
    this.texts = new Map();
    this.failed = new Set();
    this.perPage = [];
    this.currentKey = null;
    this.documentGeneration++;
    this.generation++;
    this.store.setState({ pageCount, pagesDone: 0, hits: [], current: -1, noText: [], failedPages: 0 });
    if (pageCount > 0 && this.active()) this.run();
    this.host.changed();
  }

  /** The tab went to the background: text requests stop (they come back on resume). */
  pause(): void {
    this.paused = true;
    this.cancelRequests();
    if (this.slice) clearTimeout(this.slice);
    this.slice = null;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.active()) {
      this.requestTexts();
      this.scheduleSlice(this.generation);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRequests();
    this.clearTimers();
  }

  // ---- query and options ------------------------------------------------------

  /** The query as typed: shown at once, searched after DEBOUNCE_MS. */
  setQuery(query: string): void {
    if (query === this.state.query) return;
    this.store.setState({ query, visible: true });
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.run();
    }, DEBOUNCE_MS);
  }

  setOptions(options: Partial<SearchOptions>): void {
    this.store.setState({ ...options, visible: true });
    this.flush();
  }

  /** Runs a pending debounced search now (Enter right after typing). */
  flush(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.run();
  }

  /** The Search panel opened: read every page's text now (the no-text notes need it). */
  prefetch(): void {
    if (this.state.pageCount > 0) this.requestTexts();
  }

  /** Esc: highlights off until the next search or move. */
  hide(): void {
    if (!this.state.visible) return;
    this.store.setState({ visible: false });
    this.host.changed();
  }

  show(): void {
    if (this.state.visible) return;
    this.store.setState({ visible: true });
    this.host.changed();
  }

  // ---- moving between hits ------------------------------------------------------

  /** Next (1) or previous (-1) hit, wrapping around; from the shown page when none is current. */
  step(direction: 1 | -1): void {
    if (this.debounce) this.flush();
    const { hits, current } = this.state;
    if (hits.length === 0) return;
    let index: number;
    let wrapped = false;
    if (current < 0) {
      const page = this.host.currentPage;
      if (direction === 1) {
        index = hits.findIndex((h) => h.page >= page);
        if (index < 0) {
          index = 0;
          wrapped = true;
        }
      } else {
        index = -1;
        for (let i = hits.length - 1; i >= 0; i--) {
          if (hits[i].page <= page) {
            index = i;
            break;
          }
        }
        if (index < 0) {
          index = hits.length - 1;
          wrapped = true;
        }
      }
    } else {
      index = current + direction;
      if (index >= hits.length) {
        index = 0;
        wrapped = true;
      } else if (index < 0) {
        index = hits.length - 1;
        wrapped = true;
      }
    }
    this.goTo(index, wrapped);
  }

  /** Shows hit `index` (a click in the list, next / previous). */
  goTo(index: number, wrapped = false): void {
    const hit = this.state.hits[index];
    if (!hit) return;
    this.currentKey = { page: hit.page, n: this.perPage[hit.page]?.indexOf(hit) ?? 0 };
    this.store.setState((s) => ({ current: index, visible: true, wrapped: wrapped ? s.wrapped + 1 : s.wrapped }));
    this.host.revealHit(hit.page, hit.bounds, hit.textHeight);
    this.host.changed();
  }

  // ---- highlights -------------------------------------------------------------

  /** The highlights of page `page` (0-based), or null when none show. */
  highlights(page: number): PageHighlights | null {
    const { visible, hits, current } = this.state;
    if (!visible || hits.length === 0 || !this.host.highlightsAllowed()) return null;
    const onPage = this.perPage[page];
    if (!onPage || onPage.length === 0) return null;
    const currentHit = hits[current];
    return {
      hits: onPage.map((h) => h.quads),
      current: currentHit && currentHit.page === page ? currentHit.quads : null,
    };
  }

  // ---- internals ------------------------------------------------------------------

  private active(): boolean {
    return normalizeQuery(this.state.query).text !== "";
  }

  private clearTimers(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.slice) clearTimeout(this.slice);
    this.debounce = null;
    this.slice = null;
  }

  private cancelRequests(): void {
    for (const cancel of this.requests.values()) cancel();
    this.requests.clear();
  }

  /** Starts a search for the current query and options (results replace the old ones as pages are matched). */
  private run(): void {
    if (this.destroyed) return;
    const generation = ++this.generation;
    if (this.slice) clearTimeout(this.slice);
    this.slice = null;
    const { pageCount } = this.state;
    this.perPage = Array.from({ length: pageCount }, () => null);
    if (!this.active() || pageCount === 0) {
      this.currentKey = null;
      this.store.setState({ hits: [], current: -1, pagesDone: 0 });
      this.host.changed();
      return;
    }
    this.store.setState({ pagesDone: 0, hits: [], current: -1, visible: true });
    this.requestTexts();
    this.scheduleSlice(generation, 0);
  }

  /** Asks the worker for every page's text not held yet: the shown page first, then in order. */
  private requestTexts(): void {
    if (this.paused || this.destroyed) return;
    const { pageCount } = this.state;
    const first = Math.min(Math.max(0, this.host.currentPage), Math.max(0, pageCount - 1));
    const order = [first, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== first)];
    const documentGeneration = this.documentGeneration;
    for (const page of order) {
      if (this.texts.has(page) || this.failed.has(page) || this.requests.has(page)) continue;
      const { promise, cancel } = this.host.requestText(page);
      this.requests.set(page, cancel);
      promise.then(
        (text) => {
          if (documentGeneration !== this.documentGeneration || this.destroyed) return;
          this.requests.delete(page);
          this.texts.set(page, text);
          if (text.index.text === "") this.store.setState((s) => ({ noText: [...s.noText, page].sort((a, b) => a - b) }));
          this.scheduleSlice(this.generation);
        },
        (e: unknown) => {
          if (documentGeneration !== this.documentGeneration || this.destroyed) return;
          if (this.requests.get(page) === cancel) this.requests.delete(page);
          // Cancelled (pause, a new document): asked again later. A real failure: the page counts as done.
          if ((e as { code?: unknown } | null)?.code === "cancelled") return;
          this.failed.add(page);
          this.store.setState((s) => ({ failedPages: s.failedPages + 1 }));
          this.scheduleSlice(this.generation);
        },
      );
    }
  }

  private scheduleSlice(generation: number, delay = 0): void {
    if (this.slice || this.paused || this.destroyed || generation !== this.generation || !this.active()) return;
    this.slice = setTimeout(() => {
      this.slice = null;
      this.matchSlice(generation);
    }, delay);
  }

  /** Matches held pages until SLICE_MS has passed; publishes; continues later if pages are left. */
  private matchSlice(generation: number): void {
    if (generation !== this.generation || !this.active()) return;
    const { query, matchCase, wholeWord } = this.state;
    const needle = normalizeQuery(query);
    const options = { matchCase, wholeWord };
    const t0 = this.now();
    let changed = false;
    let more = false;
    let matched = 0;
    for (let page = 0; page < this.perPage.length; page++) {
      if (this.perPage[page] !== null) continue;
      const text = this.texts.get(page);
      if (!text) {
        if (this.failed.has(page)) {
          this.perPage[page] = [];
          changed = true;
        }
        continue;
      }
      // At least one page per slice, so a slow clock never starves the search.
      if (matched > 0 && this.now() - t0 >= SLICE_MS) {
        more = true;
        break;
      }
      matched++;
      this.perPage[page] = findMatches(text.index, needle, options).map((m) => {
        const quads = matchQuads(text.items, text.index, m);
        const bounds = boundsOf(quads) ?? { x: 0, y: 0, width: 0, height: 0 };
        return { page, snippet: snippetOf(text.index, m), quads, bounds, textHeight: textHeightOf(quads) };
      });
      changed = true;
    }
    if (changed) this.publish();
    if (more) this.scheduleSlice(generation);
  }

  private publish(): void {
    const hits: SearchHit[] = [];
    let pagesDone = 0;
    for (const onPage of this.perPage) {
      if (onPage === null) continue;
      pagesDone++;
      hits.push(...onPage);
    }
    let current = -1;
    const key = this.currentKey;
    if (key) {
      const hit = this.perPage[key.page]?.[key.n];
      current = hit ? hits.indexOf(hit) : -1;
    }
    this.store.setState({ hits, pagesDone, current });
    this.host.changed();
  }
}
