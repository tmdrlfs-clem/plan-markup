// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";

import { activeLayerOf, editorStore, layersOf, markupsOf, resetEditor, setDocMarkups } from "./editor-store";
import { LayersPanel } from "./layers-panel";
import { clearUndo } from "./undo-store";

const DOC = "doc";
let n = 0;
function line(layerId?: string, page = 0): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: `${DOC}:${page}`,
    createdAt: "2026-11-05T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type: "line",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    ...(layerId ? { layerId } : {}),
  } as Markup;
}
const layers = () => layersOf(editorStore.getState(), DOC);

function setup() {
  viewerStore.setState({ status: "ready", documentId: DOC, tabId: "t1", pageIndex: 0 });
  render(<LayersPanel emptyText="No layers yet" />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => clearUndo());
afterEach(() => {
  act(() => {
    resetEditor();
    resetViewer();
  });
});

describe("LayersPanel (Story 5.12)", () => {
  it("adds layers (active at once), renames, hides and locks them", async () => {
    const user = setup();
    expect(screen.getByText("No layers yet")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New layer" }));
    expect(layers().map((l) => l.name)).toEqual(["Layer 1"]);
    expect(screen.getByRole("radio", { name: "Make Layer 1 the active layer" })).toBeChecked();
    // Rename by the pencil; Enter keeps it.
    await user.click(screen.getByRole("button", { name: "Rename Layer 1" }));
    const field = screen.getByRole("textbox", { name: "Layer name" });
    await user.clear(field);
    await user.type(field, "Sprinklers{Enter}");
    expect(layers()[0].name).toBe("Sprinklers");
    // Hide: no longer active, and cannot be made active.
    await user.click(screen.getByRole("button", { name: "Hide Sprinklers" }));
    expect(layers()[0].hidden).toBe(true);
    expect(activeLayerOf(editorStore.getState(), DOC)).toBeNull();
    expect(screen.getByRole("radio", { name: "Make Sprinklers the active layer" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "No layer" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Show Sprinklers" }));
    await user.click(screen.getByRole("button", { name: "Lock Sprinklers" }));
    expect(layers()[0].locked).toBe(true);
  });

  it("deleting an empty layer needs no question; one with markups asks where they go, with the scope", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "New layer" }));
    await user.click(screen.getByRole("button", { name: "New layer" }));
    const [, one] = layers();
    act(() => setDocMarkups(DOC, [line(one.id, 0), line(one.id, 1), line()]));
    await user.click(screen.getByRole("button", { name: "Delete Layer 2" }));
    expect(layers().map((l) => l.id)).toEqual([one.id]);
    await user.click(screen.getByRole("button", { name: "Delete Layer 1" }));
    const dialog = screen.getByRole("dialog", { name: "Delete layer “Layer 1”?" });
    expect(within(dialog).getByText("It has 2 markups on 2 pages.")).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: /Delete them/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete layer and markups" }));
    expect(layers()).toEqual([]);
    expect(markupsOf(editorStore.getState(), DOC)).toHaveLength(1);
  });

  it("moves a layer up or down", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "New layer" }));
    await user.click(screen.getByRole("button", { name: "New layer" }));
    expect(layers().map((l) => l.name)).toEqual(["Layer 2", "Layer 1"]);
    await user.click(screen.getByRole("button", { name: "Move Layer 1 up" }));
    expect(layers().map((l) => l.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(screen.getByRole("button", { name: "Move Layer 1 up" })).toHaveAttribute("aria-disabled", "true");
  });
});
