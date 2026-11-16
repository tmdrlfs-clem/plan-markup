// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Tool } from "@/core/tools/tool";
import type { ToolSet } from "@/core/tools/tool-set";

const tool = (id: string, name: string): Tool => ({ id, name, content: null, device: null, imageUrl: null });

const m = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), move: vi.fn(), remove: vi.fn(), publish: vi.fn() }));
vi.mock("./actions", () => ({
  listToolSets: m.list,
  createToolSet: m.create,
  renameToolSet: m.rename,
  moveToolSet: m.move,
  deleteToolSet: m.remove,
  publishToolSet: m.publish,
  addTool: vi.fn(),
}));

import { EMPTY_TOOL_CHEST, ToolChestPanel, setToolChestOwner, toolChestStore } from "./tool-chest-panel";

const A: ToolSet = { id: "a", name: "Sprinkler", position: 1, tools: [tool("1", "Pendant"), tool("2", "Upright")] };
const B: ToolSet = { id: "b", name: "Alarm", position: 2, tools: [] };

function setup(sets: ToolSet[]) {
  m.list.mockResolvedValue({ ok: true, data: sets });
  act(() => toolChestStore.setState({ status: "loading", sets: [] }));
  render(<ToolChestPanel />);
  return userEvent.setup({ delay: null });
}

