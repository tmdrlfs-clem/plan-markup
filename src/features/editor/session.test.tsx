// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import type { DocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";
import { tabsStore, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, pageMarkups, resetEditor } from "./editor-store";
import { closedTabs, parseSessionRecord, resetSessionTracking, sessionKey, useEditorSession } from "./session";
import { activeUndoLabels, clearUndo, executeOp, redoActive, registerDrawingUndo, undoActive } from "./undo-store";

const SHA = "b".repeat(64);
const USER = "user-1";
const length = (x = 72): Markup => ({
  id: uuidv7(),
  type: "length",
  pageId: `${SHA}:0`,
  createdAt: "2026-10-25T00:00:00.000Z",
  style: DEFAULT_MEASURE_STYLE,
  points: [
    { x: 0, y: 0 },
    { x, y: 0 },
  ],
});
const cal: Calibration = { xFactor: factorForRatio(75), yFactor: factorForRatio(75), unit: "mm", precision: "0", source: "ratio", ratio: 75 };
const tab = (id: string) => ({ id, fileName: "a.pdf", title: "a.pdf", status: "ready" as const, failed: false });
const add = (m: Markup): DocOp => ({ kind: "markups.add", documentId: SHA, markups: [m] });

function Session({ userId }: { userId: string }) {
  useEditorSession(userId);
  return null;
}

function openDoc(tabId: string, openSeq: number, documentId = SHA) {
  tabsStore.setState({ tabs: [tab(tabId)], activeId: tabId });
  viewerStore.setState({ tabId, openSeq, documentId, calibrations: {} });
}

const stored = () => parseSessionRecord(window.sessionStorage.getItem(sessionKey(USER, SHA)));

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionTracking();
});

afterEach(() => {
  cleanup();
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, openSeq: 0, calibrations: {} });
  tabsStore.setState({ tabs: [], activeId: null });
});

