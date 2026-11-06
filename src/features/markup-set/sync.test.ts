import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ ensureMarkupSet: vi.fn(), saveSetCalibrations: vi.fn(), applyMarkupOps: vi.fn(), loadMarkupSet: vi.fn(), hasMarkupsOnOtherVersion: vi.fn(), listMyMarkupSets: vi.fn() }));

import type { Calibration } from "@/core/calibration/calibration";
import type { DocOp } from "@/core/commands/ops";
import type { ApplyMarkupOpsInput, MarkupOpResult, SavedMarkup } from "@/core/markup-set/markup-ops";
import type { Markup } from "@/core/schema/markup";
import type { Layer } from "@/core/schema/layer";
import type { LoadedMarkupSet } from "@/lib/db/markups";
import { memoryOpQueue, type OpQueueBackend } from "@/lib/idb/op-queue";

import { createMarkupSetSync, FIRST_RETRY_MS, isSaveShortcut, MAX_RETRY_MS, type SnapshotStore } from "./sync";

const SHA = "a".repeat(64);
const USER = "11111111-1111-4111-8111-111111111111";
const IDS = { drawingId: "d", fileId: "f", pageIds: ["01890a5d-ac96-774b-bcce-b30209900000", "01890a5d-ac96-774b-bcce-b30209900001"] };
const CAL: Calibration = { xFactor: 26.46, yFactor: 26.46, unit: "mm", precision: "0.0", source: "ratio" };
const PAGES = [
  { width: 842, height: 595, rotate: 0 },
  { width: 595, height: 842, rotate: 90, view: [0, 0, 595, 842] as [number, number, number, number] },
];
const STYLE = { color: "#ff0000", width: 1, fontSize: 10 };
const M1 = "01890a5d-ac96-774b-bcce-b302099a0001";
const M2 = "01890a5d-ac96-774b-bcce-b302099a0002";
const line = (id: string, x = 0, page = 0): Markup => ({ id, type: "line", pageId: `${SHA}:${page}`, createdAt: "t", style: STYLE, points: [{ x, y: 0 }, { x: x + 1, y: 1 }] });

function memorySnapshots(): SnapshotStore {
  const stored = new Map<string, Map<string, SavedMarkup>>();
  return {
    // Read back without the in-memory objects, as from sessionStorage.
    get: (doc) => (stored.has(doc) ? new Map([...stored.get(doc)!].map(([id, s]) => [id, { type: s.type, z: s.z, geometry: s.geometry, style: s.style, props: s.props }])) : null),
    set: (doc, saved) => stored.set(doc, new Map(saved)),
  };
}

const applyAll = async (input: ApplyMarkupOpsInput) => ({
  ok: true as const,
  data: input.ops.map((op): MarkupOpResult => ({ opId: op.opId, markupId: op.markupId, status: op.kind === "delete" ? "deleted" : "applied", version: op.baseVersion + 1 })),
});

type Shared = { queue?: OpQueueBackend; snapshots?: SnapshotStore; list?: Markup[] };

function setup(shared: Shared = {}) {
  const state = { documentId: SHA as string | null, fileName: "L17.pdf", pages: PAGES, calibrations: {} as Record<string, Calibration>, list: shared.list ?? ([] as Markup[]), online: true, layers: [] as Layer[] };
  let n = 0;
  const queue = shared.queue ?? memoryOpQueue();
  const snapshots = shared.snapshots ?? memorySnapshots();
  const deps = {
    userId: USER,
    ensure: vi.fn(async () => ({ ok: true as const, data: IDS })),
    save: vi.fn(async () => ({ ok: true as const, data: null })),
    apply: vi.fn(applyAll),
    viewer: () => state,
    markups: () => state.list,
    load: vi.fn(async (): Promise<{ ok: true; data: LoadedMarkupSet | null }> => ({ ok: true, data: null })),
    setMarkups: vi.fn((_doc: string, markups: readonly Markup[]) => {
      state.list = [...markups];
    }),
    setCalibrations: vi.fn((_doc: string, calibrations: Readonly<Record<string, Calibration>>) => {
      state.calibrations = { ...calibrations };
    }),
    layers: () => state.layers,
    setLayers: vi.fn((_doc: string, layers: readonly Layer[]) => {
      state.layers = [...layers];
    }),
    queue,
    snapshots,
    online: () => state.online,
    delayMs: 60_000,
    now: () => 5_000,
    newId: () => `01890a5d-ac96-774b-bcce-${String(++n).padStart(12, "0")}`,
  };
  const sync = createMarkupSetSync(deps);
  return { state, deps, sync, queue, snapshots };
}

