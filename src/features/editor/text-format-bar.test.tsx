// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { newTextStyle, textFormatStore } from "./text-format";
import { TextFormatBar } from "./text-format-bar";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const BOX = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];
const TEXT: Markup = { id: "00000000-0000-7000-8000-000000000001", pageId: "doc:0", createdAt: "2026-11-21T00:00:00.000Z", style: DEFAULT_MARKUP_STYLE, type: "text", points: BOX, text: "Hi" } as Markup;
const stored = () => markupsOf(editorStore.getState(), "doc")[0];

function setup(selected: string[]) {
  viewerStore.setState({ status: "ready", documentId: "doc", tabId: "t1", pageIndex: 0, pageCount: 1 });
  setDocMarkups("doc", [TEXT]);
  setSelection(selected);
  render(<TextFormatBar />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => clearUndo());
afterEach(() => {
  act(() => {
    textFormatStore.setState({ font: undefined, bold: undefined, italic: undefined, underline: undefined, strike: undefined, align: undefined, fontSize: 10, color: "#ff0000" }, true);
    resetEditor();
    resetViewer();
  });
});

describe("TextFormatBar (founder 2026-11-21)", () => {
  it("formats the selected text, one undo step each", async () => {
    const user = setup([TEXT.id]);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(stored().style.bold).toBe(true);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Bold");
    await user.click(screen.getByRole("radio", { name: "Align centre" }));
    expect(stored().style.align).toBe("center");
    await user.selectOptions(screen.getByRole("combobox", { name: "Font" }), "Serif (Times)");
    expect(stored().style.font).toBe("serif");
    await user.selectOptions(screen.getByRole("combobox", { name: "Font size" }), "14");
    expect(stored().style.fontSize).toBe(14);
    act(() => void undoActive());
    expect(stored().style.fontSize).toBe(10);
    expect(screen.getByText("Applies to 1 selected text markup")).toBeTruthy();
  });

  it("with no text selected it sets how the next text is made", async () => {
    const user = setup([]);
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.click(screen.getByRole("radio", { name: "Align right" }));
    expect(stored().style.italic).toBeUndefined();
    expect(newTextStyle()).toMatchObject({ italic: true, align: "right", fontSize: 10 });
    expect(screen.getByText("Applies to the next text")).toBeTruthy();
  });
});
