// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import type { DocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";
import { tabsStore, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, pageMarkups, resetEditor } from "./editor-store";
import { parseSessionRecord, resetSessionTracking, sessionKey, useEditorSession } from "./session";
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