const opsOf = (deps: ReturnType<typeof setup>["deps"], call: number) => (deps.apply.mock.calls[call][0] as ApplyMarkupOpsInput).ops;
const add = (...markups: Markup[]): DocOp => ({ kind: "markups.add", documentId: SHA, markups });
const calibrate = (key: string, before: Calibration | null, after: Calibration | null): DocOp => ({ kind: "calibrations.set", documentId: SHA, before: { [key]: before }, after: { [key]: after } });

afterEach(() => {
  vi.useRealTimers();
});

describe("markup set (Story 6.1)", () => {
  it("nothing is asked until an edit; the first edit asks for the set once, with the file's name and pages", async () => {
    const { deps, sync } = setup();
    expect(deps.ensure).not.toHaveBeenCalled();
    sync.onOp(add());
    sync.onOp(add());
    await sync.flush();
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
    sync.onOp({ kind: "markups.add", documentId: "b".repeat(64), markups: [] });
    await sync.flush();
    expect(deps.ensure).not.toHaveBeenCalled();
  });

  it("calibrations save by the server's page ids through the queue; undo saves the removal", async () => {
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
});

describe("markup ops (Story 6.2)", () => {
  it("creates new markups with every field on the server page; then sends only what changed, at the known version", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledWith({
      drawingId: "d",
      ops: [{ opId: expect.any(String), clientTs: 5_000, markupId: M1, kind: "create", type: "line", pageId: IDS.pageIds[0], baseVersion: 0, fields: { geometry: { points: a.points }, style: STYLE, props: { createdAt: "t" }, z: 0 } }],
    });
    expect(sync.version(M1)).toBe(1);
    const moved = line(M1, 5);
    state.list = [moved];
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [a], after: [moved] });
    await sync.flush();
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M1, kind: "update", baseVersion: 1, fields: { geometry: { points: moved.points } } })]);
  });

  it("deletes, and the undo of the delete is a create at the tombstone's version (A4)", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    state.list = [];
    sync.onOp({ kind: "markups.remove", documentId: SHA, markups: [a] });
    await sync.flush();
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ markupId: M1, kind: "delete", baseVersion: 1 })]);
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    expect(opsOf(deps, 2)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", baseVersion: 2 })]);
  });

  it("batches changes and sends nothing for an op that changed nothing", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    const b = line(M2, 3);
    state.list = [a];
    sync.onOp(add(a));
    state.list = [a, b];
    sync.onOp(add(b));
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(opsOf(deps, 0).map((o) => o.markupId)).toEqual([M1, M2]);
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [], after: [] });
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });

  it("a markup unknown to the server is made again", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    const moved = line(M1, 9);
    state.list = [moved];
    deps.apply.mockImplementationOnce(async (input: ApplyMarkupOpsInput) => ({ ok: true as const, data: input.ops.map((op) => ({ opId: op.opId, markupId: op.markupId, status: "missing" as const, version: 0 })) }));
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [a], after: [moved] });
    await sync.flush();
    await sync.flush();
    expect(opsOf(deps, 2)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", baseVersion: 0 })]);
  });

  it("a markup on a page the set does not know stays local", async () => {
    const { state, deps, sync } = setup();
    const far = line(M1, 0, 7);
    state.list = [far];
    sync.onOp(add(far));
    await sync.flush();
    expect(deps.apply).not.toHaveBeenCalled();
  });
});

