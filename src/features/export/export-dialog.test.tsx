// @vitest-environment jsdom
// Story 9.12: the Export and Flatten dialogs offer the advisory notice.
import "@/test/radix-jsdom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/activity/actions", () => ({ recordActivity: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/features/markup-set/actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn(), applyMarkupOps: vi.fn(), loadMarkupSet: vi.fn(), hasMarkupsOnOtherVersion: vi.fn(), listMyMarkupSets: vi.fn(), loadMarkupSetPages: vi.fn() }));
const runExport = vi.fn(async () => ({ ok: true as const, name: "plan.pdf", annotations: 0, flattened: 0, pages: 1 }));
vi.mock("./run-export", async (importOriginal) => ({ ...(await importOriginal<typeof import("./run-export")>()), runExport: (...args: unknown[]) => runExport(...(args as [])) }));

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { newZone } from "@/core/sprinkler/zone";
import { resetEditor, setDocMarkups } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { ExportDialog, exportDialogStore, openExport } from "./export-dialog";

const SHA = "d".repeat(64);
const k = factorForRatio(100);
const CAL: Calibration = { xFactor: k, yFactor: k, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function show() {
  viewerStore.setState({
    file: new File([new Uint8Array([37, 80, 68, 70])], "plan.pdf", { type: "application/pdf" }),
    documentId: SHA,
    pageCount: 1,
    pageIndex: 0,
    pages: [{ width: 842, height: 595, rotate: 0 }],
    status: "ready",
    standIn: false,
    calibrations: {},
  } as never);
}

afterEach(() => {
  act(() => exportDialogStore.setState({ open: null }));
  runExport.mockClear();
  resetEditor();
  viewerStore.setState({ file: null, documentId: null, pageCount: 0, pages: [], standIn: false, calibrations: {} } as never);
});

describe("advisory notice in Export / Flatten (Story 9.12)", () => {
  it("starts on for a drawing with zones, and the export carries the choice", async () => {
    show();
    setDocMarkups(SHA, [newZone({ id: "00000000-0000-7000-8000-0000000009a1", pageId: pageIdOf(SHA, 0), createdAt: "2026-11-12T00:00:00.000Z", outer: ring(100, 100, 200, 100), holes: [] }, [], CAL)]);
    const user = userEvent.setup();
    render(<ExportDialog />);
    act(() => openExport("flattened"));
    const box = await screen.findByRole("checkbox", { name: "Include advisory notice" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Flatten" }));
    expect(runExport).toHaveBeenCalledWith(expect.objectContaining({ kind: "flattened", notice: true }));
  });

  it("starts off for a drawing without sprinkler data, and can be turned on", async () => {
    show();
    const user = userEvent.setup();
    render(<ExportDialog />);
    act(() => openExport("editable"));
    const box = await screen.findByRole("checkbox", { name: "Include advisory notice" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(runExport).toHaveBeenCalledWith(expect.objectContaining({ kind: "editable", notice: true }));
  });
});
