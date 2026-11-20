// @vitest-environment jsdom
// Closing a drawing changed since its last PDF asks first (founder 2026-11-20).
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveAs = vi.fn();
vi.mock("./export-dialog", () => ({ saveAs: (...args: unknown[]) => saveAs(...args) }));

import { activeUndoLabels, clearUndo, editorStore, executeCommand, markTabSaved, markTabUnsaved, redoActive, registerFallbackUndo, tabChangedSinceSaved, undoActive } from "@/features/editor";
import { tabsStore, viewerStore, viewerTabs, type DocumentTab } from "@/features/viewer";

import { SavePrompt, savePromptStore } from "./save-prompt";

const tab = (id: string): DocumentTab => ({ id, fileName: `${id}.pdf`, title: id, status: "ready", failed: false });
const step = (label: string) => ({ label, do: () => undefined, undo: () => undefined });

let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The viewer's state first: the tab manager publishes its own (empty) strip when it changes.
  viewerStore.setState({ tabId: "t1" });
  tabsStore.setState({ tabs: [tab("t1"), tab("t2")], activeId: "t1" });
  close = vi.spyOn(viewerTabs, "close").mockImplementation(() => undefined);
  // The manager's own entries are not opened here: the strip's tabs stand for them.
  vi.spyOn(viewerTabs as unknown as { find: (id: string) => unknown }, "find").mockImplementation((id) => tabsStore.getState().tabs.find((t) => t.id === id));
});
afterEach(() => {
  vi.restoreAllMocks();
  saveAs.mockClear();
  clearUndo();
  savePromptStore.setState({ tabId: null });
  tabsStore.setState({ tabs: [], activeId: null });
  viewerStore.setState({ tabId: null });
});

describe("tabChangedSinceSaved", () => {
  it("is a change after a step, none after the PDF save, and none again when undone back to it", () => {
    expect(tabChangedSinceSaved("t1")).toBe(false);
    executeCommand(step("Add"), "t1");
    expect(tabChangedSinceSaved("t1")).toBe(true);
    expect(tabChangedSinceSaved("t2")).toBe(false);
    markTabSaved("t1");
    expect(tabChangedSinceSaved("t1")).toBe(false);
    executeCommand(step("Move"), "t1");
    expect(tabChangedSinceSaved("t1")).toBe(true);
    undoActive();
    expect(tabChangedSinceSaved("t1")).toBe(false);
    undoActive();
    expect(tabChangedSinceSaved("t1")).toBe(true);
    redoActive();
    expect(tabChangedSinceSaved("t1")).toBe(false);
  });

  it("a drawing flattened in place (not on the computer yet) is a change until its PDF is saved", () => {
    markTabUnsaved("t1");
    expect(tabChangedSinceSaved("t1")).toBe(true);
    markTabSaved("t1");
    expect(tabChangedSinceSaved("t1")).toBe(false);
  });
});

describe("Undo with no step left (Flatten in place)", () => {
  it("runs the fallback and the menus name it", () => {
    const run = vi.fn(() => true);
    const off = registerFallbackUndo({ label: (tabId) => (tabId === "t1" ? "Flatten" : null), run });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Flatten");
    expect(activeUndoLabels(editorStore.getState(), "t2").undo).toBeNull();
    expect(undoActive()).toBe(true);
    expect(run).toHaveBeenCalledWith("t1");
    executeCommand(step("Add"), "t1");
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Add");
    off();
    undoActive();
    expect(undoActive()).toBe(false);
  });
});

describe("SavePrompt", () => {
  it("closes an unchanged drawing without asking", () => {
    render(<SavePrompt />);
    act(() => viewerTabs.requestClose("t2"));
    expect(close).toHaveBeenCalledWith("t2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before closing a changed drawing: Cancel keeps it, Close without PDF closes it", async () => {
    const user = userEvent.setup();
    render(<SavePrompt />);
    executeCommand(step("Add"), "t1");
    act(() => viewerTabs.requestClose("t1"));
    expect(close).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Save a PDF of t1.pdf?" });
    expect(dialog).toHaveTextContent("Your markups stay saved in Plan Markup either way.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();

    act(() => viewerTabs.requestClose("t1"));
    await user.click(await screen.findByRole("button", { name: "Close without PDF" }));
    expect(close).toHaveBeenCalledWith("t1");
  });

  it("Save as PDF… saves that drawing, then closes it", async () => {
    const user = userEvent.setup();
    render(<SavePrompt />);
    executeCommand(step("Add"), "t1");
    act(() => viewerTabs.requestClose("t1"));
    await user.click(await screen.findByRole("button", { name: "Save as PDF…" }));
    expect(saveAs).toHaveBeenCalledWith("t1", { thenClose: true });
    expect(close).not.toHaveBeenCalled();
  });
});
