import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/features/activity/actions", () => ({ recordActivity: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/features/markup-set/actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn(), applyMarkupOps: vi.fn(), loadMarkupSet: vi.fn(), hasMarkupsOnOtherVersion: vi.fn(), listMyMarkupSets: vi.fn(), loadMarkupSetPages: vi.fn() }));

import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { resetEditor, setDocLayers, setDocMarkups } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { isFlattenShortcut } from "./export-dialog";
import { isPrintShortcut } from "./print-dialog";
import { NO_DRAWING, PRINT_BLOCKED, PRINT_FAILED, STAND_IN, exportBlocked, exportCount, exportName, runExport, runPrint, setExportAuthor, type ExportDeps, type PrintDeps } from "./run-export";

const SHA = "c".repeat(64);
const HIDDEN = "00000000-0000-7000-8000-00000000bbbb";
let n = 0;
const line = (page: number, extra: object = {}): Markup =>
  ({
    id: `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
    pageId: pageIdOf(SHA, page),
    createdAt: "2026-11-08T00:00:00Z",
    style: DEFAULT_MARKUP_STYLE,
    type: "line",
    points: [
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ],
    ...extra,
  }) as Markup;

function show(over: object = {}) {
  viewerStore.setState({
    file: new File([new Uint8Array([37, 80, 68, 70])], "A1721 Rev C.pdf", { type: "application/pdf" }),
    documentId: SHA,
    pageCount: 2,
    pageIndex: 0,
    pages: [
      { width: 842, height: 595, rotate: 0 },
      { width: 842, height: 595, rotate: 0, userUnit: 2 },
    ],
    status: "ready",
    standIn: false,
    calibrations: {},
    ...over,
  } as never);
}

afterEach(() => {
  resetEditor();
  viewerStore.setState({ file: null, documentId: null, pageCount: 0, pages: [], standIn: false, calibrations: {} } as never);
});

describe("Export editable PDF (Story 8.1)", () => {
  it("needs a drawing, and its own PDF (not blank stand-in pages)", () => {
    expect(exportBlocked()).toBe(NO_DRAWING);
    show({ standIn: true });
    expect(exportBlocked()).toBe(STAND_IN);
    show();
    expect(exportBlocked()).toBeNull();
    expect(exportName("A1721 Rev C.pdf")).toBe("A1721 Rev C.pdf");
    expect(exportName("plan.PDF")).toBe("plan.pdf");
    expect(exportName("A1721 Rev C.pdf", "flattened")).toBe("A1721 Rev C (flattened).pdf");
  });

  it("writes the chosen pages' markups (hidden layers only when chosen) and saves under the drawing's name", async () => {
    show();
    setExportAuthor("Kim Lee");
    setDocLayers(SHA, [{ id: HIDDEN, name: "Old", hidden: true }]);
    const a = line(0);
    const hidden = line(0, { layerId: HIDDEN });
    const b = line(1);
    setDocMarkups(SHA, [a, hidden, b]);
    expect(exportCount({ pages: [0, 1], includeHidden: false })).toBe(2);
    expect(exportCount({ pages: [0, 1], includeHidden: true })).toBe(3);

    const write = vi.fn<ExportDeps["write"]>(async () => ({ bytes: new Uint8Array([1]), annotations: 1, flattened: 0, pages: 1 }));
    const save = vi.fn<ExportDeps["save"]>();
    const record = vi.fn<NonNullable<ExportDeps["record"]>>();
    const out = await runExport({ pages: [1], includeHidden: false }, { decode: async () => null, write, save, record });
    expect(record).toHaveBeenCalledWith({ name: "markup.exported", kind: "editable", pageCount: 1, markupCount: 1 });
    // Story 9.12: the advisory notice is off unless chosen, and passed to the writer when it is.
    expect(write.mock.calls[0][4]).toBe(false);
    await runExport({ pages: [1], includeHidden: false, notice: true }, { decode: async () => null, write, save });
    expect(write.mock.calls[1][4]).toBe(true);
    expect(out).toEqual({ ok: true, name: "A1721 Rev C.pdf", annotations: 1, flattened: 0, pages: 1 });
    expect(write.mock.calls[0][3]).toBe(false);
    const [bytes, job] = write.mock.calls[0];
    expect([...bytes]).toEqual([37, 80, 68, 70]);
    expect(job.pages).toHaveLength(1);
    expect(job.pages[0]).toMatchObject({ pageIndex: 1, model: { markups: [{ id: b.id, author: "Kim Lee", width: 0.5 }] } });
    expect(save).toHaveBeenCalledWith("A1721 Rev C.pdf", new Uint8Array([1]));
  });

  it("says why when the PDF cannot be written", async () => {
    show();
    setDocMarkups(SHA, [line(0)]);
    const save = vi.fn<ExportDeps["save"]>();
    const record = vi.fn<NonNullable<ExportDeps["record"]>>();
    const out = await runExport({ pages: [0], includeHidden: false }, { decode: async () => null, write: async () => null, save, record });
    expect(record).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: "The PDF could not be written." });
    expect(save).not.toHaveBeenCalled();
  });

  it("Story 8.2: flattened writes the markups into the pages, a new file name", async () => {
    show();
    setDocMarkups(SHA, [line(0)]);
    const write = vi.fn<ExportDeps["write"]>(async () => ({ bytes: new Uint8Array([2]), annotations: 0, flattened: 1, pages: 1 }));
    const save = vi.fn<ExportDeps["save"]>();
    const out = await runExport({ kind: "flattened", pages: [0], includeHidden: false }, { decode: async () => null, write, save });
    expect(out).toEqual({ ok: true, name: "A1721 Rev C (flattened).pdf", annotations: 0, flattened: 1, pages: 1 });
    expect(write.mock.calls[0][3]).toBe(true);
    expect(save).toHaveBeenCalledWith("A1721 Rev C (flattened).pdf", new Uint8Array([2]));
    expect(isFlattenShortcut({ key: "M", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(true);
    expect(isFlattenShortcut({ key: "m", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(false);
  });
});

describe("Print (Story 8.3)", () => {
  it("prints the chosen pages with their markups, hidden layers shown when chosen", async () => {
    show();
    setDocLayers(SHA, [{ id: HIDDEN, name: "Old", hidden: true }]);
    setDocMarkups(SHA, [line(0), line(0, { layerId: HIDDEN })]);
    const build = vi.fn<PrintDeps["build"]>(async () => ({ bytes: new Uint8Array([3]), sheets: 1, clipped: 0 }));
    const print = vi.fn<PrintDeps["print"]>(async () => true);
    const record = vi.fn<NonNullable<PrintDeps["record"]>>();
    const out = await runPrint({ pages: [0], includeHidden: true, markups: true, paper: "A3", scale: "actual" }, { decode: async () => null, build, print, record });
    expect(record).toHaveBeenCalledWith({ name: "drawing.printed", kind: "with_markups", pageCount: 1, markupCount: 2 });
    expect(out).toEqual({ ok: true, sheets: 1, clipped: 0 });
    const [, job, , options] = build.mock.calls[0];
    expect(options).toEqual({ pages: [0], paper: "A3", scale: "actual" });
    expect(job!.pages[0].model.markups).toHaveLength(2);
    expect(job!.layers.every((l) => l.visible)).toBe(true);
    expect(job!.pages[0].model.layers.every((l) => l.visible)).toBe(true);
    expect(print).toHaveBeenCalledWith(new Uint8Array([3]));
  });

  it("prints without markups, and says why when it cannot", async () => {
    show();
    setDocMarkups(SHA, [line(0)]);
    const build = vi.fn<PrintDeps["build"]>(async () => ({ bytes: new Uint8Array([4]), sheets: 2, clipped: 1 }));
    const record = vi.fn<NonNullable<PrintDeps["record"]>>();
    expect(await runPrint({ pages: [0, 1], includeHidden: false, markups: false, paper: "same", scale: "fit" }, { decode: async () => null, build, print: async () => true, record })).toEqual({ ok: true, sheets: 2, clipped: 1 });
    expect(record).toHaveBeenCalledWith({ name: "drawing.printed", kind: "without_markups", pageCount: 2, markupCount: 0 });
    expect(build.mock.calls[0][1]).toBeNull();
    const choice = { pages: [0], includeHidden: false, markups: true, paper: "same", scale: "fit" } as const;
    expect(await runPrint(choice, { decode: async () => null, build: async () => null, print: async () => true })).toEqual({ ok: false, reason: PRINT_FAILED });
    expect(await runPrint(choice, { decode: async () => null, build, print: async () => false, record })).toEqual({ ok: false, reason: PRINT_BLOCKED });
    expect(record).toHaveBeenCalledTimes(1);
    show({ standIn: true });
    expect(await runPrint(choice, { decode: async () => null, build, print: async () => true })).toEqual({ ok: false, reason: STAND_IN });
    expect(isPrintShortcut({ key: "p", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(isPrintShortcut({ key: "P", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(false);
  });
});
