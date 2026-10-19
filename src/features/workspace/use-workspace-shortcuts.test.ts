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
