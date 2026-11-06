// @vitest-environment jsdom
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolSet } from "@/core/tools/tool-set";

const m = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({ createToolSet: vi.fn(), addTool: vi.fn() }));
vi.mock("@/components/ui/toast-store", () => ({ toast: m.toast }));

import { ImportBtxButton, ImportReportDialog, importStore, runImport, setImportDeps, showOutcome } from "./import-btx-ui";

const SET: ToolSet = { id: "s", name: "Sprinkler Tools", position: 1, tools: [{ id: "t", name: "Head", content: null, device: null, imageUrl: null }] };

beforeEach(() => {
  vi.clearAllMocks();
  act(() => importStore.setState({ busy: false, report: null }));
});

describe("Import .btx outcomes (Story 7.4, F7)", () => {
  it("all ok: the set joins the Tool Chest with the toast “<title> — n tools”", () => {
    const onSet = vi.fn();
    showOutcome({ kind: "ok", set: SET, title: "Sprinkler Tools" }, onSet);
    expect(onSet).toHaveBeenCalledWith(SET);
    expect(m.toast).toHaveBeenCalledWith({ title: "Sprinkler Tools — 1 tool", variant: "success" });
  });

  it("invalid: “Not a Revu tool set file”, nothing added", () => {
    const onSet = vi.fn();
    showOutcome({ kind: "invalid", reason: "The file is larger than 32 MB." }, onSet);
    expect(onSet).not.toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith({ title: "Not a Revu tool set file", description: "The file is larger than 32 MB.", variant: "warning" });
  });

  it("partial: the set, and a report of each item not imported with its reason", async () => {
    render(<ImportReportDialog />);
    const onSet = vi.fn();
    act(() => showOutcome({ kind: "partial", set: SET, title: "Sprinkler Tools", failed: [{ name: "Snapshot", reason: "It draws nothing" }] }, onSet));
    expect(onSet).toHaveBeenCalledWith(SET);
    const dialog = await screen.findByRole("dialog", { name: "Sprinkler Tools — 1 tool imported" });
    expect(dialog).toHaveTextContent("1 item was not imported.");
    expect(screen.getByRole("list", { name: "Items not imported" })).toHaveTextContent("SnapshotIt draws nothing");
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
    expect(importStore.getState().report).toBeNull();
  });

  it("none drawn: the report says nothing was added", async () => {
    render(<ImportReportDialog />);
    act(() => showOutcome({ kind: "none", title: "Empty", failed: [{ name: "Snapshot", reason: "It draws nothing" }] }, vi.fn()));
    const dialog = await screen.findByRole("dialog", { name: "No tools could be imported" });
    expect(dialog).toHaveTextContent("Nothing was added from “Empty”.");
  });

  it("the button picks a .btx file and shows Importing… while it runs", async () => {
    let finish!: () => void;
    setImportDeps({ read: () => new Promise((resolve) => (finish = () => resolve({ ok: false, code: "structure-invalid" }))) });
    const onSet = vi.fn();
    render(<ImportBtxButton onSet={onSet} />);
    const input = screen.getByTestId("import-btx-input") as HTMLInputElement;
    expect(input.accept).toBe(".btx,.json");
    await userEvent.setup({ applyAccept: false }).upload(input, new File(["x"], "a.btx"));
    expect(await screen.findByRole("button", { name: "Importing…" })).toBeDisabled();
    // A second import while one runs is ignored.
    await runImport(new File(["x"], "b.btx"), onSet);
    await act(async () => finish());
    expect(await screen.findByRole("button", { name: "Import…" })).toBeEnabled();
    expect(m.toast).toHaveBeenCalledTimes(1);
  });
});
