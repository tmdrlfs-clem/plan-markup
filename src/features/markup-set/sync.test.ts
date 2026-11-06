import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn(), applyMarkupOps: vi.fn() }));

import type { Calibration } from "@/core/calibration/calibration";
import type { DocOp } from "@/core/commands/ops";
import type { ApplyMarkupOpsInput, MarkupOpResult } from "@/core/markup-set/markup-ops";
import type { Markup } from "@/core/schema/markup";

import { createMarkupSetSync, type SyncDeps } from "./sync";

const SHA = "a".repeat(64);
const IDS = { drawingId: "d", fileId: "f", pageIds: ["01890a5d-ac96-774b-bcce-b30209900000", "01890a5d-ac96-774b-bcce-b30209900001"] };
const CAL: Calibration = { xFactor: 26.46, yFactor: 26.46, unit: "mm", precision: "0.0", source: "ratio" };
const PAGES = [
  { width: 842, height: 595, rotate: 0 },
  { width: 595, height: 842, rotate: 90, view: [0, 0, 595, 842] as [number, number, number, number] },
];

function setup(viewer: Partial<ReturnType<SyncDeps["viewer"]>> = {}) {
  const state = { documentId: SHA, fileName: "L17.pdf", pages: PAGES, calibrations: {} as Record<string, Calibration>, ...viewer };
  const deps = {
    ensure: vi.fn(async () => ({ ok: true as const, data: IDS })),
    save: vi.fn(async () => ({ ok: true as const, data: null })),
    apply: vi.fn(async (input: ApplyMarkupOpsInput) => ({
      ok: true as const,
      data: input.ops.map((op): MarkupOpResult => ({ opId: op.opId, markupId: op.markupId, status: op.kind === "delete" ? "deleted" : "applied", version: op.baseVersion + 1 })),
    })),
    viewer: () => state,
    markups: () => list,
    delayMs: 60_000,
    now: () => 5_000,
    newId: (() => {
      let n = 0;
      return () => `01890a5d-ac96-774b-bcce-${String(++n).padStart(12, "0")}`;
    })(),
  };
  let list: Markup[] = [];
  const setList = (next: Markup[]) => (list = next);
  return { state, deps, setList, sync: createMarkupSetSync(deps) };
}

const addMarkup = (documentId = SHA): DocOp => ({ kind: "markups.add", documentId, markups: [] });
const calibrate = (key: string, before: Calibration | null, after: Calibration | null): DocOp => ({
  kind: "calibrations.set",
  documentId: SHA,
  before: { [key]: before },
  after: { [key]: after },
});

describe("markup set sync (Story 6.1)", () => {
  it("nothing is asked until an edit; the first edit asks for the set once, with the file's name and pages", async () => {
    const { deps, sync } = setup();
    expect(deps.ensure).not.toHaveBeenCalled();
    sync.onOp(addMarkup());
    sync.onOp(addMarkup());
    await expect(sync.ids(SHA)).resolves.toEqual(IDS);
    expect(deps.ensure).toHaveBeenCalledTimes(1);
    expect(deps.ensure).toHaveBeenCalledWith({
      sha256: SHA,
      filename: "L17.pdf",
      pages: [
        { rotation: 0, cropBox: [0, 0, 842, 595], width: 842, height: 595 },
        { rotation: 90, cropBox: [0, 0, 595, 842], width: 595, height: 842 },
      ],
    });
  });

  it("an op of a document that is not open asks for nothing", async () => {
    const { deps, sync } = setup();
    sync.onOp(addMarkup("b".repeat(64)));
    expect(deps.ensure).not.toHaveBeenCalled();
  });

  it("calibrations save by the server's page ids, batched; undo saves the removal", async () => {
    const { state, deps, sync } = setup();
    state.calibrations = { [`${SHA}:1`]: CAL };
    sync.onOp(calibrate(`${SHA}:1`, null, CAL));
    await sync.flush();
    expect(deps.save).toHaveBeenCalledWith([{ pageId: IDS.pageIds[1], calibration: CAL }]);
    state.calibrations = {};
    sync.onOp(calibrate(`${SHA}:1`, CAL, null));
    await sync.flush();
    expect(deps.save).toHaveBeenLastCalledWith([{ pageId: IDS.pageIds[1], calibration: null }]);
    expect(deps.ensure).toHaveBeenCalledTimes(1);
  });

  it("a set that could not be made is asked for again on the next edit; what failed to save goes with it", async () => {
    const { state, deps, sync } = setup();
    deps.ensure.mockResolvedValueOnce({ ok: false, code: "INTERNAL", message: "x" } as never);
    state.calibrations = { [`${SHA}:0`]: CAL };
    sync.onOp(calibrate(`${SHA}:0`, null, CAL));
    await sync.flush();
    expect(deps.save).not.toHaveBeenCalled();
    sync.onOp(addMarkup());
    await sync.flush();
    expect(deps.ensure).toHaveBeenCalledTimes(2);
    expect(deps.save).toHaveBeenCalledWith([{ pageId: IDS.pageIds[0], calibration: CAL }]);

    deps.save.mockResolvedValueOnce({ ok: false, code: "INTERNAL", message: "x" } as never);
    state.calibrations = { [`${SHA}:0`]: CAL, [`${SHA}:1`]: CAL };
    sync.onOp(calibrate(`${SHA}:1`, null, CAL));
    await sync.flush();
    sync.onOp(addMarkup());
    await sync.flush();
    expect(deps.save).toHaveBeenCalledTimes(3);
    expect(deps.save).toHaveBeenLastCalledWith([{ pageId: IDS.pageIds[1], calibration: CAL }]);
  });
});

