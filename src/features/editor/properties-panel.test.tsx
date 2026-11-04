// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { formatPainter } from "./properties";
import { PAINTER_HINT, PropertiesPanel } from "./properties-panel";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const BOX = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];
let n = 0;
function make(type: "rectangle" | "line" | "text", extra: Partial<Markup> = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "doc:0",
    createdAt: "2026-11-05T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type,
    points: type === "line" ? BOX.slice(0, 2) : BOX,
    ...(type === "text" ? { text: "Hello" } : {}),
    ...extra,
  } as Markup;
}
const stored = (id: string) => markupsOf(editorStore.getState(), "doc").find((m) => m.id === id)!;

function setup(markups: Markup[], selected: string[]) {
  viewerStore.setState({ status: "ready", documentId: "doc", tabId: "t1", pageIndex: 0 });
  setDocMarkups("doc", markups);
  setSelection(selected);
  render(<PropertiesPanel emptyText="Nothing selected" />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => clearUndo());
afterEach(() => {
  act(() => {
    formatPainter.setState({ format: null, from: null });
    resetEditor();
    resetViewer();
  });
});

describe("PropertiesPanel (Story 5.10)", () => {
  it("shows the empty state with nothing selected", () => {
    setup([make("rectangle")], []);
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });

  it("edits one markup's fields at once, each one undo step", async () => {
    const rect = make("rectangle");
    const user = setup([rect], [rect.id]);
    expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Rectangle");
    // Line width: typed, Enter commits.
    const width = screen.getByLabelText("Line width");
    await user.clear(width);
    await user.type(width, "2.5{Enter}");
    expect(stored(rect.id).style.width).toBe(2.5);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Change line width");
    // Colour from the palette.
    await user.click(within(screen.getByRole("radiogroup", { name: "Colour" })).getByRole("radio", { name: "Blue" }));
    expect(stored(rect.id).style.color).toBe("#0000ff");
    // Fill on, then none.
    await user.click(within(screen.getByRole("radiogroup", { name: "Fill" })).getByRole("radio", { name: "Yellow" }));
    expect(stored(rect.id).style.fill).toBe("#ffff00");
    await user.click(screen.getByRole("button", { name: "None" }));
    expect(stored(rect.id).style.fill).toBeUndefined();
    // Opacity in percent.
    const opacity = screen.getByLabelText("Opacity");
    await user.clear(opacity);
    await user.type(opacity, "50{Enter}");
    expect(stored(rect.id).style.opacity).toBe(0.5);
    // Subject.
    const subject = screen.getByLabelText("Subject");
    await user.clear(subject);
    await user.type(subject, "Tank{Enter}");
    expect(stored(rect.id).subject).toBe("Tank");
    act(() => void undoActive());
    expect(stored(rect.id).subject).toBeUndefined();
    expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Rectangle");
  });

  it("a multi-selection shows the shared fields; a value they do not share is blank", async () => {
    const rect = make("rectangle");
    const line = make("line", { style: { ...DEFAULT_MARKUP_STYLE, width: 3 } });
    const user = setup([rect, line], [rect.id, line.id]);
    expect(screen.getByText("2 markups")).toBeTruthy();
    expect(screen.queryByText("Fill")).toBeNull();
    const width = screen.getByLabelText("Line width");
    expect(width).toHaveProperty("value", "");
    await user.type(width, "4{Enter}");
    expect([stored(rect.id).style.width, stored(line.id).style.width]).toEqual([4, 4]);
    // One step for both.
    act(() => void undoActive());
    expect([stored(rect.id).style.width, stored(line.id).style.width]).toEqual([1, 3]);
  });

  it("edits a text markup's text and font size", async () => {
    const text = make("text");
    const user = setup([text], [text.id]);
    const field = screen.getByLabelText("Text");
    await user.clear(field);
    await user.type(field, "Riser valve");
    await user.tab();
    expect(stored(text.id).type === "text" && (stored(text.id) as { text: string }).text).toBe("Riser valve");
    const size = screen.getByLabelText("Font size");
    await user.clear(size);
    await user.type(size, "14{Enter}");
    expect(stored(text.id).style.fontSize).toBe(14);
  });

  it("Copy format puts the format painter out (pressed again: away)", async () => {
    const rect = make("rectangle");
    const user = setup([rect], [rect.id]);
    const button = screen.getByRole("button", { name: "Copy format" });
    await user.click(button);
    expect(formatPainter.getState().from).toBe(rect.id);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(PAINTER_HINT)).toBeTruthy();
    await user.click(button);
    expect(formatPainter.getState().format).toBeNull();
  });
});
