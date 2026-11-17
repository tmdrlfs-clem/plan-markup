import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getCompanyAdmin: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("./guard", () => ({ getCompanyAdmin: m.getCompanyAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));

import { resetCompanyUseMap, saveCompanyUseMap } from "./use-map-actions";

const ADMIN_ID = "00000000-0000-4000-8000-00000000000a";
const ADMIN = { user: { id: ADMIN_ID, email: "boss@acme.test", name: "Bo Boss" }, membership: { companyId: "c1", companyName: "Acme Fire", role: "admin" } };
const INPUT = {
  defaultUse: "Lab",
  uses: [
    { use: " Office ", hazard: "OH1" },
    { use: "Lab", hazard: "OH3" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getCompanyAdmin.mockResolvedValue(ADMIN);
  m.rpc.mockResolvedValue({ data: [{ changed: true, map_version: "2" }], error: null });
});

describe("saveCompanyUseMap (Story 10.12)", () => {
  it("saves the whole mapping through the audited function, as the signed-in admin", async () => {
    expect(await saveCompanyUseMap(INPUT)).toEqual({ ok: true, data: { changed: true, version: "2" } });
    expect(m.rpc).toHaveBeenCalledWith("set_company_use_hazard_map", {
      p_actor_id: ADMIN_ID,
      p_uses: [
        { use: "Office", hazard: "OH1", is_default: false },
        { use: "Lab", hazard: "OH3", is_default: true },
      ],
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/company/4541");
  });

  it("reports a mapping that already was like this", async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ changed: false, map_version: "2" }], error: null });
    expect(await saveCompanyUseMap(INPUT)).toEqual({ ok: true, data: { changed: false, version: "2" } });
  });

  it("refuses non-admins and bad input before touching the database, naming the field", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await saveCompanyUseMap(INPUT)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await saveCompanyUseMap({ ...INPUT, companyId: "c2" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveCompanyUseMap({ defaultUse: "Lab", uses: [] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveCompanyUseMap({ defaultUse: "Shop", uses: INPUT.uses })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "defaultUse" });
    expect(await saveCompanyUseMap({ defaultUse: "Lab", uses: [{ use: "Lab", hazard: "OH3" }, { use: "<b>", hazard: "OH1" }] })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      field: "uses.1.use",
    });
    expect(await saveCompanyUseMap({ defaultUse: "Lab", uses: [{ use: "Lab", hazard: "OH3" }, { use: "LAB", hazard: "OH1" }] })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      field: "uses.1.use",
    });
    expect(await saveCompanyUseMap({ defaultUse: "Lab", uses: [{ use: "Lab", hazard: "HH" }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals and hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await saveCompanyUseMap(INPUT)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const code of ["22023", "23514", "23505"]) {
      m.rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await saveCompanyUseMap(INPUT)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await saveCompanyUseMap(INPUT);
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
    m.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await saveCompanyUseMap(INPUT)).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});

describe("resetCompanyUseMap (Story 10.12)", () => {
  it("removes the company's mapping through the same function", async () => {
    m.rpc.mockResolvedValueOnce({ data: [{ changed: true, map_version: null }], error: null });
    expect(await resetCompanyUseMap()).toEqual({ ok: true, data: { changed: true, version: null } });
    expect(m.rpc).toHaveBeenCalledWith("set_company_use_hazard_map", { p_actor_id: ADMIN_ID, p_uses: null });
    expect(m.revalidatePath).toHaveBeenCalledWith("/company/4541");
  });

  it("refuses non-admins", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await resetCompanyUseMap()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
