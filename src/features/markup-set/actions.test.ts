import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getAuthUser: vi.fn(), rpc: vi.fn(), upsert: vi.fn(), deleteIn: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    rpc: m.rpc,
    from: (table: string) => {
      expect(table).toBe("calibrations");
      return { upsert: m.upsert, delete: () => ({ in: m.deleteIn }) };
    },
  }),
}));

import { applyMarkupOps, ensureMarkupSet, saveSetCalibrations } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.test", name: "A", isPlatformAdmin: false, theme: "blueprint" };
const SHA = "c".repeat(64);
const PAGE = { rotation: 0, cropBox: [0, 0, 842, 595], width: 842, height: 595 };
const PAGE_ID = "01890a5d-ac96-774b-bcce-b302099a8057";
const CAL = { xFactor: 26.46, yFactor: 26.46, unit: "mm", precision: "0.0", source: "ratio" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
  m.rpc.mockResolvedValue({ data: [{ drawing_id: "d", file_id: "f", page_ids: [PAGE_ID] }], error: null });
  m.upsert.mockResolvedValue({ error: null });
  m.deleteIn.mockResolvedValue({ error: null });
});

describe("markup set actions (Story 6.1)", () => {
  it("makes or finds the set through the RPC with the hash, the filename and page geometry", async () => {
    await expect(ensureMarkupSet({ sha256: SHA, filename: "L17.pdf", pages: [PAGE] })).resolves.toEqual({ ok: true, data: { drawingId: "d", fileId: "f", pageIds: [PAGE_ID] } });
    expect(m.rpc).toHaveBeenCalledWith("ensure_drawing_file", { p_sha256: SHA, p_filename: "L17.pdf", p_pages: [PAGE] });
  });

  it("refuses without a user or with bad input, before the database; errors are INTERNAL and logged", async () => {
    m.getAuthUser.mockResolvedValue(null);
    await expect(ensureMarkupSet({ sha256: SHA, filename: "a.pdf", pages: [PAGE] })).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    m.getAuthUser.mockResolvedValue(USER);
    await expect(ensureMarkupSet({ sha256: "x", filename: "a.pdf", pages: [PAGE] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSetCalibrations([{ pageId: `${SHA}:0`, calibration: CAL }])).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not allowed" } });
    await expect(ensureMarkupSet({ sha256: SHA, filename: "a.pdf", pages: [PAGE] })).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.error).toHaveBeenCalledWith("markup_set.ensure_failed", expect.anything());
  });

  it("saves calibrations by page id: upserts, and deletes the removed ones", async () => {
    const other = "01890a5d-ac96-774b-bcce-b302099a8058";
    await expect(saveSetCalibrations([{ pageId: PAGE_ID, calibration: CAL }, { pageId: other, calibration: null }])).resolves.toEqual({ ok: true, data: null });
    expect(m.upsert).toHaveBeenCalledWith([expect.objectContaining({ page_id: PAGE_ID, calibration: CAL })]);
    expect(m.deleteIn).toHaveBeenCalledWith("page_id", [other]);
  });
});

describe("applyMarkupOps (Story 6.2)", () => {
  const DRAWING = "01890a5d-ac96-774b-bcce-b302099a8001";
  const MARKUP = "01890a5d-ac96-774b-bcce-b302099a8002";
  const OP = "01890a5d-ac96-774b-bcce-b302099a8003";
  const create = {
    opId: OP,
    markupId: MARKUP,
    kind: "create",
    type: "line",
    pageId: PAGE_ID,
    baseVersion: 0,
    clientTs: 1,
    fields: { geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, style: { color: "#ff0000", width: 1, fontSize: 10 }, props: { createdAt: "x" }, z: 0 },
  };

  it("sends validated ops to the RPC and returns its results", async () => {
    m.rpc.mockResolvedValue({ data: [{ opId: OP, markupId: MARKUP, status: "applied", version: 1 }], error: null });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [create] })).resolves.toEqual({ ok: true, data: [{ opId: OP, markupId: MARKUP, status: "applied", version: 1 }] });
    expect(m.rpc).toHaveBeenCalledWith("apply_markup_ops", { p_drawing_id: DRAWING, p_ops: [create] });
  });

  it("refuses bad ops before the database (shared schemas, protected fields)", async () => {
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [{ ...create, fields: { ...create.fields, version: 2 } }] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [{ ...create, fields: { ...create.fields, geometry: { points: [] } } }] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    m.getAuthUser.mockResolvedValue(null);
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [create] })).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps refusals to codes and other errors to INTERNAL", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [create] })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValue({ data: null, error: { code: "PT429" } });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [create] })).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    m.rpc.mockResolvedValue({ data: [], error: null });
    await expect(applyMarkupOps({ drawingId: DRAWING, ops: [create] })).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.error).toHaveBeenCalledWith("markup_set.ops_failed", expect.anything());
  });
});