describe("op commands (Story 4.5 AC 4)", () => {
  it("Add length is one undo step; undo and redo remove and restore the markup", () => {
    openDoc("t1", 1);
    const m = length();
    executeOp(add(m), "Add length");
    expect(pageMarkups(editorStore.getState(), SHA, `${SHA}:0`)).toEqual([m]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Add length");
    expect(undoActive()).toBe(true);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    expect(redoActive()).toBe(true);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([m]);
  });

  it("a calibrations op writes the viewer's calibrations, only for the document shown", () => {
    openDoc("t1", 1);
    executeOp({ kind: "calibrations.set", documentId: SHA, before: { [`${SHA}:0`]: null }, after: { [`${SHA}:0`]: cal } }, "Calibrate page 1");
    expect(viewerStore.getState().calibrations).toEqual({ [`${SHA}:0`]: cal });
    undoActive();
    expect(viewerStore.getState().calibrations).toEqual({});
    viewerStore.setState({ documentId: "c".repeat(64) });
    redoActive();
    expect(viewerStore.getState().calibrations).toEqual({});
  });

  it("one history across calibrations and lengths: undo and redo step through both in order", () => {
    openDoc("t1", 1);
    const page = `${SHA}:0`;
    const cal100: Calibration = { ...cal, xFactor: factorForRatio(100), yFactor: factorForRatio(100), ratio: 100 };
    const a = length();
    const b = length(144);
    executeOp(add(a), "Add length");
    executeOp({ kind: "calibrations.set", documentId: SHA, before: { [page]: null }, after: { [page]: cal } }, "Calibrate page 1");
    executeOp(add(b), "Add length");
    executeOp({ kind: "calibrations.set", documentId: SHA, before: { [page]: cal }, after: { [page]: cal100 } }, "Calibrate page 1");
    const snapshot = () => ({ ids: markupsOf(editorStore.getState(), SHA).map((m) => m.id), cal: viewerStore.getState().calibrations[page]?.ratio ?? null });
    const states = [snapshot()];
    for (let i = 0; i < 4; i++) {
      undoActive();
      states.push(snapshot());
    }
    expect(states).toEqual([
      { ids: [a.id, b.id], cal: 100 },
      { ids: [a.id, b.id], cal: 75 },
      { ids: [a.id], cal: 75 },
      { ids: [a.id], cal: null },
      { ids: [], cal: null },
    ]);
    expect(undoActive()).toBe(false);
    for (let i = 3; i >= 0; i--) {
      redoActive();
      expect(snapshot()).toEqual(states[i]);
    }
  });

  it("while drawing, Undo takes the drawing's last point first (UX-DR35)", () => {
    openDoc("t1", 1);
    executeOp(add(length()), "Add length");
    let points = 1;
    const off = registerDrawingUndo(() => (points > 0 ? (points--, true) : false));
    expect(undoActive()).toBe(true);
    expect(points).toBe(0);
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(1);
    expect(undoActive()).toBe(true); // nothing drawn: the history's step
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(0);
    off();
  });
});

describe("editing session (Story 4.5 AC 6, UX-DR36)", () => {
  it("writes markups, calibrations and history as ops; a reload restores all three, undo included", () => {
    render(<Session userId={USER} />);
    act(() => openDoc("t1", 1));
    const m = length();
    act(() => executeOp(add(m), "Add length"));
    act(() => viewerStore.setState({ calibrations: { [`${SHA}:0`]: cal, ["d".repeat(64) + ":0"]: cal } }));
    const record = stored();
    expect(record?.markups).toEqual([m]);
    expect(record?.calibrations).toEqual({ [`${SHA}:0`]: cal }); // its own document only
    expect(record?.past.map((e) => e.label)).toEqual(["Add length"]);

    // A reload: everything in memory is gone, the same file opens in a new tab.
    cleanup();
    resetEditor();
    clearUndo();
    resetSessionTracking();
    viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
    render(<Session userId={USER} />);
    act(() => openDoc("t9", 7));
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([m]);
    expect(viewerStore.getState().calibrations).toEqual({ [`${SHA}:0`]: cal });
    expect(activeUndoLabels(editorStore.getState(), "t9").undo).toBe("Add length");
    act(() => {
      undoActive();
    });
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    expect(stored()?.future.map((e) => e.label)).toEqual(["Add length"]);
  });

  it("closing the document tab drops its history but keeps its markups", () => {
    render(<Session userId={USER} />);
    act(() => openDoc("t1", 1));
    act(() => executeOp(add(length()), "Add length"));
    act(() => {
      tabsStore.setState({ tabs: [], activeId: null });
      viewerStore.setState({ tabId: null, documentId: null, openSeq: 2 });
    });
    expect(stored()?.past).toEqual([]);
    expect(stored()?.markups).toHaveLength(1);
  });

  it("another user starts empty and never reads the first user's session", () => {
    const view = render(<Session userId={USER} />);
    act(() => openDoc("t1", 1));
    act(() => executeOp(add(length()), "Add length"));
    act(() => view.rerender(<Session userId="user-2" />));
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    act(() => openDoc("t1", 3));
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    expect(window.sessionStorage.getItem(sessionKey("user-2", SHA))).not.toBeNull();
    // Review R3: the first user's records left this browser tab's storage.
    expect(window.sessionStorage.getItem(sessionKey(USER, SHA))).toBeNull();
  });

  it("review R2: a record with anything of another document is ignored (its undo would change that document)", () => {
    const other = "f".repeat(64);
    const m = length();
    const ok = { v: 1, markups: [m], calibrations: { [`${SHA}:0`]: cal }, past: [{ label: "Add length", op: add(m) }], future: [] };
    expect(parseSessionRecord(JSON.stringify(ok), SHA)).not.toBeNull();
    const foreignOp = { ...ok, past: [{ label: "Add length", op: { ...add(m), documentId: other } }] };
    const foreignMarkup = { ...ok, markups: [{ ...m, pageId: `${other}:0` }] };
    const foreignCalibration = { ...ok, calibrations: { [`${other}:0`]: cal } };
    const foreignCalOp = {
      ...ok,
      future: [{ label: "Calibrate page 1", op: { kind: "calibrations.set", documentId: SHA, before: { [`${other}:0`]: null }, after: { [`${other}:0`]: cal } } }],
    };
    // A sha256 that only starts like this one is not this one.
    const prefix = { ...ok, markups: [{ ...m, pageId: `${SHA}0:0` }] };
    for (const bad of [foreignOp, foreignMarkup, foreignCalibration, foreignCalOp, prefix]) expect(parseSessionRecord(JSON.stringify(bad), SHA)).toBeNull();
    window.sessionStorage.setItem(sessionKey(USER, SHA), JSON.stringify(foreignOp));
    render(<Session userId={USER} />);
    act(() => openDoc("t1", 1));
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBeNull();
  });

  it("review R4: a closed tab drops its document's history unless the document is still shown (a duplicate tab closed)", () => {
    const docs = new Map([
      ["t1", "A"],
      ["t2", "A"],
      ["t3", "B"],
    ]);
    // The duplicate t2 closed, t1 shown: A keeps its history.
    expect(closedTabs(docs, new Set(["t1", "t3"]), "A")).toEqual({ closed: ["t2"], dropHistoryOf: [] });
    // The duplicate closed while t1 was never shown here (background): A is still open in t1.
    expect(closedTabs(docs, new Set(["t1", "t3"]), "B")).toEqual({ closed: ["t2"], dropHistoryOf: [] });
    // B's only tab closed while A is shown: B's history goes.
    expect(closedTabs(docs, new Set(["t1", "t2"]), "A")).toEqual({ closed: ["t3"], dropHistoryOf: ["B"] });
    // Everything closed: both go, once each.
    expect(closedTabs(docs, new Set(), null)).toEqual({ closed: ["t1", "t2", "t3"], dropHistoryOf: ["A", "B"] });
  });

  it("an unusable record is ignored, never trusted", () => {
    expect(parseSessionRecord(null)).toBeNull();
    expect(parseSessionRecord("{not json")).toBeNull();
    expect(parseSessionRecord(JSON.stringify({ v: 2, markups: [] }))).toBeNull();
    expect(parseSessionRecord(JSON.stringify({ v: 1, markups: [{ id: "x" }], calibrations: {}, past: [], future: [] }))).toBeNull();
    window.sessionStorage.setItem(sessionKey(USER, SHA), "garbage");
    render(<Session userId={USER} />);
    act(() => openDoc("t1", 1));
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });
});
