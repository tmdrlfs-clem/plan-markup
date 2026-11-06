// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { NEEDS_SCALE } from "@/core/tools/place";
import { toolContentOf, type Tool } from "@/core/tools/tool";
import type { ToolSet } from "@/core/tools/tool-set";
import { tipsStore } from "@/features/tips";
import { viewerStore } from "@/features/viewer";

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./actions", () => ({ listToolSets: m.list, createToolSet: vi.fn(), renameToolSet: vi.fn(), moveToolSet: vi.fn(), deleteToolSet: vi.fn(), addTool: vi.fn() }));
vi.mock("@/features/editor", () => ({ paintMarkupsPreview: vi.fn(), decodeMarkupImage: async () => undefined, loadMarkupFonts: async () => undefined }));

import { stampStore, resetStamps } from "./stamp-store";
import { NO_DRAWING_TO_PLACE, TOOL_CHEST_TIP, ToolChestPanel, UNREADABLE_TOOL, toolChestStore } from "./tool-chest-panel";

const SHA = "c".repeat(64);
const cal: Calibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 } as Calibration;
const line: Markup = {
  id: "00000000-0000-7000-8000-000000000001",
  pageId: "src:0",
  createdAt: "2026-11-07T00:00:00.000Z",
  style: DEFAULT_MARKUP_STYLE,
  type: "line",
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
} as Markup;

const tool = (id: string, name: string, calibration: Calibration | null): Tool => ({
  id,
  name,
  content: toolContentOf([line], { calibration, userUnit: 1 })!.content,
  device: null,
  imageUrl: null,
});
const SET: ToolSet = {
  id: "s",
  name: "Sprinkler",
  position: 1,
  tools: [tool("1", "Plain", null), tool("2", "Scaled", cal), { id: "3", name: "Broken", content: null, device: null, imageUrl: null }],
};

function setup() {
  act(() => toolChestStore.setState({ status: "ready", sets: [SET] }));
  render(<ToolChestPanel />);
  return userEvent.setup({ delay: null });
}

const tile = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  act(() => tipsStore.setState({ seen: [], loaded: true }));
});
afterEach(() => {
  resetStamps();
  act(() => viewerStore.setState({ documentId: null, tool: "select", calibrations: {} }));
});

describe("Tool Chest tiles (Story 7.3)", () => {
  it("without a drawing every tile says why it cannot be placed; the first use shows one tip", async () => {
    const user = setup();
    expect(tile("Plain")).toHaveAttribute("aria-disabled", "true");
    expect(tile("Plain")).toHaveAttribute("title", `Plain — ${NO_DRAWING_TO_PLACE}`);
    expect(tile("Broken")).toHaveAttribute("title", `Broken — ${UNREADABLE_TOOL}`);
    expect(screen.getByRole("note")).toHaveTextContent(TOOL_CHEST_TIP);
    await user.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(tipsStore.getState().seen).toContain("tool-chest");
  });

  it("on an unscaled page a scaled tool is disabled; a click arms a tool (Stamp) and shows it pressed", async () => {
    act(() => viewerStore.setState({ documentId: SHA, pageIndex: 0, calibrations: {} }));
    const user = setup();
    expect(tile("Scaled")).toHaveAttribute("title", `Scaled — ${NEEDS_SCALE}`);
    await user.click(tile("Scaled"));
    expect(stampStore.getState().armed).toBeNull();
    await user.click(tile("Plain"));
    await vi.waitFor(() => expect(viewerStore.getState().tool).toBe("stamp"));
    expect(stampStore.getState().armed).toMatchObject({ id: "1", name: "Plain", imageSrc: null });
    expect(tile("Plain")).toHaveAttribute("aria-pressed", "true");
    act(() => viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } }));
    expect(tile("Scaled")).not.toHaveAttribute("aria-disabled");
    expect(tile("Scaled")).toHaveAttribute("draggable", "true");
  });
});
