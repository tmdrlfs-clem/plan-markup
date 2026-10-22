import { describe, expect, it } from "vitest";

import { formatShortcut, toAriaKeyShortcuts } from "./shortcut";

describe("formatShortcut", () => {
  it("keeps the table form off macOS", () => {
    expect(formatShortcut("Ctrl+Shift+M", false)).toBe("Ctrl+Shift+M");
    expect(formatShortcut("Del", false)).toBe("Del");
  });

  it("uses symbols on macOS", () => {
    expect(formatShortcut("Ctrl+Shift+M", true)).toBe("⌘⇧M");
    expect(formatShortcut("Shift+Alt+L", true)).toBe("⇧⌥L");
  });

  it("formats several shortcuts", () => {
    expect(formatShortcut("Del Backspace", false)).toBe("Del Backspace");
  });
});

describe("toAriaKeyShortcuts", () => {
  it("maps key names", () => {
    expect(toAriaKeyShortcuts("Ctrl+Shift+M")).toBe("Control+Shift+M");
    expect(toAriaKeyShortcuts("Del")).toBe("Delete");
    expect(toAriaKeyShortcuts("Esc")).toBe("Escape");
  });

  it("announces Ctrl as Meta on macOS, matching the Command glyph", () => {
    expect(toAriaKeyShortcuts("Ctrl+Shift+M", true)).toBe("Meta+Shift+M");
    expect(toAriaKeyShortcuts("Ctrl+Z", false)).toBe("Control+Z");
  });

  it("maps + and - keys", () => {
    expect(toAriaKeyShortcuts("Ctrl++")).toBe("Control+Plus");
    expect(toAriaKeyShortcuts("Ctrl+-")).toBe("Control+Minus");
    expect(toAriaKeyShortcuts("PageDown Ctrl+→", false)).toBe("PageDown Control+ArrowRight");
  });

  it("upper-cases single letters and joins several shortcuts with a space", () => {
    expect(toAriaKeyShortcuts("v")).toBe("V");
    expect(toAriaKeyShortcuts("Del Backspace")).toBe("Delete Backspace");
  });
});