const STYLE = { color: "#ff0000", width: 1, fontSize: 10 };
const M1 = "01890a5d-ac96-774b-bcce-b302099a0001";
const M2 = "01890a5d-ac96-774b-bcce-b302099a0002";
const line = (id: string, x = 0, page = 0): Markup => ({ id, type: "line", pageId: `${SHA}:${page}`, createdAt: "t", style: STYLE, points: [{ x, y: 0 }, { x: x + 1, y: 1 }] });
const opsOf = (deps: ReturnType<typeof setup>["deps"], call: number) => (deps.apply.mock.calls[call][0] as ApplyMarkupOpsInput).ops;

describe("markup ops sync (Story 6.2)", () => {
  it("creates new markups with every field on the server page; then sends only what changed, at the known version", async () => {
    const { deps, setList, sync } = setup();
    const a = line(M1);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledWith({
      drawingId: "d",
      ops: [{ opId: expect.any(String), clientTs: 5_000, markupId: M1, kind: "create", type: "line", pageId: IDS.pageIds[0], baseVersion: 0, fields: { geometry: { points: a.points }, style: STYLE, props: { createdAt: "t" }, z: 0 } }],
    });
    expect(sync.version(SHA, M1)).toBe(1);

    const moved = line(M1, 5);
    setList([moved]);
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [a], after: [moved] });
    await sync.flush();
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M1, kind: "update", baseVersion: 1, fields: { geometry: { points: moved.points } } })]);
  });

  it("deletes, and the undo of the delete is a create at the tombstone's version (A4)", async () => {
    const { deps, setList, sync } = setup();
    const a = line(M1);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    await sync.flush();
    setList([]);
    sync.onOp({ kind: "markups.remove", documentId: SHA, markups: [a] });
    await sync.flush();
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M1, kind: "delete", baseVersion: 1 })]);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    await sync.flush();
    expect(opsOf(deps, 2)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", baseVersion: 2 })]);
  });

  it("batches changes and sends nothing for an op that changed nothing", async () => {
    const { deps, setList, sync } = setup();
    const a = line(M1);
    const b = line(M2, 3);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    setList([a, b]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [b] });
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(opsOf(deps, 0).map((o) => o.markupId)).toEqual([M1, M2]);
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [], after: [] });
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });

  it("a failed save is sent again with the next change; a missing markup is made again", async () => {
    const { deps, setList, sync } = setup();
    const a = line(M1);
    deps.apply.mockResolvedValueOnce({ ok: false, code: "INTERNAL", message: "x" } as never);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    await sync.flush();
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", baseVersion: 0 })]);

    const moved = line(M1, 9);
    setList([moved]);
    deps.apply.mockImplementationOnce(async (input: ApplyMarkupOpsInput) => ({ ok: true as const, data: input.ops.map((op) => ({ opId: op.opId, markupId: op.markupId, status: "missing" as const, version: 0 })) }));
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [a], after: [moved] });
    await sync.flush();
    await sync.flush();
    expect(opsOf(deps, 3)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", baseVersion: 0 })]);
  });

  it("keeps one request in flight per document; changes made meanwhile follow", async () => {
    const { deps, setList, sync } = setup();
    let release: () => void = () => undefined;
    deps.apply.mockImplementationOnce(
      (input: ApplyMarkupOpsInput) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true as const, data: input.ops.map((op) => ({ opId: op.opId, markupId: op.markupId, status: "applied" as const, version: 1 })) });
        }),
    );
    const a = line(M1);
    setList([a]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [a] });
    const first = sync.flush();
    await vi.waitFor(() => expect(deps.apply).toHaveBeenCalledTimes(1));
    const b = line(M2);
    setList([a, b]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [b] });
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    release();
    await first;
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M2, kind: "create" })]);
  });

  it("a markup on a page the set does not know stays local", async () => {
    const { deps, setList, sync } = setup();
    const far = line(M1, 0, 7);
    setList([far]);
    sync.onOp({ kind: "markups.add", documentId: SHA, markups: [far] });
    await sync.flush();
    expect(deps.apply).not.toHaveBeenCalled();
  });
});
