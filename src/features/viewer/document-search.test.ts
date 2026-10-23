import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPageText, type TextItem } from "@/core/search/page-text";
import type { TextResult } from "@/workers/render-protocol";

import { DEBOUNCE_MS, DocumentSearch, type SearchHost } from "./document-search";

function item(str: string, x: number, y: number, width = str.length * 6): TextItem {
  return { str, x, y, width, fontSize: 10, quad: [x, y + 2, x + width, y + 2, x + width, y - 8, x, y - 8], eol: false };
}

const text = (items: TextItem[]): TextResult => ({ items, index: buildPageText(items) });

const PAGES: TextResult[] = [
  text([item("CH +2700", 10, 100), item("ROOM 1", 10, 130)]),
  text([]), // an image-only page
  text([item("ch +2700", 10, 100), item("CH", 10, 200, 12), item("+2700", 25, 200, 30)]),
];

type Request = { page: number; resolve: (t: TextResult) => void; reject: (e: unknown) => void; cancelled: boolean };

let requests: Request[];
let revealed: { page: number; bounds: unknown }[];
let changed: number;
let allowed: boolean;
let currentPage: number;
let pageCount: number;

function makeSearch(now: () => number = () => performance.now()) {
  const host: SearchHost = {
    get pageCount() {
      return pageCount;
    },
    get currentPage() {
      return currentPage;
    },
    requestText(page) {
      let resolve!: (t: TextResult) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<TextResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const request: Request = { page, resolve, reject, cancelled: false };
      requests.push(request);
      return {
        promise,
        cancel: () => {
          request.cancelled = true;
          reject({ code: "cancelled" });
        },
      };
    },
    revealHit: (page, bounds) => revealed.push({ page, bounds }),
    changed: () => void changed++,
    highlightsAllowed: () => allowed,
  };
  return new DocumentSearch(host, now);
}