describe("offline queue and save status (Story 6.3)", () => {
  it("offline: the changes wait in the queue in order; back online they are sent in order and the state is Saved", async () => {
    const { state, deps, sync, queue } = setup();
    const a = line(M1);
    const b = line(M2, 3);
    state.online = false;
    deps.apply.mockRejectedValue(new Error("Failed to fetch"));
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    state.list = [a, b];
    sync.onOp(add(b));
    await sync.flush();
    expect(sync.status()).toMatchObject({ state: "offline", pending: 2 });
    expect(await queue.count(USER)).toBe(2);

    state.online = true;
    deps.apply.mockImplementation(applyAll);
    await sync.saveNow();
    expect(sync.status()).toMatchObject({ state: "saved", pending: 0, lastSavedAt: 5_000 });
    expect(opsOf(deps, deps.apply.mock.calls.length - 1).map((o) => o.markupId)).toEqual([M1, M2]);
    expect(await queue.count(USER)).toBe(0);
  });

  it("a change made offline before the set exists makes the set later", async () => {
    const { state, deps, sync } = setup();
    deps.ensure.mockRejectedValue(new Error("Failed to fetch"));
    state.online = false;
    const a = line(M1);
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(sync.status().state).toBe("offline");
    state.online = true;
    deps.ensure.mockResolvedValue({ ok: true, data: IDS });
    await sync.saveNow();
    expect(opsOf(deps, 0)).toEqual([expect.objectContaining({ markupId: M1, kind: "create", pageId: IDS.pageIds[0] })]);
  });

  it("an expired session is Local only; a server error is Not synced; nothing leaves the queue", async () => {
    const { state, deps, sync, queue } = setup();
    state.list = [line(M1)];
    deps.apply.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED", message: "x" } as never);
    sync.onOp(add(state.list[0]));
    await sync.flush();
    expect(sync.status().state).toBe("local");
    deps.apply.mockResolvedValueOnce({ ok: false, code: "INTERNAL", message: "x" } as never);
    await sync.saveNow();
    expect(sync.status().state).toBe("error");
    expect(await queue.count(USER)).toBe(1);
    await sync.saveNow();
    expect(sync.status().state).toBe("saved");
  });

  it("a reload keeps everything: the queue is sent by the next page, and its snapshot still knows what was queued", async () => {
    const first = setup();
    const a = line(M1);
    const b = line(M2, 3);
    first.state.online = false;
    first.deps.apply.mockRejectedValue(new Error("offline"));
    first.state.list = [a, b];
    first.sync.onOp(add(a, b));
    await first.sync.flush();
    first.sync.dispose();

    // The next page (same queue and session), back online: it sends what waits at once.
    const second = setup({ queue: first.queue, snapshots: first.snapshots, list: [a, b] });
    await vi.waitFor(() => expect(second.deps.apply).toHaveBeenCalledTimes(1));
    expect(opsOf(second.deps, 0).map((o) => [o.markupId, o.kind])).toEqual([
      [M1, "create"],
      [M2, "create"],
    ]);
    // A delete after the reload is sent (the snapshot survived).
    second.state.list = [a];
    second.sync.onOp({ kind: "markups.remove", documentId: SHA, markups: [b] });
    await second.sync.flush();
    expect(opsOf(second.deps, 1)).toEqual([expect.objectContaining({ markupId: M2, kind: "delete", baseVersion: 1 })]);
  });

  it("the same markup twice in the queue goes in two requests, the second re-based on the first's version", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    state.online = false;
    deps.apply.mockRejectedValue(new Error("offline"));
    state.list = [a];
    sync.onOp(add(a));
    await sync.flush();
    const moved = line(M1, 4);
    state.list = [moved];
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [a], after: [moved] });
    await sync.flush();
    deps.apply.mockImplementation(applyAll);
    deps.apply.mockClear();
    state.online = true;
    await sync.saveNow();
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(opsOf(deps, 0)).toEqual([expect.objectContaining({ kind: "create", baseVersion: 0 })]);
    expect(opsOf(deps, 1)).toEqual([expect.objectContaining({ kind: "update", baseVersion: 1 })]);
  });

  it("retries with exponential backoff capped at 30 s", async () => {
    vi.useFakeTimers();
    const { state, deps, sync } = setup();
    deps.apply.mockRejectedValue(new Error("offline"));
    state.list = [line(M1)];
    sync.onOp(add(state.list[0]));
    await sync.flush();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = deps.apply.mock.calls.length;
      let waited = 0;
      while (deps.apply.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([FIRST_RETRY_MS, 2_000, 4_000, 8_000, 16_000, MAX_RETRY_MS, MAX_RETRY_MS]);
    sync.dispose();
  });

  it("Ctrl+S (⌘S) is the save shortcut; Ctrl+Shift+S is not", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "S", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
  });
});

