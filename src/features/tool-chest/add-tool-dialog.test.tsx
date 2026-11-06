// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import type { ToolSet } from "@/core/tools/tool-set";

const m = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), toast: vi.fn() }));
vi.mock("./actions", () => ({
  listToolSets: m.list,
  createToolSet: vi.fn(),
  renameToolSet: vi.fn(),
  moveToolSet: vi.fn(),
  deleteToolSet: vi.fn(),
  addTool: m.add,
}));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));
vi.mock("@/features/editor", () => ({ paintMarkupsPreview: vi.fn(), decodeMarkupImage: async () => undefined, loadMarkupFonts: async () => undefined }));

import { AddToolDialog, NEW_SET, ONE_IMAGE } from "./add-tool-dialog";
import { addToolStore, requestAddTool } from "./add-tool-store";
import { toolChestStore } from "./tool-chest-panel";

const SET: ToolSet = { id: "00000000-0000-4000-8000-000000000001", name: "Sprinkler", position: 1, tools: [] };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

let n = 0;
function mk(type: string, extra: object = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "doc:0",
    createdAt: "2026-11-07T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ],
    ...extra,
  } as Markup;
}

function open(markups: Markup[], sets: ToolSet[] = [SET]) {
  act(() => toolChestStore.setState({ status: "ready", sets }));
  render(<AddToolDialog />);
  act(() => requestAddTool({ markups, calibration: null, userUnit: 1 }));
  return userEvent.setup({ delay: null, pointerEventsCheck: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => addToolStore.setState({ request: null }));
});

describe("Add to Tool Chest dialog (Story 7.2)", () => {
  it("suggests the markup's subject, picks the first set, and adds the tool to it", async () => {
    const user = open([mk("line", { subject: "Pipe" })]);
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Pipe");
    expect(screen.getByRole("combobox", { name: "Tool set" })).toHaveTextContent("Sprinkler");
    expect(screen.getByTestId("tool-preview")).toBeTruthy();
    const tool = { id: "t1", name: "Main pipe", content: null, device: null, imageUrl: null };
    m.add.mockResolvedValue({ ok: true, data: { set: null, setId: SET.id, tool } });
    await user.clear(name);
    await user.type(name, "Main pipe");
    await user.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(addToolStore.getState().request).toBeNull());
    const input = m.add.mock.calls[0][0];
    expect(input).toMatchObject({ set: { id: SET.id }, name: "Main pipe", device: null, image: null });
    expect(input.content.markups).toHaveLength(1);
    expect(toolChestStore.getState().sets[0].tools).toEqual([tool]);
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Added “Main pipe” to Sprinkler.", variant: "success" }));
  });

  it("with no sets, adds to a new set; a device needs its group and label", async () => {
    const user = open([mk("rectangle")], []);
    expect(screen.getByRole("combobox", { name: "Tool set" })).toHaveTextContent("New tool set…");
    expect(screen.getByRole("textbox", { name: "New set name" })).toHaveValue("My tools");
    await user.click(screen.getByRole("checkbox", { name: "Count as a device" }));
    await user.click(screen.getByRole("button", { name: "Add tool" }));
    expect(m.add).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a value.")).toHaveLength(2);
    await user.type(screen.getByRole("textbox", { name: "Group" }), "Sprinklers");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Pendant");
    const created: ToolSet = { id: "00000000-0000-4000-8000-000000000002", name: "My tools", position: 1, tools: [] };
    const tool = { id: "t2", name: "Rectangle", content: null, device: { group: "Sprinklers", label: "Pendant", description: "" }, imageUrl: null };
    m.add.mockResolvedValue({ ok: true, data: { set: created, setId: created.id, tool } });
    await user.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(m.add).toHaveBeenCalled());
    expect(m.add.mock.calls[0][0]).toMatchObject({ set: { name: "My tools" }, device: { group: "Sprinklers", label: "Pendant", description: "" } });
    await waitFor(() => expect(toolChestStore.getState().sets).toEqual([{ ...created, tools: [tool] }]));
    expect(NEW_SET).toBe("new");
  });

  it("sends an image's pixels apart from the content", async () => {
    const user = open([mk("image", { src: PNG, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })]);
    m.add.mockResolvedValue({ ok: true, data: { set: null, setId: SET.id, tool: { id: "t3", name: "Image", content: null, device: null, imageUrl: null } } });
    await user.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(m.add).toHaveBeenCalled());
    const input = m.add.mock.calls[0][0];
    expect(input.image).toEqual({ type: "image/png", base64: "iVBORw0KGgo=" });
    expect(input.content.markups[0]).toMatchObject({ type: "image", asset: true });
    expect(input.content.markups[0].src).toBeUndefined();
  });

  it("refuses two images, and keeps the dialog open when adding fails", async () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    open([mk("image", { src: PNG, points: pts }), mk("image", { src: PNG, points: pts })]);
    expect(screen.getByRole("alert")).toHaveTextContent(ONE_IMAGE);
    expect(screen.getByRole("button", { name: "Add tool" })).toBeDisabled();
  });

  it("a failure keeps the dialog open with a warning", async () => {
    const user = open([mk("line")]);
    m.add.mockResolvedValue({ ok: false, code: "INVALID_INPUT", message: "That tool set is full." });
    await user.click(screen.getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "That tool set is full.", variant: "warning" })));
    expect(addToolStore.getState().request).not.toBeNull();
  });
});