/** Answers every open request with the page's text. */
async function answerAll() {
  for (const r of requests) if (!r.cancelled) r.resolve(PAGES[r.page]);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  revealed = [];
  changed = 0;
  allowed = true;
  currentPage = 0;
  pageCount = 3;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocumentSearch", () => {
  it("debounces typing, asks for every page's text (shown page first) and finds hits across pages", async () => {
    currentPage = 2;
    const search = makeSearch();
    search.reset(3);
    search.setQuery("ch +27");
    expect(search.store.getState().query).toBe("ch +27");
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(requests.map((r) => r.page)).toEqual([2, 0, 1]);
    await answerAll();
    const s = search.store.getState();
    expect(s.pagesDone).toBe(3);
    expect(s.hits.map((h) => h.page)).toEqual([0, 2, 2]);
    expect(s.hits[0].snippet).toEqual({ before: "", match: "CH +27", after: "00 ROOM 1" });
    expect(s.noText).toEqual([1]);
    // Typing again re-uses the texts: no new requests.
    search.setQuery("room");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(requests).toHaveLength(3);
    expect(search.store.getState().hits).toHaveLength(1);
  });

  it("Match case and Whole word apply at once", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("CH");
    search.flush();
    await answerAll();
    expect(search.store.getState().hits).toHaveLength(3);
    search.setOptions({ matchCase: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().hits).toHaveLength(2);
    search.setOptions({ matchCase: false, wholeWord: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().hits).toHaveLength(3);
    search.setQuery("ROO");
    search.flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().hits).toHaveLength(0);
  });

  it("next / previous start from the shown page, wrap around with a 'wrapped' signal, and reveal each hit", async () => {
    currentPage = 1;
    const search = makeSearch();
    search.reset(3);
    search.setQuery("+2700");
    search.flush();
    await answerAll();
    search.step(1);
    expect(search.store.getState().current).toBe(1); // the first hit on page 2 (index 2) or after
    expect(revealed.at(-1)?.page).toBe(2);
    search.step(1);
    search.step(1);
    expect(search.store.getState()).toMatchObject({ current: 0, wrapped: 1 });
    expect(revealed.at(-1)?.page).toBe(0);
    search.step(-1);
    expect(search.store.getState()).toMatchObject({ current: 2, wrapped: 2 });
  });

  it("keeps the current hit while later pages are matched, and highlights only while allowed and visible", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("+2700");
    search.flush();
    requests[0].resolve(PAGES[0]); // page 0 only
    await vi.advanceTimersByTimeAsync(1);
    search.goTo(0);
    const hit = search.store.getState().hits[0];
    await answerAll();
    expect(search.store.getState().hits[search.store.getState().current]).toBe(hit);
    const marks = search.highlights(0)!;
    expect(marks.hits).toHaveLength(1);
    expect(marks.current).toBe(hit.quads);
    expect(search.highlights(1)).toBeNull();
    expect(search.highlights(2)?.current).toBeNull();
    search.hide();
    expect(search.highlights(0)).toBeNull();
    search.show();
    allowed = false;
    expect(search.highlights(0)).toBeNull();
  });

  it("matches in time slices: past SLICE_MS the rest waits for a later task (at least one page per slice)", async () => {
    let t = 0;
    const search = makeSearch(() => (t += 20)); // every clock read is past the slice budget
    search.reset(3);
    search.setQuery("ch");
    search.flush();
    const done: number[] = [];
    search.store.subscribe((s, prev) => {
      if (s.pagesDone !== prev.pagesDone) done.push(s.pagesDone);
    });
    await answerAll();
    await vi.advanceTimersByTimeAsync(5);
    // One page per slice, each published on its own.
    expect(done).toEqual([1, 2, 3]);
  });
  it("a background tab stops its text requests and asks again on resume; a new document clears texts but keeps the query", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("ch");
    search.flush();
    search.pause();
    expect(requests.every((r) => r.cancelled)).toBe(true);
    search.resume();
    expect(requests.filter((r) => !r.cancelled)).toHaveLength(3);
    await answerAll();
    expect(search.store.getState().hits).toHaveLength(3);
    const before = requests.length;
    search.reset(3);
    expect(search.store.getState()).toMatchObject({ query: "ch", hits: [], current: -1, noText: [] });
    expect(requests.length - before).toBe(3); // asked again for the new document
  });

  it("prefetch reads the texts before any query (the no-text notes); a failed page counts as searched", async () => {
    const search = makeSearch();
    search.reset(3);
    search.prefetch();
    expect(requests).toHaveLength(3);
    requests[1].resolve(PAGES[1]);
    requests[2].reject({ code: "render-failed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState()).toMatchObject({ noText: [1], failedPages: 1 });
    requests[0].resolve(PAGES[0]);
    await vi.advanceTimersByTimeAsync(1);
    search.setQuery("room");
    search.flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState()).toMatchObject({ pagesDone: 3 });
    expect(search.store.getState().hits).toHaveLength(1);
  });

  it("an empty query clears the hits; destroy stops everything", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("ch");
    search.flush();
    await answerAll();
    search.setQuery("  ");
    search.flush();
    expect(search.store.getState().hits).toEqual([]);
    search.setQuery("room");
    search.destroy();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(search.store.getState().hits).toEqual([]);
  });

  it("a new query or new options start without a current hit: the old one's page and number mean nothing now (review R1)", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("+2700");
    search.flush();
    await answerAll();
    search.goTo(2);
    expect(search.store.getState().current).toBe(2);
    search.setQuery("ch");
    search.flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().hits.length).toBeGreaterThan(2);
    expect(search.store.getState().current).toBe(-1);
    expect(search.highlights(2)?.current).toBeNull();
    search.goTo(1);
    search.setOptions({ wholeWord: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().current).toBe(-1);
  });

  it("Enter right after typing moves to the first hit once the results are in (review R2)", async () => {
    const search = makeSearch();
    search.reset(3);
    search.setQuery("+2700");
    search.step(1); // inside the debounce: nothing to move to yet
    expect(revealed).toEqual([]);
    await answerAll();
    expect(revealed.map((r) => r.page)).toEqual([0]);
    expect(search.store.getState().current).toBe(0);
  });

  it("a pending move waits only for the pages between the shown one and the nearest hit; typing drops it (review R2)", async () => {
    currentPage = 1;
    const search = makeSearch();
    search.reset(3);
    search.setQuery("+2700");
    search.flush();
    search.step(1);
    const answer = async (page: number) => {
      requests.find((r) => r.page === page && !r.cancelled)!.resolve(PAGES[page]);
      await vi.advanceTimersByTimeAsync(1);
    };
    await answer(1); // the shown page: no text, no hit; page 2 is not read yet
    expect(revealed).toEqual([]);
    await answer(2);
    expect(revealed.map((r) => r.page)).toEqual([2]);
    expect(search.store.getState().hits[search.store.getState().current].page).toBe(2);

    // Typing after Enter: the move is dropped.
    search.setQuery("room");
    search.step(1);
    search.setQuery("room 1");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    await answer(0);
    expect(revealed).toHaveLength(1);
  });

  it("lists a page's hits by position, top to bottom and left to right, not in the PDF's drawing order (review R6)", async () => {
    pageCount = 1;
    const search = makeSearch();
    search.reset(1);
    search.setQuery("d1");
    search.flush();
    // Drawn bottom-right first.
    requests[0].resolve(text([item("D1", 300, 400), item("D1", 10, 400), item("D1", 200, 100), item("D1", 20, 101)]));
    await vi.advanceTimersByTimeAsync(1);
    expect(search.store.getState().hits.map((h) => [h.bounds.x, h.bounds.y + 8])).toEqual([
      [20, 101],
      [200, 100],
      [10, 400],
      [300, 400],
    ]);
    search.step(1);
    expect(search.store.getState().current).toBe(0);
    // Other copies of the matched text are not "nearby".
    expect(search.nearbyOf(search.store.getState().hits[0])).toEqual([]);
  });
});
