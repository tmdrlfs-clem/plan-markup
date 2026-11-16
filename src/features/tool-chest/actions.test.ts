import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  error: vi.fn(),
  getCompanyAdmin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/features/company/guard", () => ({ getCompanyAdmin: m.getCompanyAdmin }));
vi.mock("@/lib/db/tool-sets", () => ({
  listToolSets: m.list,
  createToolSet: m.create,
  renameToolSet: m.rename,
  moveToolSet: m.move,
  deleteToolSet: m.remove,
  addTool: m.add,
  MAX_COMPANY_TOOL_SETS: 100,
}));

import { addTool, createToolSet, deleteToolSet, listToolSets, moveToolSet, publishToolSet, renameToolSet } from "./actions";

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
    expect(m.create).toHaveBeenCalledWith({}, USER.id, "Heads");
    m.create.mockResolvedValueOnce(null);
    expect(await createToolSet({ name: "More" })).toMatchObject({ ok: false, code: "INVALID_INPUT", message: "At most 500 tool sets." });
    m.rename.mockResolvedValue(false);
    expect(await renameToolSet({ id: ID, name: "B" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.move.mockResolvedValue(true);
    expect(await moveToolSet({ id: ID, direction: 1 })).toEqual({ ok: true, data: null });
    expect(m.move).toHaveBeenCalledWith({}, USER.id, ID, 1);
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

const CONTENT = {
  v: 1,
  markups: [
    {
      id: "00000000-0000-7000-8000-000000000001",
      pageId: "tool:0",
      createdAt: "2026-11-07T00:00:00.000Z",
      style: { color: "#ff0000", width: 1, fontSize: 10 },
      type: "line",
      points: [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ],
  calibration: null,
  userUnit: 1,
};

describe("addTool (Story 7.2)", () => {
  it("validates the input, then adds under the signed-in user", async () => {
    expect(await addTool({ set: { id: ID }, name: "Pipe", content: { ...CONTENT, markups: [] }, device: null, image: null })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await addTool({ set: { id: ID }, name: "Pipe", content: CONTENT, device: null, image: { type: "image/png", base64: "iVBORw0KGgo=" } })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      message: "The tool's image is missing.",
    });
    expect(m.add).not.toHaveBeenCalled();
    const added = { set: null, setId: ID, tool: { id: "t", name: "Pipe", content: CONTENT, device: null, imageUrl: null } };
    m.add.mockResolvedValueOnce(added);
    expect(await addTool({ set: { id: ID }, name: " Pipe ", content: CONTENT, device: null, image: null })).toEqual({ ok: true, data: added });
    expect(m.add.mock.calls[0][1]).toBe(USER.id);
    expect(m.add.mock.calls[0][2]).toMatchObject({ name: "Pipe" });
  });

  it("reports a full set and a set that is not the user's", async () => {
    m.add.mockResolvedValueOnce("full");
    expect(await addTool({ set: { name: "New" }, name: "Pipe", content: CONTENT, device: null, image: null })).toMatchObject({ ok: false, code: "INVALID_INPUT", message: "That tool set is full." });
    m.add.mockResolvedValueOnce(null);
    expect(await addTool({ set: { id: ID }, name: "Pipe", content: CONTENT, device: null, image: null })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("publishToolSet (Story 10.11)", () => {
  const ADMIN = { user: USER, membership: { companyId: "c", companyName: "Acme", companyPlan: "free", role: "admin" } };

  it("is for a company admin only, and checks the input first", async () => {
    m.getCompanyAdmin.mockResolvedValue(null);
    expect(await publishToolSet({ id: ID, published: true })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.getCompanyAdmin.mockResolvedValue(ADMIN);
    expect(await publishToolSet({ id: ID })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("publishes and withdraws through the audited database function, as the signed-in admin", async () => {
    m.getCompanyAdmin.mockResolvedValue(ADMIN);
    m.rpc.mockResolvedValue({ data: [{ changed: true, company_name: "Acme" }], error: null });
    expect(await publishToolSet({ id: ID, published: true })).toEqual({ ok: true, data: { published: true, companyName: "Acme" } });
    expect(m.rpc).toHaveBeenCalledWith("set_tool_set_published", { p_actor_id: USER.id, p_tool_set_id: ID, p_published: true });
    expect(await publishToolSet({ id: ID, published: false })).toEqual({ ok: true, data: { published: false, companyName: "Acme" } });
    expect(m.rpc).toHaveBeenLastCalledWith("set_tool_set_published", { p_actor_id: USER.id, p_tool_set_id: ID, p_published: false });
  });

  it("maps the refusals of the database", async () => {
    m.getCompanyAdmin.mockResolvedValue(ADMIN);
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await publishToolSet({ id: ID, published: true })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await publishToolSet({ id: ID, published: true })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await publishToolSet({ id: ID, published: true })).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "Your company already has 100 published tool sets. Withdraw one first.",
    });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect(await publishToolSet({ id: ID, published: true })).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.error).toHaveBeenCalled();
  });
});