describe("restore when reopening the same PDF (Story 6.4)", () => {
  const loaded = (markups: Markup[], z: number[], calibrations: Record<string, Calibration> = {}): LoadedMarkupSet => ({
    ids: IDS,
    markups: markups.map((markup, i) => ({ markup, z: z[i], version: 3 })),
    calibrations,
  });

  it("brings back the server's markups and calibrations; the next edit sends only itself, at the server's version", async () => {
    const { state, deps, sync } = setup();
    const a = line(M1);
    const b = line(M2, 3);
    deps.load.mockResolvedValue({ ok: true, data: loaded([a, b], [0, 1], { [`${SHA}:0`]: CAL }) });
    await sync.restore(SHA);
    expect(deps.load).toHaveBeenCalledWith(SHA);
    expect(state.list).toEqual([a, b]);
    expect(state.calibrations).toEqual({ [`${SHA}:0`]: CAL });
    expect(sync.status().state).toBe("saved");
    // No ensure: the set is known.
    const moved = line(M2, 9);
    state.list = [a, moved];
    sync.onOp({ kind: "markups.update", documentId: SHA, before: [b], after: [moved] });
    await sync.flush();
    expect(deps.ensure).not.toHaveBeenCalled();
    expect(opsOf(deps, 0)).toEqual([expect.objectContaining({ markupId: M2, kind: "update", baseVersion: 3, fields: { geometry: { points: moved.points } } })]);
  });

  it("shows the copy on this computer first, then the server's", async () => {
    const shared = { queue: memoryOpQueue(), snapshots: memorySnapshots() };
    const a = line(M1);
    const b = line(M2, 3);
    await shared.queue.putSet(USER, SHA, { markups: [a], z: [0], calibrations: {}, layers: [{ id: M2, name: "Pipes", shown: true, locked: false } as unknown as Layer] });
    const { state, deps, sync } = setup({ queue: shared.queue });
    let answer: (v: { ok: true; data: LoadedMarkupSet }) => void = () => undefined;
    deps.load.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const done = sync.restore(SHA);
    await vi.waitFor(() => expect(state.list).toEqual([a]));
    expect(state.layers).toHaveLength(1);
    answer({ ok: true, data: loaded([a, b], [0, 1]) });
    await done;
    expect(state.list).toEqual([a, b]);
  });

  it("an edit made before the server answers wins (the server's set is not shown)", async () => {
    const { state, deps, sync } = setup();
    let answer: (v: { ok: true; data: LoadedMarkupSet }) => void = () => undefined;
    deps.load.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const done = sync.restore(SHA);
    await vi.waitFor(() => expect(deps.load).toHaveBeenCalled());
    const mine = line(M2, 7);
    state.list = [mine];
    sync.onOp(add(mine));
    answer({ ok: true, data: loaded([line(M1)], [0]) });
    await done;
    expect(state.list).toEqual([mine]);
  });

  it("restores nothing when this tab's session already has the document, or when the file has no set", async () => {
    const withSession = setup({ list: [line(M1)] });
    await withSession.sync.restore(SHA);
    expect(withSession.deps.load).not.toHaveBeenCalled();
    const none = setup();
    await none.sync.restore(SHA);
    expect(none.deps.load).toHaveBeenCalledTimes(1);
    expect(none.deps.setMarkups).not.toHaveBeenCalled();
    await none.sync.restore(SHA);
    expect(none.deps.load).toHaveBeenCalledTimes(1);
  });

  it("what waits in the queue is sent before the server's set is read", async () => {
    const first = setup();
    first.state.online = false;
    first.deps.apply.mockRejectedValue(new Error("offline"));
    const a = line(M1);
    first.state.list = [a];
    first.sync.onOp(add(a));
    await first.sync.flush();
    first.sync.dispose();
    // A new tab: no session, the queue still holds the line.
    const second = setup({ queue: first.queue });
    second.deps.load.mockResolvedValue({ ok: true, data: loaded([a], [0]) });
    await second.sync.restore(SHA);
    expect(second.deps.apply).toHaveBeenCalled();
    expect(second.state.list).toEqual([a]);
  });
});

describe("another version of the file (Story 6.5)", () => {
  it("no set for these bytes but one for this filename: the user is told; nothing is moved", async () => {
    const { state, deps, sync } = setup();
    const otherVersion = vi.fn(async () => ({ ok: true as const, data: true }));
    const onOtherVersion = vi.fn();
    const withHint = createMarkupSetSync({ ...deps, otherVersion, onOtherVersion });
    await withHint.restore(SHA);
    expect(otherVersion).toHaveBeenCalledWith({ sha256: SHA, filename: "L17.pdf" });
    expect(onOtherVersion).toHaveBeenCalledWith(SHA);
    expect(deps.setMarkups).not.toHaveBeenCalled();
    expect(state.list).toEqual([]);
    sync.dispose();
    withHint.dispose();
  });

  it("no other version: nothing is said; a set for these bytes never asks", async () => {
    const { deps } = setup();
    const otherVersion = vi.fn(async () => ({ ok: true as const, data: false }));
    const onOtherVersion = vi.fn();
    await createMarkupSetSync({ ...deps, otherVersion, onOtherVersion }).restore(SHA);
    expect(onOtherVersion).not.toHaveBeenCalled();
    const found = setup();
    found.deps.load.mockResolvedValue({ ok: true, data: { ids: IDS, markups: [], calibrations: {} } });
    const asked = vi.fn(async () => ({ ok: true as const, data: true }));
    await createMarkupSetSync({ ...found.deps, otherVersion: asked }).restore(SHA);
    expect(asked).not.toHaveBeenCalled();
  });
});
