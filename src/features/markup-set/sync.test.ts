import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn() }));

import type { Calibration } from "@/core/calibration/calibration";
import type { DocOp } from "@/core/commands/ops";

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
    viewer: () => state,
    delayMs: 60_000,
  };
  return { state, deps, sync: createMarkupSetSync(deps) };
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
