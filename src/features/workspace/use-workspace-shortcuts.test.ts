// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { handleWorkspaceShortcut, type WorkspaceShortcutHandlers } from "./use-workspace-shortcuts";

function handlers(): WorkspaceShortcutHandlers {
  return { open: vi.fn(), showLeftPanel: vi.fn(), toggleMarkupsList: vi.fn(), hideAllPanels: vi.fn() };
}

function key(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("handleWorkspaceShortcut", () => {
  it("Ctrl+F opens Search anywhere in the workspace while a drawing is open; dialog and form fields and no drawing keep the browser's (review R3)", () => {
    const h = { ...handlers(), search: vi.fn(), searchStep: vi.fn() };
    const ctrlF = (target?: EventTarget) => key({ ctrlKey: true, code: "KeyF", key: "f" }, target);
    const canvas = document.createElement("canvas");
    const searchField = document.createElement("input");
    const pageNumber = document.createElement("input");
    const toolbarButton = document.createElement("button");
    for (const target of [canvas, searchField, pageNumber, toolbarButton, document.body]) {
      expect(handleWorkspaceShortcut(ctrlF(target), h)).toBe(true);
    }
    expect(h.search).toHaveBeenCalledTimes(5);
    // A text field in a dialog or a form: the browser's find.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogField = document.createElement("input");
    dialog.append(dialogField);
    const form = document.createElement("form");
    const formField = document.createElement("textarea");
    form.append(formField);
    expect(handleWorkspaceShortcut(ctrlF(dialogField), h)).toBe(false);
    expect(handleWorkspaceShortcut(ctrlF(formField), h)).toBe(false);
    // A button in a dialog is not a text field: in-app.
    const dialogButton = document.createElement("button");
    dialog.append(dialogButton);
    expect(handleWorkspaceShortcut(ctrlF(dialogButton), h)).toBe(true);
    // Shift+Ctrl+F is not ours; without a drawing (no handler) neither is Ctrl+F.
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, shiftKey: true, code: "KeyF", key: "F" }, canvas), h)).toBe(false);
    expect(handleWorkspaceShortcut(ctrlF(canvas), handlers())).toBe(false);
    expect(h.search).toHaveBeenCalledTimes(6);
  });

  it("F3 / Shift+F3 step through the results anywhere in the workspace, also in its fields; not in a dialog's field (review R9)", () => {
    const h = { ...handlers(), search: vi.fn(), searchStep: vi.fn() };
    const field = document.createElement("input");
    expect(handleWorkspaceShortcut(key({ key: "F3", code: "F3" }, field), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ key: "F3", code: "F3", shiftKey: true }), h)).toBe(true);
    expect(h.searchStep.mock.calls).toEqual([[1], [-1]]);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const dialogField = document.createElement("input");
    dialog.append(dialogField);
    expect(handleWorkspaceShortcut(key({ key: "F3", code: "F3" }, dialogField), h)).toBe(false);
    expect(handleWorkspaceShortcut(key({ key: "F3", code: "F3" }), handlers())).toBe(false);
  });

  it("Story 4.3: Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo; not in a text field or a dialog, nor without a drawing", () => {
    const h = { ...handlers(), undo: vi.fn(), redo: vi.fn() };
    const canvas = document.createElement("canvas");
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyZ", key: "z" }, canvas), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyY", key: "y" }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, shiftKey: true, code: "KeyZ", key: "Z" }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ metaKey: true, code: "KeyZ", key: "z" }), h)).toBe(true);
    expect(h.undo).toHaveBeenCalledTimes(2);
    expect(h.redo).toHaveBeenCalledTimes(2);
    const field = document.createElement("input");
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyZ", key: "z" }, field), h)).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyZ", key: "z" }, button), h)).toBe(false);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyZ", key: "z" }), handlers())).toBe(false);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, altKey: true, code: "KeyZ", key: "z" }), h)).toBe(false);
  });

  it("Ctrl+O opens, also from a field; Cmd+O on macOS", () => {
    const h = handlers();
    const input = document.createElement("input");
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyO", key: "o" }, input), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ metaKey: true, code: "KeyO", key: "o" }), h)).toBe(true);
    expect(h.open).toHaveBeenCalledTimes(2);
  });

  it("Alt panel keys use event.code (macOS Alt+4 gives another key)", () => {
    const h = handlers();
    expect(handleWorkspaceShortcut(key({ altKey: true, code: "Digit4", key: "¢" }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ altKey: true, code: "KeyX", key: "≈" }), h)).toBe(true);
    expect(h.showLeftPanel).toHaveBeenNthCalledWith(1, "sprinkler");
    expect(h.showLeftPanel).toHaveBeenNthCalledWith(2, "tool-chest");
  });

  it("Story 4.5: Shift+Alt+L arms Length (by code), not in fields or dialogs, not without a drawing", () => {
    const h = { ...handlers(), lengthTool: vi.fn() };
    const shiftAltL = (target?: EventTarget) => key({ shiftKey: true, altKey: true, code: "KeyL", key: "Ł" }, target);
    expect(handleWorkspaceShortcut(shiftAltL(), h)).toBe(true);
    expect(h.lengthTool).toHaveBeenCalledTimes(1);
    expect(handleWorkspaceShortcut(shiftAltL(document.createElement("input")), h)).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    expect(handleWorkspaceShortcut(shiftAltL(button), h)).toBe(false);
    expect(handleWorkspaceShortcut(shiftAltL(), handlers())).toBe(false);
    expect(h.lengthTool).toHaveBeenCalledTimes(1);
  });

  it("Story 4.6: Shift+Alt+Q arms Polylength (by code), not in fields, not without a drawing", () => {
    const h = { ...handlers(), polylengthTool: vi.fn() };
    const shiftAltQ = (target?: EventTarget) => key({ shiftKey: true, altKey: true, code: "KeyQ", key: "Œ" }, target);
    expect(handleWorkspaceShortcut(shiftAltQ(), h)).toBe(true);
    expect(h.polylengthTool).toHaveBeenCalledTimes(1);
    expect(handleWorkspaceShortcut(shiftAltQ(document.createElement("input")), h)).toBe(false);
    expect(handleWorkspaceShortcut(shiftAltQ(), handlers())).toBe(false);
    expect(h.polylengthTool).toHaveBeenCalledTimes(1);
  });

  it("Alt+L toggles the Markups list and Shift+F4 hides all panels", () => {
    const h = handlers();
    handleWorkspaceShortcut(key({ altKey: true, code: "KeyL", key: "l" }), h);
    handleWorkspaceShortcut(key({ shiftKey: true, code: "F4", key: "F4" }), h);
    expect(h.toggleMarkupsList).toHaveBeenCalledTimes(1);
    expect(h.hideAllPanels).toHaveBeenCalledTimes(1);
  });

  it("ignores panel keys while typing in a field", () => {
    const h = handlers();
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.createElement(tag);
      expect(handleWorkspaceShortcut(key({ altKey: true, code: "KeyX" }, field), h)).toBe(false);
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(handleWorkspaceShortcut(key({ shiftKey: true, key: "F4" }, editable), h)).toBe(false);
    expect(h.showLeftPanel).not.toHaveBeenCalled();
    expect(h.hideAllPanels).not.toHaveBeenCalled();
  });

  it("ignores other modifier mixes and unknown keys", () => {
    const h = handlers();
    expect(handleWorkspaceShortcut(key({ altKey: true, ctrlKey: true, code: "KeyX" }), h)).toBe(false);
    expect(handleWorkspaceShortcut(key({ altKey: true, shiftKey: true, code: "KeyL" }), h)).toBe(false);
    expect(handleWorkspaceShortcut(key({ altKey: true, code: "KeyQ" }), h)).toBe(false);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, shiftKey: true, code: "KeyO" }), h)).toBe(false);
  });

  it("Ctrl+O follows the letter on other layouts and the key position without Latin letters", () => {
    const h = handlers();
    // Dvorak: the O letter sits on the S position; the O position types "r".
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyS", key: "o" }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyO", key: "r" }), h)).toBe(false);
    // Russian: "щ" on the O position.
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyO", key: "щ" }), h)).toBe(true);
    expect(h.open).toHaveBeenCalledTimes(2);
  });

  it("a held key is claimed but runs once", () => {
    const h = handlers();
    expect(handleWorkspaceShortcut(key({ altKey: true, code: "KeyX", key: "x" }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ altKey: true, code: "KeyX", key: "x", repeat: true }), h)).toBe(true);
    expect(handleWorkspaceShortcut(key({ ctrlKey: true, code: "KeyO", key: "o", repeat: true }), h)).toBe(true);
    expect(h.showLeftPanel).toHaveBeenCalledTimes(1);
    expect(h.open).not.toHaveBeenCalled();
  });
});
