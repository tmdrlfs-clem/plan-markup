import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/db/tool-sets", () => ({
  listToolSets: m.list,
  createToolSet: m.create,
  renameToolSet: m.rename,
  moveToolSet: m.move,
  deleteToolSet: m.remove,
}));

import { createToolSet, deleteToolSet, listToolSets, moveToolSet, renameToolSet } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.test", name: "A", isPlatformAdmin: false, theme: "blueprint" };
const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
});

describe("tool set actions (Story 7.1)", () => {
  it("need a signed-in user", async () => {
    m.getAuthUser.mockResolvedValue(null);
    expect(await listToolSets()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await createToolSet({ name: "A" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("validate their input before touching the database", async () => {
    expect(await createToolSet({ name: " " })).toMatchObject({ ok: false, code: "INVALID_INPUT", message: "Enter a name." });
    expect(await renameToolSet({ id: "x", name: "A" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await moveToolSet({ id: ID, direction: 0 })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteToolSet({})).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.rename).not.toHaveBeenCalled();
  });

  it("create trims the name and reports the cap; others report a set that is not the user's", async () => {
    m.create.mockResolvedValueOnce({ id: ID, name: "Heads", position: 1, tools: [] });
    expect(await createToolSet({ name: " Heads " })).toEqual({ ok: true, data: { id: ID, name: "Heads", position: 1, tools: [] } });
    expect(m.create).toHaveBeenCalledWith({}, "Heads");
    m.create.mockResolvedValueOnce(null);
    expect(await createToolSet({ name: "More" })).toMatchObject({ ok: false, code: "INVALID_INPUT", message: "At most 500 tool sets." });
    m.rename.mockResolvedValue(false);
    expect(await renameToolSet({ id: ID, name: "B" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.move.mockResolvedValue(true);
    expect(await moveToolSet({ id: ID, direction: 1 })).toEqual({ ok: true, data: null });
    m.remove.mockResolvedValue(true);
    expect(await deleteToolSet({ id: ID })).toEqual({ ok: true, data: null });
  });

  it("database errors are internal errors (logged, no detail)", async () => {
    m.list.mockRejectedValue(new Error("tool_sets select failed: 42P01"));
    const result = await listToolSets();
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.error).toHaveBeenCalled();
  });
});
