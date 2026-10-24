import { afterEach, describe, expect, it } from "vitest";

import { tabsStore, viewerStore } from "@/features/viewer";

import { activeUndoLabels, clearUndo, executeCommand, redoActive, undoActive, undoStore } from "./undo-store";

const log: string[] = [];
const command = (label: string) => ({ label, do: () => log.push(`do ${label}`), undo: () => log.push(`undo ${label}`) });

afterEach(() => {
  clearUndo();
  log.length = 0;
  viewerStore.setState({ tabId: null });
  tabsStore.setState({ tabs: [], activeId: null });
});

describe("undo per tab (Story 4.3 AC 7)", () => {
  it("keeps one history per tab; undo and redo act on the active tab only", () => {
    viewerStore.setState({ tabId: "doc-1" });
    executeCommand(command("A"));
    viewerStore.setState({ tabId: "doc-2" });
    executeCommand(command("B"));
    expect(activeUndoLabels(undoStore.getState(), "doc-1")).toEqual({ undo: "A", redo: null });
    expect(undoActive()).toBe(true);
    expect(undoActive()).toBe(false); // doc-2 has nothing more
    expect(activeUndoLabels(undoStore.getState(), "doc-2")).toEqual({ undo: null, redo: "B" });
    expect(redoActive()).toBe(true);
    expect(redoActive()).toBe(false);
    expect(log).toEqual(["do A", "do B", "undo B", "do B"]);
  });

  it("a closed tab's history is dropped", () => {
    tabsStore.setState({ tabs: [{ id: "doc-1", fileName: "a", title: "a", status: "ready", failed: false }], activeId: "doc-1" });
    viewerStore.setState({ tabId: "doc-1" });
    executeCommand(command("A"));
    expect(Object.keys(undoStore.getState().histories)).toEqual(["doc-1"]);
    tabsStore.setState({ tabs: [], activeId: null });
    expect(undoStore.getState().histories).toEqual({});
  });
});