const setNames = () => screen.queryAllByTestId("tool-set").map((s) => s.querySelector("button[aria-expanded]")?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Tool Chest panel (Story 7.1)", () => {
  it("the empty state offers Import .btx (Story 7.4) and Create set", async () => {
    const user = setup([]);
    expect(await screen.findByText(EMPTY_TOOL_CHEST)).toBeTruthy();
    const importButton = screen.getByRole("button", { name: "Import…" });
    expect(importButton).toBeEnabled();
    m.create.mockResolvedValue({ ok: true, data: { id: "n", name: "Heads", position: 1, tools: [] } });
    await user.click(screen.getByRole("button", { name: "Create set" }));
    const name = screen.getByRole("textbox", { name: "New tool set name" });
    await user.clear(name);
    await user.type(name, "Heads{Enter}");
    expect(m.create).toHaveBeenCalledWith({ name: "Heads" });
    expect(await screen.findByTestId("tool-set")).toBeTruthy();
    expect(setNames()).toEqual(["Heads (0)"]);
  });

  it("shows the sets as collapsible groups in order, with their tools", async () => {
    const user = setup([A, B]);
    await screen.findAllByTestId("tool-set");
    expect(setNames()).toEqual(["Sprinkler (2)", "Alarm (0)"]);
    expect(screen.getAllByTestId("tool").map((t) => t.textContent)).toEqual(["Pendant", "Upright"]);
    await user.click(screen.getByRole("button", { name: "Sprinkler (2)" }));
    expect(screen.queryAllByTestId("tool")).toHaveLength(0);
  });

  it("instant search filters sets and tools and opens the groups", async () => {
    const user = setup([A, B]);
    await screen.findAllByTestId("tool-set");
    await user.click(screen.getByRole("button", { name: "Sprinkler (2)" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "upr");
    expect(setNames()).toEqual(["Sprinkler (1)"]);
    expect(screen.getAllByTestId("tool").map((t) => t.textContent)).toEqual(["Upright"]);
    await user.clear(screen.getByRole("searchbox", { name: "Search tools" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "zzz");
    expect(screen.getByText("No tools match “zzz”.")).toBeTruthy();
  });

  it("renames, reorders and keeps the server's answer (a failure reverts)", async () => {
    const user = setup([A, B]);
    await screen.findAllByTestId("tool-set");
    m.rename.mockResolvedValue({ ok: true, data: null });
    await user.click(screen.getByRole("button", { name: "Rename Alarm" }));
    const field = screen.getByRole("textbox", { name: "Tool set name" });
    await user.clear(field);
    await user.type(field, "Fire alarm{Enter}");
    expect(m.rename).toHaveBeenCalledWith({ id: "b", name: "Fire alarm" });
    expect(setNames()).toEqual(["Sprinkler (2)", "Fire alarm (0)"]);

    m.move.mockResolvedValue({ ok: true, data: null });
    expect(screen.getByRole("button", { name: "Move Fire alarm down" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Move Fire alarm up" }));
    expect(m.move).toHaveBeenCalledWith({ id: "b", direction: -1 });
    expect(setNames()).toEqual(["Fire alarm (0)", "Sprinkler (2)"]);

    m.move.mockResolvedValue({ ok: false, code: "INTERNAL", message: "x" });
    await user.click(screen.getByRole("button", { name: "Move Fire alarm down" }));
    await vi.waitFor(() => expect(setNames()).toEqual(["Fire alarm (0)", "Sprinkler (2)"]));
  });

  it("delete confirms with the tool count", async () => {
    const user = setup([A, B]);
    await screen.findAllByTestId("tool-set");
    m.remove.mockResolvedValue({ ok: true, data: null });
    await user.click(screen.getByRole("button", { name: "Delete Sprinkler" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete tool set?" });
    expect(dialog.textContent).toContain("“Sprinkler” and its 2 tools will be deleted.");
    await user.click(within(dialog).getByRole("button", { name: "Delete set and 2 tools" }));
    expect(m.remove).toHaveBeenCalledWith({ id: "a" });
    expect(setNames()).toEqual(["Alarm (0)"]);
  });
});

describe("Tool Chest owner (Story 7.1)", () => {
  it("another user's workspace drops the previous user's sets", () => {
    setToolChestOwner("user-a");
    act(() => toolChestStore.setState({ status: "ready", sets: [A] }));
    setToolChestOwner("user-a");
    expect(toolChestStore.getState().sets).toEqual([A]);
    setToolChestOwner("user-b");
    expect(toolChestStore.getState()).toEqual({ status: "loading", sets: [] });
  });
});

describe("company tool sets in the Tool Chest (Story 10.11)", () => {
  const SHARED: ToolSet = { id: "s", name: "Company symbols", position: 1, tools: [tool("9", "Valve")], company: "shared" };
  const controls = (name: string) =>
    within(screen.getAllByTestId("tool-set").find((s) => s.textContent?.includes(name))!)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter(Boolean);

  it("a set someone else published is marked Company, is used and exported, and cannot be changed", async () => {
    setToolChestOwner("member", false);
    const user = setup([SHARED, A]);
    await screen.findAllByTestId("tool-set");
    expect(setNames()).toEqual(["Company symbols (1)", "Sprinkler (2)"]);
    expect(screen.getAllByTestId("company-set")).toHaveLength(1);
    expect(screen.getAllByTestId("tool").map((t) => t.textContent)).toEqual(["Valve", "Pendant", "Upright"]);
    expect(controls("Company symbols")).toEqual(["Export Company symbols", "Valve"]);
    // Double-click does not rename it.
    await user.dblClick(screen.getByRole("button", { name: "Company symbols (1)" }));
    expect(screen.queryByRole("textbox", { name: "Tool set name" })).toBeNull();
    // The user's only own set has nowhere to move, and nothing to publish with.
    expect(screen.getByRole("button", { name: "Move Sprinkler up" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Move Sprinkler down" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
  });

  it("a company admin publishes and withdraws their own set", async () => {
    setToolChestOwner("boss", true);
    const user = setup([A]);
    await screen.findAllByTestId("tool-set");
    expect(screen.queryByTestId("company-set")).toBeNull();
    m.publish.mockResolvedValue({ ok: true, data: { published: true, companyName: "Acme" } });
    await user.click(screen.getByRole("button", { name: "Publish Sprinkler to your company" }));
    expect(m.publish).toHaveBeenCalledWith({ id: "a", published: true });
    expect(await screen.findByTestId("company-set")).toBeTruthy();
    // Still the admin's own: every control is there.
    expect(controls("Sprinkler")).toContain("Rename Sprinkler");
    expect(controls("Sprinkler")).toContain("Delete Sprinkler");

    await user.click(screen.getByRole("button", { name: "Delete Sprinkler" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete tool set?" });
    expect(dialog.textContent).toContain("Your company will no longer have it.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    m.publish.mockResolvedValue({ ok: true, data: { published: false, companyName: "Acme" } });
    await user.click(screen.getByRole("button", { name: "Withdraw Sprinkler from your company" }));
    expect(m.publish).toHaveBeenLastCalledWith({ id: "a", published: false });
    await vi.waitFor(() => expect(screen.queryByTestId("company-set")).toBeNull());
  });

  it("a refused publication leaves the set as it was", async () => {
    setToolChestOwner("boss", true);
    const user = setup([A]);
    await screen.findAllByTestId("tool-set");
    m.publish.mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "You cannot do that." });
    await user.click(screen.getByRole("button", { name: "Publish Sprinkler to your company" }));
    await vi.waitFor(() => expect(m.publish).toHaveBeenCalled());
    expect(screen.queryByTestId("company-set")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish Sprinkler to your company" })).toBeTruthy();
  });
});
